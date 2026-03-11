// Workspace Service - Read/write agent workspace files
// Primary: direct filesystem access (bind-mounted workspace directory)
// Fallback: OpenClaw Tools Invoke HTTP API (for tools not accessible via FS)

import { getDatabase } from '../config/database.js';
import { config } from '../config/env.js';
import { ObjectId } from 'mongodb';
import { posix as posixPath } from 'path';
import { join } from 'path';
import { readFile as fsReadFile, writeFile as fsWriteFile, readdir, stat, mkdir, unlink } from 'fs/promises';
import type { WorkspaceTemplateData } from '@openclaw-business/shared';
import { generateWorkspaceFiles } from '../templates/workspace-templates.js';

// ── Path Sanitization ────────────────────────────────────────────

/**
 * Sanitize a file path to prevent path traversal attacks.
 * Normalizes the path, rejects `..` components, and ensures it stays within allowed boundaries.
 */
function sanitizeFilePath(inputPath: string, allowedPrefixes: string[]): string {
  // Normalize to forward slashes and resolve . and ..
  const normalized = posixPath.normalize(inputPath).replace(/\\/g, '/');
  
  // Reject any path that still contains .. after normalization
  if (normalized.includes('..')) {
    throw new Error(`Path traversal detected: ${inputPath}`);
  }
  
  // Reject absolute paths
  if (normalized.startsWith('/')) {
    throw new Error(`Absolute paths not allowed: ${inputPath}`);
  }
  
  // Reject null bytes
  if (inputPath.includes('\0')) {
    throw new Error(`Null bytes in path not allowed: ${inputPath}`);
  }
  
  // Check against allowed prefixes
  // '.' means "workspace root" — allows any file without a directory component
  const isAllowed = allowedPrefixes.some(prefix => {
    if (prefix === '.') {
      // '.' allows root-level files (no slashes) or any relative path
      return !normalized.includes('/') || normalized.startsWith('./');
    }
    return normalized === prefix || normalized.startsWith(prefix + '/') || normalized.startsWith(prefix);
  });
  
  if (!isAllowed) {
    throw new Error(`Path not within allowed directories: ${inputPath}`);
  }
  
  return normalized;
}

/**
 * Shell-escape a string for safe use in shell commands.
 * Wraps in single quotes and escapes embedded single quotes.
 */
function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// ── Types ───────────────────────────────────────────────────────

export interface WorkspaceFile {
  filename: string;
  content: string;
  size: number;
}

export interface WorkspaceFileInfo {
  filename: string;
  exists: boolean;
  size?: number;
}

// Known persona files that live in the agent workspace root
export const PERSONA_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
] as const;

// Memory directory pattern
export const MEMORY_DIR = 'memory';

// ── Workspace Service ───────────────────────────────────────────

export class WorkspaceService {
  private get agentsCollection() {
    return getDatabase().collection('agents');
  }

  // ── Host Filesystem Access (Primary) ─────────────────────────
  // Files live on the host at: <OPENCLAW_WORKSPACE_DIR>/<agentId>/workspace/
  // The Docker container bind-mounts <OPENCLAW_WORKSPACE_DIR>/<agentId>
  // into /home/node/.openclaw, so host writes are visible immediately
  // inside the container and vice versa.

  /**
   * Get the workspace directory path on the host filesystem for an agent.
   * Verifies agent ownership before returning the path.
   */
  private async getWorkspacePath(agentId: string, userId: string, organizationId?: string): Promise<string> {
    const filter: any = { _id: new ObjectId(agentId) as any };
    if (organizationId) {
      filter.organizationId = organizationId;
    } else {
      filter.userId = userId;
    }

    const agent = await this.agentsCollection.findOne(filter);
    if (!agent) throw new Error('Agent not found');

    return join(config.openclawWorkspaceDir, agentId, 'workspace');
  }

