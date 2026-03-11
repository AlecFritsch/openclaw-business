// Knowledge Integrations Routes — Google Drive & Notion OAuth + sync

import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { serializeDoc } from '../../utils/sanitize.js';
import { signOAuthState, verifyOAuthState, sanitizeAgentId } from '../../utils/oauth-state.js';
import { config } from '../../config/env.js';
import { getGoogleAuthUrl, exchangeGoogleCode, listDriveFiles, downloadDriveFile, refreshGoogleToken } from '../../services/google-drive.service.js';
import { getNotionAuthUrl, exchangeNotionCode, listNotionPages, getNotionPageContent } from '../../services/notion.service.js';
import { ingestDocument } from '../../services/knowledge.service.js';
import { ObjectId } from 'mongodb';
import { validateObjectId } from '../../validation/schemas.js';

export async function knowledgeIntegrationRoutes(fastify: FastifyInstance) {

  // GET /api/knowledge/integrations — list connected integrations
  fastify.get<{ Querystring: { agentId?: string } }>('/integrations', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');
    const db = getDatabase();
    const integrations = await db.collection('knowledge_integrations')
      .find({ organizationId })
      .project({ accessToken: 0, refreshToken: 0 })
      .sort({ createdAt: -1 })
      .toArray();
    return { integrations: integrations.map(serializeDoc) };
  });

  // GET /api/knowledge/integrations/google/auth — get OAuth URL
  fastify.get<{ Querystring: { agentId?: string } }>('/integrations/google/auth', async (request, reply) => {
    const state = signOAuthState({
      orgId: request.organizationId,
      agentId: request.query.agentId,
      userId: request.userId,
    });
    return { url: getGoogleAuthUrl(state) };
  });

  // GET /api/knowledge/integrations/google/callback — OAuth redirect (returns popup HTML)
  // NOTE: This route needs to be public (no auth) — registered via knowledgeOAuthCallbackRoutes
  // (kept here as comment for reference)

  // POST /api/knowledge/integrations/google/callback — exchange code (from frontend)
  fastify.post<{ Body: { code: string; agentId?: string } }>('/integrations/google/callback', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');
    const { code, agentId } = request.body;
    if (!code) return reply.badRequest('code is required');

    const tokens = await exchangeGoogleCode(code);
    const db = getDatabase();
    const doc = {
      organizationId,
      agentId: null,
      type: 'google_drive' as const,
      label: 'Google Drive',
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      selectedItems: [] as string[],
      syncSchedule: null,
      lastSyncAt: null,
      nextSyncAt: null,
      createdBy: request.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { insertedId } = await db.collection('knowledge_integrations').insertOne(doc);
    return reply.status(201).send({ integration: serializeDoc({ ...doc, _id: insertedId, accessToken: undefined, refreshToken: undefined }) });
  });

  // GET /api/knowledge/integrations/notion/auth — get OAuth URL
  fastify.get<{ Querystring: { agentId?: string } }>('/integrations/notion/auth', async (request, reply) => {
    const state = signOAuthState({
      orgId: request.organizationId,
      agentId: request.query.agentId,
      userId: request.userId,
    });
    return { url: getNotionAuthUrl(state) };
  });

  // GET /api/knowledge/integrations/notion/callback — OAuth redirect
  // NOTE: This route needs to be public (no auth) — registered via knowledgeOAuthCallbackRoutes

  // POST /api/knowledge/integrations/notion/callback — exchange code (from frontend)
  fastify.post<{ Body: { code: string; agentId?: string } }>('/integrations/notion/callback', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');
    const { code, agentId } = request.body;
    if (!code) return reply.badRequest('code is required');

    const result = await exchangeNotionCode(code);
    const db = getDatabase();
    const doc = {
      organizationId,
      agentId: null,
      type: 'notion' as const,
      label: result.workspaceName,
      accessToken: encrypt(result.accessToken),
      selectedItems: [] as string[],
      syncSchedule: null,
      lastSyncAt: null,
      nextSyncAt: null,
      createdBy: request.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { insertedId } = await db.collection('knowledge_integrations').insertOne(doc);
    return reply.status(201).send({ integration: serializeDoc({ ...doc, _id: insertedId, accessToken: undefined }) });
  });

  // GET /api/knowledge/integrations/:id/items — list available items (pages/files) for selection
  fastify.get<{ Params: { id: string } }>('/integrations/:id/items', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');
    if (!validateObjectId(request.params.id)) return reply.badRequest('Invalid integration ID format');
    const db = getDatabase();
    const integration = await db.collection('knowledge_integrations').findOne({
      _id: new ObjectId(request.params.id),
      organizationId,
    });
    if (!integration) return reply.notFound('Integration not found');

    if (integration.type === 'google_drive') {
      let accessToken = decrypt(integration.accessToken);
      if (integration.refreshToken) {
        try {
          accessToken = await refreshGoogleToken(decrypt(integration.refreshToken));
          await db.collection('knowledge_integrations').updateOne(
            { _id: integration._id },
            { $set: { accessToken: encrypt(accessToken), updatedAt: new Date() } },
          );
        } catch { /* use existing */ }
      }
      const files = await listDriveFiles(accessToken);
      return {
        items: files.slice(0, 100).map((f: any) => ({ id: f.id, name: f.name, type: f.mimeType, modifiedTime: f.modifiedTime })),
        selectedItems: integration.selectedItems || [],
      };
    } else if (integration.type === 'notion') {
      const accessToken = decrypt(integration.accessToken);
      const pages = await listNotionPages(accessToken);
      return {
        items: pages.map(p => ({ id: p.id, name: p.title, type: 'page', modifiedTime: p.lastEdited })),
        selectedItems: integration.selectedItems || [],
      };
    }

    return { items: [], selectedItems: [] };
  });

  // PUT /api/knowledge/integrations/:id/items — save selected items
  fastify.put<{ Params: { id: string }; Body: { selectedItems: string[] } }>('/integrations/:id/items', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');
    if (!validateObjectId(request.params.id)) return reply.badRequest('Invalid integration ID format');
    const db = getDatabase();
    const { selectedItems } = request.body;
    if (!Array.isArray(selectedItems)) return reply.badRequest('selectedItems must be an array');

    await db.collection('knowledge_integrations').updateOne(
      { _id: new ObjectId(request.params.id), organizationId },
      { $set: { selectedItems, updatedAt: new Date() } },
    );
    return { ok: true };
  });

  // POST /api/knowledge/integrations/:id/sync — trigger sync (only selected items)
  fastify.post<{ Params: { id: string } }>('/integrations/:id/sync', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');
    if (!validateObjectId(request.params.id)) return reply.badRequest('Invalid integration ID format');
    const db = getDatabase();
    const integration = await db.collection('knowledge_integrations').findOne({
      _id: new ObjectId(request.params.id),
      organizationId,
    });
    if (!integration) return reply.notFound('Integration not found');

    const selectedItems: string[] = integration.selectedItems || [];
    if (selectedItems.length === 0) return reply.badRequest('No items selected — configure which items to sync first');

    // Fire-and-forget sync with live progress tracking
    await db.collection('knowledge_integrations').updateOne(
      { _id: integration._id },
      { $set: { syncStatus: 'syncing', syncProgress: { total: selectedItems.length, completed: 0, failed: 0, currentItem: '' }, updatedAt: new Date() } },
    );

    (async () => {
      let completed = 0;
      let failed = 0;
      const updateProgress = (currentItem: string) =>
        db.collection('knowledge_integrations').updateOne(
          { _id: integration._id },
          { $set: { 'syncProgress.completed': completed, 'syncProgress.failed': failed, 'syncProgress.currentItem': currentItem, updatedAt: new Date() } },
        ).catch(() => {});

      try {
        if (integration.type === 'google_drive') {
          let accessToken = decrypt(integration.accessToken);
          if (integration.refreshToken) {
            try {
              accessToken = await refreshGoogleToken(decrypt(integration.refreshToken));
              await db.collection('knowledge_integrations').updateOne(
                { _id: integration._id },
                { $set: { accessToken: encrypt(accessToken), updatedAt: new Date() } },
              );
            } catch { /* use existing token */ }
          }
          const files = await listDriveFiles(accessToken);
          const selected = files.filter((f: any) => selectedItems.includes(f.id));
          await db.collection('knowledge_integrations').updateOne(
            { _id: integration._id },
            { $set: { 'syncProgress.total': selected.length } },
          );
          for (const file of selected) {
            await updateProgress(file.name);
            try {
              const { buffer, exportedMime } = await downloadDriveFile(accessToken, file.id, file.mimeType);
              await ingestDocument({
                organizationId,
                agentId: null,
                createdBy: integration.createdBy,
                type: 'file',
                name: file.name,
                origin: `gdrive://${file.id}`,
                content: buffer,
                mimeType: exportedMime,
              });
              completed++;
            } catch (err) {
              failed++;
              console.error(`[gdrive-sync] Failed to sync ${file.name}:`, err);
            }
          }
        } else if (integration.type === 'notion') {
          const accessToken = decrypt(integration.accessToken);
          const pages = await listNotionPages(accessToken);
          const selected = pages.filter(p => selectedItems.includes(p.id));
          await db.collection('knowledge_integrations').updateOne(
            { _id: integration._id },
            { $set: { 'syncProgress.total': selected.length } },
          );
          for (const page of selected) {
            await updateProgress(page.title);
            try {
              const content = await getNotionPageContent(accessToken, page.id);
              if (!content.trim()) { completed++; continue; }
              await ingestDocument({
                organizationId,
                agentId: null,
                createdBy: integration.createdBy,
                type: 'text',
                name: page.title,
                origin: `notion://${page.id}`,
                content,
              });
              completed++;
            } catch (err) {
              failed++;
              console.error(`[notion-sync] Failed to sync ${page.title}:`, err);
            }
          }
        }
        await db.collection('knowledge_integrations').updateOne(
          { _id: integration._id },
          { $set: { syncStatus: 'idle', syncProgress: null, lastSyncAt: new Date(), updatedAt: new Date() } },
        );
      } catch (err) {
        console.error(`[integration-sync] Sync failed for ${integration.type}:`, err);
        await db.collection('knowledge_integrations').updateOne(
          { _id: integration._id },
          { $set: { syncStatus: 'error', 'syncProgress.currentItem': String(err), updatedAt: new Date() } },
        ).catch(() => {});
      }
    })();

    return { ok: true, message: 'Sync started' };
  });

  // DELETE /api/knowledge/integrations/:id
  fastify.delete<{ Params: { id: string } }>('/integrations/:id', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');
    if (!validateObjectId(request.params.id)) return reply.badRequest('Invalid integration ID format');
    const db = getDatabase();
    await db.collection('knowledge_integrations').deleteOne({
      _id: new ObjectId(request.params.id),
      organizationId,
    });
    return { ok: true };
  });
}

