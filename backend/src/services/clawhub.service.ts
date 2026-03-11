// ClawHub Service - Manages skill discovery, installation, and security
// Uses the real ClawHub V1 API with full VirusTotal security verification
// Gateway WS RPCs for live install/uninstall/toggle when the agent is running
// Includes periodic post-install security re-scanning

import { getDatabase } from '../config/database.js';
import { deploymentService } from './deployment.service.js';
import { gatewayManager } from './gateway-ws.service.js';
import { clawHubApiClient } from './clawhub-api.client.js';
import type { ClawHubSkill, SkillEntry, SkillSecurityInfo } from '@openclaw-business/shared';

// ── Types ───────────────────────────────────────────────────────

export interface InstalledSkill {
  agentId: string;
  userId: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  enabled: boolean;
  env: Record<string, string>;
  apiKey?: string;
  installedAt: Date;
  /** Security verdict at time of installation */
  securityVerdict?: string;
  /** Warnings acknowledged by user at install time */
  securityWarnings?: string[];
  /** When the last security re-scan was performed */
  lastRescanAt?: Date;
  /** Whether this skill was auto-disabled by the security re-scanner */
  autoDisabled?: boolean;
  /** Reason for auto-disable */
  autoDisableReason?: string;
  /** Least-privilege tool permissions (e.g. ['group:fs', 'web_search']). Empty = unrestricted. */
  permissions?: string[];
}

// ── Category → Tag Mapping ──────────────────────────────────────
// ClawHub uses free-form tags, our UI has fixed categories.
// Map each UI category to tag keywords for server-side filtering.

const CATEGORY_TAG_MAP: Record<string, string[]> = {
  productivity: ['productivity', 'calendar', 'email', 'notes', 'tasks', 'todo', 'office', 'notion', 'sheets'],
  development: ['development', 'dev', 'coding', 'code', 'git', 'github', 'docker', 'ci', 'deploy', 'api'],
  communication: ['communication', 'chat', 'messaging', 'slack', 'discord', 'telegram', 'whatsapp', 'sms'],
  search: ['search', 'web', 'browser', 'google', 'scrape', 'crawl', 'fetch'],
  data: ['data', 'database', 'sql', 'analytics', 'csv', 'json', 'storage', 'file'],
  creative: ['creative', 'image', 'audio', 'video', 'music', 'art', 'design', 'media'],
  automation: ['automation', 'cron', 'workflow', 'schedule', 'trigger', 'webhook', 'ifttt'],
  memory: ['memory', 'knowledge', 'rag', 'embedding', 'vector', 'recall'],
};

// ── Default Skill Permissions ───────────────────────────────────
// Maps skill categories to least-privilege tool groups.
// Skills without a matching category get no restrictions (backward compat).
const CATEGORY_PERMISSIONS: Record<string, string[]> = {
  search:        ['group:web'],
  memory:        ['group:memory', 'group:fs'],
  data:          ['group:fs'],
  creative:      ['group:fs', 'group:web'],
  communication: ['group:messaging'],
  automation:    ['group:automation', 'group:fs'],
  productivity:  ['group:fs', 'group:web', 'group:runtime'],
  development:   ['group:fs', 'group:runtime', 'group:web'],
};

// ── ClawHub Service ─────────────────────────────────────────────

/** Derive least-privilege permissions from skill tags/category */
function derivePermissions(tags: string[]): string[] | undefined {
  const lowerTags = tags.map(t => t.toLowerCase());
  const perms = new Set<string>();
  for (const [category, keywords] of Object.entries(CATEGORY_TAG_MAP)) {
    if (lowerTags.some(t => keywords.includes(t))) {
      for (const p of CATEGORY_PERMISSIONS[category] || []) perms.add(p);
    }
  }
  return perms.size > 0 ? [...perms] : undefined;
}

export class ClawHubService {
  private indexesEnsured = false;

  private get collection() {
    return getDatabase().collection<InstalledSkill>('agent_skills');
  }