  /**
   * Get the gateway HTTP base URL for an agent (used for Gateway API fallback)
   */
  private async getGatewayHttpUrl(agentId: string, userId: string, organizationId?: string): Promise<{ url: string; token: string }> {
    const filter: any = { _id: new ObjectId(agentId) as any };
    if (organizationId) {
      filter.organizationId = organizationId;
    } else {
      filter.userId = userId;
    }

    const agent = await this.agentsCollection.findOne(filter);
    if (!agent) throw new Error('Agent not found');
    if (!agent.gatewayUrl || !agent.gatewayToken) {
      throw new Error('Agent not deployed or missing gateway info');
    }

    const wsUrl = agent.gatewayUrl as string;
    const httpUrl = wsUrl.replace(/^ws(s?):\/\//, 'http$1://');

    return { url: httpUrl, token: agent.gatewayToken as string };
  }

  /**
   * Read a workspace file — directly from host filesystem.
   */
  async readFile(
    agentId: string,
    userId: string,
    filename: string,
    organizationId?: string
  ): Promise<WorkspaceFile> {
    const wsPath = await this.getWorkspacePath(agentId, userId, organizationId);
    const safeName = sanitizeFilePath(filename, ['.', 'memory/', 'memory', 'skills/', 'skills', 'canvas/', 'canvas', 'knowledge/', 'knowledge']);
    const filePath = join(wsPath, safeName);

    const content = await fsReadFile(filePath, 'utf-8');

    return {
      filename: safeName,
      content,
      size: content.length,
    };
  }

  private get versionsCollection() {
    return getDatabase().collection('workspace_versions');
  }

  /**
   * Write a workspace file — directly to host filesystem.
   * Changes are visible inside the container immediately (bind mount).
   * Saves a version snapshot of the previous content for persona files.
   */
  async writeFile(
    agentId: string,
    userId: string,
    filename: string,
    content: string,
    organizationId?: string,
    action: 'edit' | 'restore' | 'generate' = 'edit'
  ): Promise<number | undefined> {
    const wsPath = await this.getWorkspacePath(agentId, userId, organizationId);
    const safeName = sanitizeFilePath(filename, ['.', 'memory/', 'memory', 'skills/', 'skills', 'canvas/', 'canvas', 'knowledge/', 'knowledge']);
    const filePath = join(wsPath, safeName);

    // Save version snapshot for persona files before overwriting
    let versionNumber: number | undefined;
    const isPersonaFile = PERSONA_FILES.includes(safeName as any);
    if (isPersonaFile && organizationId) {
      try {
        let previousContent = '';
        try {
          previousContent = await fsReadFile(filePath, 'utf-8');
        } catch {
          // File doesn't exist yet — first write, still save version
        }

        // Only save a version if content actually changed
        if (previousContent !== content) {
          const lastVersion = await this.versionsCollection
            .find({ agentId, filename: safeName })
            .sort({ version: -1 })
            .limit(1)
            .toArray();

          versionNumber = (lastVersion[0]?.version || 0) + 1;

          await this.versionsCollection.insertOne({
            agentId,
            organizationId,
            filename: safeName,
            version: versionNumber,
            content,
            userId,
            createdAt: new Date(),
            contentLength: content.length,
            action,
          });
        }
      } catch (err) {
        console.warn(`[workspace] Failed to save version for ${safeName}:`, err);
      }
    }

    // Ensure parent directory exists (for memory/YYYY-MM-DD.md etc.)
    const dir = join(filePath, '..');
    await mkdir(dir, { recursive: true });

    await fsWriteFile(filePath, content, 'utf-8');
    return versionNumber;
  }

  /**
   * Get version history for a workspace file.
   */
  async getVersions(
    agentId: string,
    filename: string,
    limit: number = 50,
    skip: number = 0
  ): Promise<{ versions: any[]; total: number }> {
    const safeName = sanitizeFilePath(filename, ['.']);

    const [versions, total] = await Promise.all([
      this.versionsCollection
        .find(
          { agentId, filename: safeName },
          { projection: { content: 0 } }
        )
        .sort({ version: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      this.versionsCollection.countDocuments({ agentId, filename: safeName }),
    ]);

    return {
      versions: versions.map((v: any) => ({
        version: v.version,
        userId: v.userId,
        createdAt: v.createdAt,
        contentLength: v.contentLength,
        action: v.action,
      })),
      total,
    };
  }

  /**
   * Get a specific version of a workspace file.
   */
  async getVersion(
    agentId: string,
    filename: string,
    version: number
  ): Promise<any | null> {
    const safeName = sanitizeFilePath(filename, ['.']);
    return this.versionsCollection.findOne({ agentId, filename: safeName, version });
  }

  /**
   * Restore a specific version of a workspace file.
   */
  async restoreVersion(
    agentId: string,
    userId: string,
    filename: string,
    version: number,
    organizationId?: string
  ): Promise<number | undefined> {
    const versionDoc = await this.getVersion(agentId, filename, version);
    if (!versionDoc) throw new Error(`Version ${version} not found for ${filename}`);

    return this.writeFile(agentId, userId, filename, versionDoc.content, organizationId, 'restore');
  }

  /**
   * List workspace files — directly from host filesystem.
   */
  async listFiles(
    agentId: string,
    userId: string,
    directory: string = '.',
    organizationId?: string
  ): Promise<string[]> {
    const wsPath = await this.getWorkspacePath(agentId, userId, organizationId);
    const safeDir = sanitizeFilePath(directory === '.' ? '.' : directory, ['.', 'memory', 'skills', 'canvas', 'knowledge']);
    const dirPath = safeDir === '.' ? wsPath : join(wsPath, safeDir);

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const files: string[] = [];

      for (const entry of entries) {
        if (entry.isFile()) {
          files.push(safeDir === '.' ? entry.name : `${safeDir}/${entry.name}`);
        } else if (entry.isDirectory()) {
          // One level deep for sub-directories (memory/, skills/)
          try {
            const subEntries = await readdir(join(dirPath, entry.name), { withFileTypes: true });
            for (const sub of subEntries) {
              if (sub.isFile()) {
                const rel = safeDir === '.' ? `${entry.name}/${sub.name}` : `${safeDir}/${entry.name}/${sub.name}`;
                files.push(rel);
              }
            }
          } catch {
            // Sub-directory not readable
          }
        }
      }

      return files.sort();
    } catch {
      // Directory doesn't exist — return known defaults
      if (safeDir === '.' || safeDir === '') {
        return [...PERSONA_FILES];
      }
      return [];
    }
  }

  /**
   * Get all persona files (with content) for the Persona Editor.
   * Reads directly from host filesystem for reliability.
   */
  async getPersonaFiles(
    agentId: string,
    userId: string,
    organizationId?: string
  ): Promise<WorkspaceFile[]> {
    const files: WorkspaceFile[] = [];

    for (const filename of PERSONA_FILES) {
      try {
        const file = await this.readFile(agentId, userId, filename, organizationId);
        files.push(file);
      } catch {
        // File doesn't exist yet — return empty placeholder
        files.push({ filename, content: '', size: 0 });
      }
    }

    return files;
  }

  /**
   * List memory files: MEMORY.md (root) + memory/YYYY-MM-DD.md (daily logs)
   */
  async listMemoryFiles(
    agentId: string,
    userId: string,
    organizationId?: string
  ): Promise<string[]> {
    const memoryDirFiles = await this.listFiles(agentId, userId, MEMORY_DIR, organizationId);

    // Also include MEMORY.md from workspace root if it exists
    const wsPath = await this.getWorkspacePath(agentId, userId, organizationId);
    const memoryMdPath = join(wsPath, 'MEMORY.md');
    try {
      await stat(memoryMdPath);
      return ['MEMORY.md', ...memoryDirFiles];
    } catch {
      return memoryDirFiles;
    }
  }

  /**
   * Read a memory file
   */
  async readMemoryFile(
    agentId: string,
    userId: string,
    filePath: string,
    organizationId?: string
  ): Promise<WorkspaceFile> {
    // Validate and sanitize path — must be within memory/ or be MEMORY.md/memory.md
    if (filePath === 'MEMORY.md' || filePath === 'memory.md') {
      return this.readFile(agentId, userId, filePath, organizationId);
    }
    const safePath = sanitizeFilePath(filePath, ['memory/']);
    return this.readFile(agentId, userId, safePath, organizationId);
  }

  /**
   * Write a memory file
   */
  async writeMemoryFile(
    agentId: string,
    userId: string,
    filePath: string,
    content: string,
    organizationId?: string
  ): Promise<void> {
    if (filePath === 'MEMORY.md' || filePath === 'memory.md') {
      await this.writeFile(agentId, userId, filePath, content, organizationId);
      return;
    }
    const safePath = sanitizeFilePath(filePath, ['memory/']);
    await this.writeFile(agentId, userId, safePath, content, organizationId);
  }

  /**
   * Delete a memory file — directly from host filesystem.
   */
  async deleteMemoryFile(
    agentId: string,
    userId: string,
    filePath: string,
    organizationId?: string
  ): Promise<void> {
    let safePath: string;
    if (filePath === 'MEMORY.md' || filePath === 'memory.md') {
      safePath = filePath;
    } else {
      safePath = sanitizeFilePath(filePath, ['memory/']);
    }

    const wsPath = await this.getWorkspacePath(agentId, userId, organizationId);
    const fullPath = join(wsPath, safePath);

    try {
      await unlink(fullPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') return; // Already deleted
      throw err;
    }
  }

  /**
   * Search agent memory using the new RAG Knowledge Engine (MongoDB Vector Search),
   * with fallback to OpenClaw's built-in embedding search via Gateway WS.
   */
  async searchMemory(
    agentId: string,
    _userId: string,
    query: string,
    _organizationId?: string
  ): Promise<any[]> {
    // Try new RAG engine first (if org context available)
    if (_organizationId) {
      try {
        const { searchKnowledge } = await import('./knowledge.service.js');
        const results = await searchKnowledge({ organizationId: _organizationId, query, limit: 5 });
        if (results.length > 0) {
          return results.map(r => ({ text: r.text, score: r.score, file: r.sourceName, source: 'knowledge_hub' }));
        }
      } catch (error) {
        console.warn(`[workspace] Knowledge Hub search failed for agent ${agentId}:`, error);
      }
    }

    // Fallback: OpenClaw Gateway WS memory search
    try {
      const { gatewayManager } = await import('./gateway-ws.service.js');
      const client = gatewayManager.getClient(agentId);
      if (client?.isConnected()) {
        const results = await client.memorySearch(query, { limit: 10 });
        return results;
      }
    } catch (error) {
      console.warn(`[workspace] Memory search via Gateway WS failed for agent ${agentId}:`, error);
    }

    return [];
  }
  // ── Knowledge Management ────────────────────────────────────────

  private static KNOWLEDGE_DIR = 'knowledge';

  /**
   * List all knowledge files for an agent.
   */
  async listKnowledgeFiles(
    agentId: string,
    userId: string,
    organizationId?: string
  ): Promise<{ filename: string; size: number; type: 'upload' | 'url' | 'manual' | 'system' }[]> {
    const wsPath = await this.getWorkspacePath(agentId, userId, organizationId);
    const knowledgeDir = join(wsPath, WorkspaceService.KNOWLEDGE_DIR);

    const results: { filename: string; size: number; type: 'upload' | 'url' | 'manual' | 'system' }[] = [];

    // List knowledge/ directory
    try {
      const entries = await readdir(knowledgeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        try {
          const fileStat = await stat(join(knowledgeDir, entry.name));
          const type = entry.name.startsWith('url-') ? 'url'
            : entry.name === 'custom-notes.md' ? 'manual'
            : 'upload';
          results.push({ filename: `knowledge/${entry.name}`, size: fileStat.size, type });
        } catch { /* skip unreadable */ }
      }
    } catch {
      // Directory doesn't exist yet — that's OK
    }

    // Also include MEMORY.md as system memory
    try {
      const memoryPath = join(wsPath, 'MEMORY.md');
      const memoryStat = await stat(memoryPath);
      results.push({ filename: 'MEMORY.md', size: memoryStat.size, type: 'system' });
    } catch { /* no MEMORY.md */ }

    return results;
  }

  /**
   * Write a knowledge file (plain text or converted content).
   */
  async writeKnowledgeFile(
    agentId: string,
    userId: string,
    filename: string,
    content: string,
    organizationId?: string
  ): Promise<void> {
    const safeName = sanitizeFilePath(`knowledge/${filename}`, ['knowledge/']);
    await this.writeFile(agentId, userId, safeName, content, organizationId);
  }

  /**
   * Delete a knowledge file.
   */
  async deleteKnowledgeFile(
    agentId: string,
    userId: string,
    filename: string,
    organizationId?: string
  ): Promise<void> {
    const safeName = sanitizeFilePath(filename, ['knowledge/']);
    const wsPath = await this.getWorkspacePath(agentId, userId, organizationId);
    const fullPath = join(wsPath, safeName);

    try {
      await unlink(fullPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * Crawl a URL and save as knowledge file using Gateway web_fetch if available,
   * or a simple HTTP fetch fallback.
   */
  async crawlUrl(
    agentId: string,
    userId: string,
    url: string,
    organizationId?: string
  ): Promise<{ filename: string; size: number }> {
    let content = '';

    // Try Gateway web_fetch first
    try {
      const { gatewayManager } = await import('./gateway-ws.service.js');
      const client = gatewayManager.getClient(agentId);
      if (client?.isConnected()) {
        const result = await client.request('tools.invoke', { tool: 'web_fetch', args: { url } });
        if (result?.output) {
          content = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
        }
      }
    } catch {
      // Gateway not available
    }

    // Fallback: simple HTTP fetch
    if (!content) {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Havoc Knowledge Bot/1.0' },
          signal: AbortSignal.timeout(15000),
        });
        content = await response.text();
        // Basic HTML to text conversion (strip tags)
        content = content
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      } catch (err) {
        throw new Error(`Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Generate filename from URL
    const urlObj = new URL(url);
    const safeDomain = urlObj.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `url-${safeDomain}.md`;

    // Prepend source header
    const fullContent = `<!-- Source: ${url} -->\n<!-- Crawled: ${new Date().toISOString()} -->\n\n${content}`;

    await this.writeKnowledgeFile(agentId, userId, filename, fullContent, organizationId);

    return { filename: `knowledge/${filename}`, size: fullContent.length };
  }

  // ── Persona File Regeneration ─────────────────────────────────

  /**
   * Regenerate persona files (AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md, USER.md, HEARTBEAT.md)
   * for a running agent. Called after config/name/description changes so the
   * agent's workspace files stay in sync with the DB config.
   *
   * Only overwrites the standard persona files — never touches MEMORY.md or memory/*.
   */
  async regeneratePersonaFiles(agentId: string): Promise<{ updated: string[]; errors: string[] }> {
    // Load agent from DB to get latest config
    const agent = await this.agentsCollection.findOne({ _id: new ObjectId(agentId) as any });
    if (!agent) throw new Error('Agent not found');

    // Channels come from agent_channels (not agent.channels) — includes Superchat, WhatsApp, etc.
    const channelsFromDb = await getDatabase().collection('agent_channels').find({ agentId }).toArray();
    const channelTypes = channelsFromDb.map((c: any) => c.type);

    // Build template data from current DB state
    const agentConfig = agent.config as Record<string, unknown> | undefined;
    const templateData: WorkspaceTemplateData = {
      agentName: agent.name as string,
      agentDescription: agent.description as string,
      systemPrompt: agent.config?.systemPrompt || 'You are a helpful AI assistant.',
      soulPrompt: agent.config?.soulPrompt,
      identityName: agent.config?.identityName || agent.name,
      useCase: agent.useCase as string,
      channels: channelTypes,
      skills: agent.config?.skills || [],
      organizationName: (agent as any).organizationName,
      userName: (agent as any).userName,
      heartbeatTasks: (agent as any).heartbeatTasks,
      lobsterEnabled: !!(agentConfig as any)?.lobsterEnabled,
      availableTools: {
        webSearch: true,
        webFetch: true,
        browser: !!(agentConfig?.browserEnabled),
        message: true,
        exec: true,
        gateway: true,
        cron: true,
        memory: true,
        fileSystem: true,
        superchatSend: channelTypes.includes('superchat'),
      },
    };

    const workspaceFiles = generateWorkspaceFiles(templateData);

    // Write directly to host filesystem (bind-mounted into container)
    const wsPath = join(config.openclawWorkspaceDir, agentId, 'workspace');
    const updated: string[] = [];
    const errors: string[] = [];

    for (const [filename, content] of Object.entries(workspaceFiles)) {
      try {
        await fsWriteFile(join(wsPath, filename), content, 'utf-8');
        updated.push(filename);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[workspace] Failed to write ${filename} for agent ${agentId}: ${msg}`);
        errors.push(`${filename}: ${msg}`);
      }
    }

    console.log(`[workspace] Persona files regenerated for agent ${agentId}: ${updated.length} updated, ${errors.length} failed`);
    return { updated, errors };
  }
}

export const workspaceService = new WorkspaceService();