// Public OAuth callback routes (no auth required — called by OAuth provider redirects)
// State is signed (verifyOAuthState) to prevent CSRF. Redirect to /knowledge with code.
export async function knowledgeOAuthCallbackRoutes(fastify: FastifyInstance) {
  const baseUrl = config.frontendUrl || 'http://localhost:3000';

  fastify.get<{ Querystring: { code?: string; state?: string } }>('/integrations/google/callback', async (request, reply) => {
    const code = request.query.code || '';
    const parsed = verifyOAuthState(request.query.state || '');
    if (!parsed) {
      request.log.warn('OAuth callback: invalid or missing state (Google)');
      return reply.redirect(`${baseUrl}/knowledge?oauth_error=invalid_state`);
    }
    const agentId = sanitizeAgentId(parsed.agentId);
    const target = agentId ? `/agents/${agentId}/memory` : '/knowledge';
    return reply.redirect(`${baseUrl}${target}?google_code=${encodeURIComponent(code)}`);
  });

  fastify.get<{ Querystring: { code?: string; state?: string } }>('/integrations/notion/callback', async (request, reply) => {
    const code = request.query.code || '';
    const parsed = verifyOAuthState(request.query.state || '');
    if (!parsed) {
      request.log.warn('OAuth callback: invalid or missing state (Notion)');
      return reply.redirect(`${baseUrl}/knowledge?oauth_error=invalid_state`);
    }
    const agentId = sanitizeAgentId(parsed.agentId);
    const target = agentId ? `/agents/${agentId}/memory` : '/knowledge';
    return reply.redirect(`${baseUrl}${target}?notion_code=${encodeURIComponent(code)}`);
  });
}