  /**
   * Ensure MongoDB indexes exist for fast queries.
   * Called once lazily on first DB access.
   */
  async ensureIndexes(): Promise<void> {
    if (this.indexesEnsured) return;
    try {
      const col = this.collection;
      await Promise.all([
        // Unique compound: one skill per agent
        col.createIndex({ agentId: 1, slug: 1 }, { unique: true, background: true }),
        // Fast lookup for agent's installed skills
        col.createIndex({ agentId: 1, userId: 1, installedAt: -1 }, { background: true }),
        // Re-scanner: find all enabled skills
        col.createIndex({ enabled: 1, slug: 1 }, { background: true }),
        // Admin: find auto-disabled / suspicious
        col.createIndex({ autoDisabled: 1 }, { sparse: true, background: true }),
        col.createIndex({ securityVerdict: 1, enabled: 1 }, { background: true }),
      ]);
      this.indexesEnsured = true;
      console.log('[clawhub] MongoDB indexes ensured for agent_skills');
    } catch (error) {
      // Non-fatal: indexes may already exist or partial failure
      console.warn('[clawhub] Index creation warning:', error instanceof Error ? error.message : error);
      this.indexesEnsured = true;
    }
  }

  // ── Trending Cache ──────────────────────────────────────────────
  // Cache the full trending list (fetched once) and filter locally.
  // Avoids repeated ClawHub API calls when switching categories.

  private trendingCache: { skills: ClawHubSkill[]; fetchedAt: number } | null = null;
  private trendingFetchPromise: Promise<ClawHubSkill[]> | null = null;

  /**
   * Get the full trending skills list (cached for TRENDING_CACHE_TTL_MS).
   * Coalesces concurrent requests into a single fetch.
   */
  private async getTrendingSkills(): Promise<ClawHubSkill[]> {
    const now = Date.now();

    // Return from cache if fresh
    if (this.trendingCache && (now - this.trendingCache.fetchedAt) < TRENDING_CACHE_TTL_MS) {
      return this.trendingCache.skills;
    }

    // Coalesce concurrent requests
    if (this.trendingFetchPromise) {
      return this.trendingFetchPromise;
    }

    this.trendingFetchPromise = (async () => {
      try {
        const result = await clawHubApiClient.listSkills({ limit: 100, sort: 'trending' });
        this.trendingCache = { skills: result.skills, fetchedAt: Date.now() };
        return result.skills;
      } finally {
        this.trendingFetchPromise = null;
      }
    })();

    return this.trendingFetchPromise;
  }

  /**
   * Browse available skills from the real ClawHub registry.
   * - Search: uses ClawHub vector search (semantic)
   * - Browse: uses cached trending list with local category filtering
   */
  async browseSkills(params?: {
    category?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ skills: ClawHubSkill[]; total: number; categories: string[] }> {
    const limit = params?.limit || 20;

    let skills: ClawHubSkill[];

    // If search query provided, use vector search (ClawHub handles ranking)
    if (params?.search?.trim()) {
      skills = await clawHubApiClient.searchSkills(params.search, limit);
    } else {
      // Use cached trending list — single fetch, filter locally
      const trending = await this.getTrendingSkills();
      skills = trending;
    }

    // Apply category filter (fast local filtering on cached data)
    if (params?.category && params.category !== 'all') {
      const tagKeywords = CATEGORY_TAG_MAP[params.category] || [params.category];
      // Pre-build a Set for O(1) tag lookups
      const kwSet = new Set(tagKeywords);
      skills = skills.filter(skill => {
        const skillTags = (skill.tags || []).map(t => t.toLowerCase());
        if (skillTags.some(t => kwSet.has(t))) return true;
        const desc = (skill.description || '').toLowerCase();
        const name = (skill.name || '').toLowerCase();
        return tagKeywords.some(kw => desc.includes(kw) || name.includes(kw));
      });
    }

    // Pagination
    const offset = params?.offset || 0;
    const total = skills.length;
    skills = skills.slice(offset, offset + limit);

    return {
      skills,
      total,
      categories: SKILL_CATEGORIES,
    };
  }

  /**
   * Get a single skill by slug with full security info.
   */
  async getSkill(slug: string): Promise<ClawHubSkill | null> {
    return clawHubApiClient.getSkillDetail(slug);
  }

  /**
   * Validate skill slugs against ClawHub registry. Returns only slugs that exist.
   * Use before saving agent config or deploying — filters out hallucinated/invalid slugs.
   */
  async validateSkillSlugs(slugs: string[]): Promise<string[]> {
    if (!slugs?.length) return [];
    const unique = [...new Set(slugs.map(s => (s || '').trim()).filter(Boolean))];
    const results = await Promise.all(
      unique.map(async slug => ({ slug, exists: !!(await clawHubApiClient.getSkillDetail(slug)) }))
    );
    const valid = results.filter(r => r.exists).map(r => r.slug);
    if (valid.length < unique.length) {
      const dropped = unique.filter(s => !valid.includes(s));
      console.log(`[clawhub] Filtered invalid skill slugs (not in registry): ${dropped.join(', ')}`);
    }
    return valid;
  }

  /**
   * Pre-install security check — MUST pass before installation.
   * Combines ClawHub moderation status + VirusTotal analysis.
   */
  async securityCheck(slug: string): Promise<{
    allowed: boolean;
    security: SkillSecurityInfo;
    warnings: string[];
    skill: ClawHubSkill | null;
  }> {
    return clawHubApiClient.preInstallSecurityCheck(slug);
  }

  /**
   * Get the SKILL.md content for a skill (for pre-install review).
   */
  async getSkillReadme(slug: string): Promise<string | null> {
    return clawHubApiClient.getSkillFile(slug, 'SKILL.md');
  }

  /**
   * Parse SKILL.md to extract requirements (env vars, primaryEnv).
   * Used to enforce "configure before enable" for skills that need API keys.
   */
  async getSkillRequirements(slug: string): Promise<{ envVars: string[]; primaryEnv: string | null }> {
    const readme = await clawHubApiClient.getSkillFile(slug, 'SKILL.md');
    if (!readme) return { envVars: [], primaryEnv: null };

    const envVars: string[] = [];
    let primaryEnv: string | null = null;

    try {
      const fmMatch = readme.match(/^---\s*\n([\s\S]*?)\n---/m);
      if (!fmMatch) return { envVars: [], primaryEnv: null };

      const frontmatter = fmMatch[1];

      // Only parse env/primaryEnv from metadata.openclaw.requires — avoid false positives
      // from other "env:" keys (install.env, etc.). Extract the requires block.
      const requiresBlockMatch = frontmatter.match(/\brequires\s*:\s*\n([\s\S]*?)(?=\n\s{0,4}[a-zA-Z_#]|\n---|\Z)/);
      const searchIn = requiresBlockMatch ? requiresBlockMatch[1] : '';

      // metadata.openclaw.requires.env: ["VAR1","VAR2"]
      const envArrMatch = searchIn.match(/\benv\s*:\s*\[([^\]]*)\]/m);
      if (envArrMatch) {
        const inner = envArrMatch[1];
        const items = [...inner.matchAll(/["']([^"']+)["']|([A-Za-z_][A-Za-z0-9_]*)/g)]
          .map((m) => m[1] || m[2])
          .filter(Boolean);
        for (const v of items) if (!envVars.includes(v)) envVars.push(v);
      }
      // primaryEnv can be in requires or at metadata.openclaw level — check both
      const primaryMatch =
        searchIn.match(/primaryEnv\s*:\s*["']([^"']+)["']/m) ||
        searchIn.match(/primaryEnv\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/m) ||
        frontmatter.match(/primaryEnv\s*:\s*["']([^"']+)["']/m) ||
        frontmatter.match(/primaryEnv\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/m);
      if (primaryMatch) {
        primaryEnv = primaryMatch[1];
        if (!envVars.includes(primaryEnv)) envVars.unshift(primaryEnv);
      }
    } catch {
      // Parse failed
    }

    return { envVars: [...new Set(envVars)], primaryEnv };
  }

  /**
   * Install a skill for an agent.
   * Runs pre-install security check, then persists to DB and syncs to Gateway.
   */
  async installSkill(
    agentId: string,
    userId: string,
    slug: string,
    env?: Record<string, string>,
    apiKey?: string,
    /** If true, skips security check (user acknowledged warnings) */
    acknowledgedWarnings?: boolean
  ): Promise<InstalledSkill> {
    // 1. Run security check
    const check = await this.securityCheck(slug);

    // 2. Block malicious skills — no override possible
    if (!check.allowed) {
      const reason = check.warnings.join(' ');
      throw new Error(`SECURITY_BLOCKED: ${reason}`);
    }

    // 3. If there are warnings and user hasn't acknowledged, require confirmation
    if (check.warnings.length > 0 && !acknowledgedWarnings) {
      const error = new Error('SECURITY_WARNING');
      (error as any).warnings = check.warnings;
      (error as any).security = check.security;
      throw error;
    }

    // 4. Get full skill info
    const skill = check.skill;
    if (!skill) {
      throw new Error(`Skill not found: ${slug}`);
    }

    // 5. Check if already installed — upsert instead of failing
    const existing = await this.collection.findOne({ agentId, slug });
    if (existing) {
      // Update env/apiKey if provided, keep existing data
      const updates: any = {};
      if (env && Object.keys(env).length > 0) updates.env = { ...existing.env, ...env };
      if (apiKey) updates.apiKey = apiKey;
      if (Object.keys(updates).length > 0) {
        await this.collection.updateOne({ agentId, slug }, { $set: updates });
      }
      await this.gatewaySkillSync(agentId, 'install', slug, { env: env || existing.env, apiKey: apiKey || existing.apiKey, enabled: existing.enabled });
      return { ...existing, ...updates } as InstalledSkill;
    }

    // 6. Persist to DB
    const installed: InstalledSkill = {
      agentId,
      userId,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      tags: skill.tags || [],
      enabled: true,
      env: env || {},
      apiKey,
      installedAt: new Date(),
      securityVerdict: check.security.verdict,
      securityWarnings: check.warnings.length > 0 ? check.warnings : undefined,
      permissions: derivePermissions(skill.tags || []),
    };

    await this.collection.insertOne(installed as any);

    // 7. Try to install via Gateway WS RPC (live update)
    await this.gatewaySkillSync(agentId, 'install', slug, { env, apiKey, enabled: true });

    // 8. Sync full config as fallback
    await this.syncSkillsToConfig(agentId);

    console.log(`[clawhub] Installed skill ${slug} for agent ${agentId} (verdict: ${check.security.verdict})`);
    return installed;
  }

  /**
   * Uninstall a skill from an agent
   */
  async uninstallSkill(agentId: string, userId: string, slug: string): Promise<void> {
    const result = await this.collection.deleteOne({ agentId, userId, slug });
    if (result.deletedCount === 0) {
      throw new Error('Skill not found');
    }

    // Disable via Gateway WS RPC
    await this.gatewaySkillSync(agentId, 'disable', slug);

    await this.syncSkillsToConfig(agentId);
  }

  /**
   * Toggle skill enabled/disabled.
   * When enabling: enforces configure-before-enable — skill must have required env/apiKey filled.
   */
  async toggleSkill(agentId: string, userId: string, slug: string, enabled: boolean): Promise<void> {
    if (enabled) {
      const doc = await this.collection.findOne({ agentId, userId, slug });
      if (!doc) throw new Error('Skill not found');

      const req = await this.getSkillRequirements(slug);
      if (req.envVars.length > 0 || req.primaryEnv) {
        const allFilled = req.envVars.every((k) => {
          if (k === req.primaryEnv) return !!String(doc.apiKey ?? '').trim();
          return !!String(doc.env?.[k] ?? '').trim();
        });
        if (!allFilled) {
          const err = new Error('Configure skill first (API key or env vars) before enabling.');
          (err as any).code = 'CONFIG_REQUIRED';
          throw err;
        }
      }
    }

    const result = await this.collection.updateOne(
      { agentId, userId, slug },
      { $set: { enabled } }
    );

    if (result.matchedCount === 0) {
      throw new Error('Skill not found');
    }

    // Toggle via Gateway WS RPC
    await this.gatewaySkillSync(agentId, 'toggle', slug, { enabled });

    await this.syncSkillsToConfig(agentId);
  }

  /**
   * Update skill env/apiKey
   */
  async updateSkillConfig(
    agentId: string,
    userId: string,
    slug: string,
    updates: { env?: Record<string, string>; apiKey?: string }
  ): Promise<void> {
    const setFields: any = {};
    if (updates.env) setFields.env = updates.env;
    if (updates.apiKey !== undefined) setFields.apiKey = updates.apiKey;

    const result = await this.collection.updateOne(
      { agentId, userId, slug },
      { $set: setFields }
    );

    if (result.matchedCount === 0) {
      throw new Error('Skill not found');
    }

    // Update via Gateway WS RPC
    await this.gatewaySkillSync(agentId, 'update', slug, updates);

    await this.syncSkillsToConfig(agentId);
  }

  /**
   * Get installed skills for an agent
   */
  async getInstalledSkills(agentId: string, userId: string): Promise<InstalledSkill[]> {
    return this.collection.find({ agentId, userId }).sort({ installedAt: -1 }).toArray();
  }

  /**
   * Install all configured skills into the running gateway. Called when the gateway
   * connects (container just became ready). Fixes race: deploy completes in ~10s,
   * but container needs ~45s to boot — auto-install at 3s misses the connection.
   * Only attempts install for skills that exist in ClawHub (filters invalid/hallucinated slugs).
   */
  async installSkillsWhenGatewayReady(agentId: string): Promise<void> {
    const installed = await this.collection.find({ agentId, enabled: true }).toArray();
    if (installed.length === 0) return;
    const validSlugs = await this.validateSkillSlugs(installed.map(s => s.slug));
    if (validSlugs.length === 0) return;
    for (const skill of installed) {
      if (!validSlugs.includes(skill.slug)) continue; // Skip invalid/hallucinated slugs
      try {
        await this.gatewaySkillSync(agentId, 'install', skill.slug, {
          env: skill.env,
          apiKey: skill.apiKey ?? undefined,
        });
        console.log(`[clawhub] Gateway-ready: installed skill "${skill.slug}" for agent ${agentId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/skill not found|UNAVAILABLE|not found/i.test(msg)) {
          continue; // Skill may not exist in ClawHub, skip
        }
        console.warn(`[clawhub] Gateway-ready install failed for ${agentId}/${skill.slug}:`, msg);
      }
    }
  }

  /**
   * Get live skills status from the running gateway (eligible, installed, etc.)
   */
  async getGatewaySkills(agentId: string): Promise<any> {
    try {
      const client = gatewayManager.getClient(agentId);
      if (client?.isConnected()) {
        return await client.skillsList();
      }
    } catch (error) {
      console.error(`Failed to get gateway skills for agent ${agentId}:`, error);
    }
    return null;
  }

  /**
   * Sync a skill action to the running gateway via WS RPC
   */
  private async gatewaySkillSync(
    agentId: string,
    action: 'install' | 'disable' | 'toggle' | 'update',
    slug: string,
    data?: { enabled?: boolean; env?: Record<string, string>; apiKey?: string }
  ): Promise<void> {
    try {
      const client = gatewayManager.getClient(agentId);
      if (!client?.isConnected()) return;

      switch (action) {
        case 'install':
          // Skip skillsInstall: OpenClaw RPC "Installer not found" for clawhub: slugs.
          // Entrypoint does `clawhub install` on container start; skills.entries in config.
          // Only sync apiKey/env via skillsUpdate — avoids gateway log spam.
          if (data?.apiKey || data?.env) {
            await client.skillsUpdate(slug, { apiKey: data.apiKey, env: data.env });
          }
          break;
        case 'disable':
          await client.skillsToggle(slug, false);
          break;
        case 'toggle':
          if (data?.enabled !== undefined) {
            await client.skillsToggle(slug, data.enabled);
          }
          break;
        case 'update':
          await client.skillsUpdate(slug, { apiKey: data?.apiKey, env: data?.env });
          break;
      }
    } catch (error) {
      // Non-fatal: DB is the source of truth, gateway sync is best-effort
      const msg = error instanceof Error ? error.message : String(error);
      // Skill not found / UNAVAILABLE: OpenClaw may not have the skill (needs clawhub install in workspace)
      if (/skill not found|UNAVAILABLE|not found/i.test(msg)) {
        // Config sync (syncSkillsToConfig) still writes skills.entries; skill files may need clawhub install
        return;
      }
      console.error(`Gateway skill sync failed for agent ${agentId}/${slug}:`, error);
    }
  }

  /**
   * Sync installed skills to the OpenClaw config
   */
  /** Skill slugs known to not exist in ClawHub — filter to avoid gateway "Skill not found" log spam */
  private static readonly INVALID_SKILL_SLUGS = new Set(['firecrawl-skills', 'core-pa-admin-exec-support']);

  private async syncSkillsToConfig(agentId: string): Promise<void> {
    try {
      const installed = await this.collection.find({ agentId }).toArray();
      const entries: Record<string, SkillEntry> = {};

      for (const skill of installed) {
        if (ClawHubService.INVALID_SKILL_SLUGS.has(skill.slug)) continue;
        const entry: SkillEntry = {
          enabled: skill.enabled,
          env: skill.env,
        };
        // Only include apiKey if it's a non-null string (OpenClaw rejects null)
        if (typeof skill.apiKey === 'string' && skill.apiKey.length > 0) {
          entry.apiKey = skill.apiKey;
        }
        entries[skill.slug] = entry;
      }

      await deploymentService.updateAgentConfig(agentId, {
        skills: {
          entries,
          load: { watch: true },
        },
      });
    } catch (error) {
      console.error(`Failed to sync skills for agent ${agentId}:`, error);
    }
  }

  /**
   * Resync skills config for ALL agents that have installed skills.
   * Called once at startup to fix any stale null values in configs.
   * Only syncs agents whose config file actually exists on disk.
   */
  private async resyncAllAgentSkillConfigs(): Promise<void> {
    const { access } = await import('fs/promises');
    const { join } = await import('path');
    const { config } = await import('../config/env.js');

    const allSkills = await this.collection.find({}).toArray();
    const agentIds = new Set(allSkills.map(s => s.agentId));
    if (agentIds.size === 0) return;

    // Only resync agents that have a config file on disk
    const validAgentIds: string[] = [];
    for (const agentId of agentIds) {
      const configPath = join(config.openclawWorkspaceDir, agentId, 'openclaw.json');
      try {
        await access(configPath);
        validAgentIds.push(agentId);
      } catch {
        // No config file — agent was deleted or never deployed, skip
      }
    }

    if (validAgentIds.length === 0) return;
    console.log(`[clawhub] Resyncing skills config for ${validAgentIds.length} agents (${agentIds.size - validAgentIds.length} skipped — no config)`);
    await Promise.allSettled(
      validAgentIds.map(agentId => this.syncSkillsToConfig(agentId))
    );
  }

  // ── Post-Install Security Re-Scanner ──────────────────────────

  private rescanTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start the periodic security re-scanner.
   * Runs every RESCAN_INTERVAL_MS and checks all enabled installed skills
   * against the latest ClawHub moderation status.
   * Auto-disables malicious skills and logs suspicious ones.
   */
  startRescanTimer(): void {
    if (this.rescanTimer) return;
    const intervalMs = RESCAN_INTERVAL_MS;
    console.log(`[clawhub] Security re-scanner started (interval: ${intervalMs / 60_000}min)`);
    this.rescanTimer = setInterval(() => {
      this.rescanAllInstalledSkills().catch(err =>
        console.error('[clawhub] Re-scan sweep failed:', err)
      );
    }, intervalMs);

    // Also run once shortly after startup (30s delay to let DB connect)
    setTimeout(() => {
      // Resync all skills configs to strip any stale null values
      this.resyncAllAgentSkillConfigs().catch(err =>
        console.error('[clawhub] Startup skills config resync failed:', err)
      );
      this.rescanAllInstalledSkills().catch(err =>
        console.error('[clawhub] Initial re-scan failed:', err)
      );
    }, 30_000);
  }

  stopRescanTimer(): void {
    if (this.rescanTimer) {
      clearInterval(this.rescanTimer);
      this.rescanTimer = null;
      console.log('[clawhub] Security re-scanner stopped');
    }
  }

  /**
   * Re-scan ALL installed & enabled skills across all agents.
   * Queries ClawHub for the latest moderation status and auto-disables
   * any skills that have been newly flagged as malicious.
   */
  async rescanAllInstalledSkills(): Promise<{
    scanned: number;
    disabled: number;
    warnings: number;
    errors: number;
  }> {
    const stats = { scanned: 0, disabled: 0, warnings: 0, errors: 0 };

    try {
      // Get all enabled installed skills
      const enabledSkills = await this.collection.find({ enabled: true }).toArray();
      if (enabledSkills.length === 0) return stats;

      // Deduplicate slugs (same skill installed on multiple agents)
      const slugSet = new Set(enabledSkills.map(s => s.slug));
      const slugs = Array.from(slugSet);

      console.log(`[clawhub] Re-scanning ${slugs.length} unique skills (${enabledSkills.length} installations)`);

      // Check each unique slug against ClawHub moderation
      const verdictMap = new Map<string, { verdict: string; isMalwareBlocked: boolean; isSuspicious: boolean }>();

      for (const slug of slugs) {
        try {
          const detail = await clawHubApiClient.getSkillDetail(slug);
          if (detail?.security) {
            verdictMap.set(slug, {
              verdict: detail.security.verdict,
              isMalwareBlocked: detail.security.isMalwareBlocked,
              isSuspicious: detail.security.isSuspicious,
            });
          } else {
            // Skill removed from registry — treat as suspicious
            verdictMap.set(slug, { verdict: 'unknown', isMalwareBlocked: false, isSuspicious: true });
          }
          stats.scanned++;
        } catch {
          stats.errors++;
        }
      }

      // Process results using bulkWrite for performance
      const agentsToResync = new Set<string>();
      const bulkOps: any[] = [];
      const gatewayDisables: Array<{ agentId: string; slug: string }> = [];
      const now = new Date();

      for (const skill of enabledSkills) {
        const moderation = verdictMap.get(skill.slug);
        if (!moderation) continue;

        // AUTO-DISABLE: Malicious skills
        if (moderation.isMalwareBlocked || moderation.verdict === 'malicious') {
          bulkOps.push({
            updateOne: {
              filter: { agentId: skill.agentId, slug: skill.slug },
              update: {
                $set: {
                  enabled: false,
                  autoDisabled: true,
                  autoDisableReason: `Auto-disabled by security re-scan: skill flagged as malicious by ClawHub moderation (${now.toISOString()})`,
                  securityVerdict: 'malicious',
                  lastRescanAt: now,
                },
              },
            },
          });
          gatewayDisables.push({ agentId: skill.agentId, slug: skill.slug });
          agentsToResync.add(skill.agentId);
          console.warn(`[clawhub] AUTO-DISABLED malicious skill "${skill.slug}" for agent ${skill.agentId}`);
          stats.disabled++;
          continue;
        }

        // WARN: Suspicious skills (don't auto-disable, but update verdict)
        if (moderation.isSuspicious || moderation.verdict === 'suspicious') {
          if (skill.securityVerdict !== 'suspicious') {
            console.warn(`[clawhub] Skill "${skill.slug}" for agent ${skill.agentId} newly flagged as suspicious`);
            stats.warnings++;
          }
          bulkOps.push({
            updateOne: {
              filter: { agentId: skill.agentId, slug: skill.slug },
              update: { $set: { securityVerdict: 'suspicious', lastRescanAt: now } },
            },
          });
          continue;
        }

        // Clean skills: just update timestamp + verdict
        bulkOps.push({
          updateOne: {
            filter: { agentId: skill.agentId, slug: skill.slug },
            update: { $set: { lastRescanAt: now, securityVerdict: moderation.verdict } },
          },
        });
      }

      // Execute all DB updates in one round-trip
      if (bulkOps.length > 0) {
        await this.collection.bulkWrite(bulkOps, { ordered: false });
      }

      // Disable malicious skills via Gateway WS (parallel)
      await Promise.allSettled(
        gatewayDisables.map(({ agentId, slug }) =>
          this.gatewaySkillSync(agentId, 'toggle', slug, { enabled: false })
        )
      );

      // Resync config for agents where skills were disabled
      await Promise.allSettled(
        Array.from(agentsToResync).map(agentId => this.syncSkillsToConfig(agentId))
      );

      if (stats.disabled > 0 || stats.warnings > 0) {
        console.log(`[clawhub] Re-scan complete: ${stats.scanned} scanned, ${stats.disabled} disabled, ${stats.warnings} warnings, ${stats.errors} errors`);
      }
    } catch (error) {
      console.error('[clawhub] Re-scan sweep error:', error);
    }

    return stats;
  }

  /**
   * Get re-scan status for admin/debug purposes
   */
  async getRescanStatus(): Promise<{
    autoDisabledSkills: InstalledSkill[];
    suspiciousSkills: InstalledSkill[];
    lastRescanAt: Date | null;
  }> {
    const autoDisabled = await this.collection.find({ autoDisabled: true }).toArray();
    const suspicious = await this.collection.find({
      enabled: true,
      securityVerdict: 'suspicious',
    }).toArray();

    // Find the most recent rescan timestamp
    const latest = await this.collection
      .find({ lastRescanAt: { $exists: true } })
      .sort({ lastRescanAt: -1 })
      .limit(1)
      .toArray();

    return {
      autoDisabledSkills: autoDisabled,
      suspiciousSkills: suspicious,
      lastRescanAt: latest[0]?.lastRescanAt || null,
    };
  }
}

// ── Constants ────────────────────────────────────────────────────

// Re-scan every 30 minutes
const RESCAN_INTERVAL_MS = 30 * 60 * 1000;

// Cache the full trending list for 5 minutes (browsing by category uses this)
const TRENDING_CACHE_TTL_MS = 5 * 60 * 1000;

// Categories for UI filtering
const SKILL_CATEGORIES = [
  'all', 'productivity', 'development', 'communication',
  'search', 'data', 'creative', 'automation', 'memory',
];

export const clawHubService = new ClawHubService();
