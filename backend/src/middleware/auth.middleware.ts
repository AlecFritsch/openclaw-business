import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '@clerk/backend';
import { config } from '../config/env.js';
import { getDatabase } from '../config/database.js';
import { resolvePlan, buildUnpaidSubscription } from '../utils/trial.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    organizationId?: string;
    orgRole?: string;
    authMethod?: 'clerk_jwt' | 'api_key';
    plan?: string;
    trialExpired?: boolean;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // Get token from Authorization header or query param (for SSE/EventSource)
    const authHeader = request.headers.authorization;
    const queryToken = (request.query as any)?.token;
    
    if (!queryToken && (!authHeader || !authHeader.startsWith('Bearer '))) {
      return reply.code(401).send({ error: 'Missing or invalid authorization header' });
    }

    const token = queryToken || authHeader!.replace('Bearer ', '');

    // ── API Key auth (agx_ prefix) ─────────────────────────────────
    if (token.startsWith('agx_')) {
      return await authenticateApiKey(request, reply, token);
    }

    // ── Clerk JWT auth (default) ───────────────────────────────────
    // Verify Clerk JWT token
    const payload = await verifyToken(token, {
      secretKey: config.clerkSecretKey,
    });

    if (!payload || !payload.sub) {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    // Set userId, organizationId, and orgRole from verified token
    request.userId = payload.sub;
    request.organizationId = payload.org_id as string | undefined;
    request.orgRole = payload.org_role as string | undefined;

    // ── Ensure user is a member of the org in our DB ──────────────
    // The Clerk webhook may create the org doc with an empty members array
    // (race condition: webhook fires before the first API call).
    // This idempotent $addToSet ensures the user is always registered as a member.
    if (request.organizationId && request.userId) {
      try {
        const ensureDb = getDatabase();
        const orgRole = request.orgRole || 'org:member';
        await ensureDb.collection('organizations').updateOne(
          {
            clerkId: request.organizationId,
            'members.userId': { $ne: request.userId },
          },
          {
            $addToSet: {
              members: {
                userId: request.userId,
                role: orgRole,
                joinedAt: new Date(),
              },
            },
          },
        );
      } catch {
        // Non-fatal: org doc may not exist yet (will be created by fallback or webhook)
      }
    }

    // ── Org resolution fallbacks (only when JWT has no org_id) ──────
    if (!request.organizationId) {
      const db = getDatabase();
      const usersCol = db.collection('users');
      const orgsCol = db.collection('organizations');

      // Fallback 1: check user document
      const user = await usersCol.findOne({ clerkId: payload.sub });
      if (user?.organizationId) {
        request.organizationId = user.organizationId;
      }

      // Fallback 2: search organizations by membership
      if (!request.organizationId) {
        const orgByMember = await orgsCol.findOne({ 'members.userId': payload.sub });
        if (orgByMember?.clerkId) {
          request.organizationId = orgByMember.clerkId;
          // Backfill user document
          await usersCol.updateOne(
            { clerkId: payload.sub, organizationId: { $exists: false } },
            { $set: { organizationId: orgByMember.clerkId, updatedAt: new Date() } }
          );
        }
      }

      // Fallback 3: ask Clerk API
      if (!request.organizationId) {
        try {
          const clerkRes = await fetch(
            `https://api.clerk.com/v1/users/${payload.sub}/organization_memberships?limit=1`,
            { headers: { Authorization: `Bearer ${config.clerkSecretKey}` } }
          );
          if (clerkRes.ok) {
            const body = (await clerkRes.json()) as any;
            const membership = body?.data?.[0];
            if (membership?.organization?.id) {
              request.organizationId = membership.organization.id;

              // Ensure local org doc exists (upsert to avoid race condition with parallel requests)
              const upsertResult = await orgsCol.updateOne(
                { clerkId: membership.organization.id },
                {
                  $setOnInsert: {
                    clerkId: membership.organization.id,
                    name: membership.organization.name || 'My Organization',
                    slug: membership.organization.slug || '',
                    imageUrl: membership.organization.image_url || '',
                    createdAt: new Date(membership.organization.created_at || Date.now()),
                    updatedAt: new Date(),
                    members: [{
                      userId: payload.sub,
                      role: membership.role || 'org:admin',
                      joinedAt: new Date(membership.created_at || Date.now()),
                    }],
                    metadata: { industry: null, teamSize: null, primaryUseCase: null },
                    subscription: buildUnpaidSubscription(),
                  },
                },
                { upsert: true }
              );
              if (upsertResult.upsertedCount > 0) {
                request.log.info(`Auto-created local org doc for ${membership.organization.id}`);
              }

              // Backfill user document
              await usersCol.updateOne(
                { clerkId: payload.sub, organizationId: { $exists: false } },
                { $set: { organizationId: membership.organization.id, updatedAt: new Date() } }
              );
            }
          }
        } catch (err) {
          request.log.error({ err }, 'Clerk API org fallback failed');
        }
      }

      if (request.organizationId) {
        request.log.info(
          `Resolved org ${request.organizationId} via fallback for user ${payload.sub}`
        );
      }
    }

    // ── Resolve plan + trial status for downstream middleware/routes ──
    request.authMethod = 'clerk_jwt';
    try {
      const resolved = await resolvePlan(request.userId, request.organizationId);
      request.plan = resolved.plan;
      request.trialExpired = resolved.trialExpired;
    } catch (err) {
      request.log.warn({ err }, 'Failed to resolve plan, defaulting to unpaid');
      request.plan = 'unpaid';
      request.trialExpired = true;
    }

    // ── SSO Enforcement ─────────────────────────────────────────
    // If org requires SSO, check that the user authenticated via SSO.
    // Clerk JWT includes `amr` (authentication methods) claim.
    if (request.organizationId) {
      try {
        const ssoDb = getDatabase();
        const org = await ssoDb.collection('organizations').findOne(
          { clerkId: request.organizationId },
          { projection: { ssoRequired: 1 } },
        );
        if (org?.ssoRequired) {
          const amr = (payload as any).amr;
          const usedSSO = Array.isArray(amr) && amr.some((m: string) => m === 'sso' || m === 'saml' || m === 'oidc');
          if (!usedSSO) {
            return reply.code(403).send({
              error: 'SSO required',
              message: 'This organization requires SSO authentication. Please sign in via your identity provider.',
            });
          }
        }
      } catch {
        // SSO check failure is non-fatal
      }
    }
  } catch (error) {
    request.log.error({ error }, 'Auth verification failed');
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

// ── API Key Authentication ─────────────────────────────────────────
/**
 * Authenticate a request using an `agx_*` API key.
 *
 * Looks up the key in the `users` collection (users.apiKeys[].key),
 * resolves userId + organizationId, and populates plan/trial status
 * exactly like Clerk JWT auth does.
 */
async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
  apiKey: string,
) {
  const db = getDatabase();
  const usersCol = db.collection('users');

  // Find the user that owns this API key
  const user = await usersCol.findOne(
    { 'apiKeys.key': apiKey },
    { projection: { clerkId: 1, organizationId: 1, apiKeys: 1 } },
  );

  if (!user) {
    return reply.code(401).send({ error: 'Invalid API key' });
  }

  // Set auth context — mirror the Clerk JWT path
  request.userId = user.clerkId;
  request.authMethod = 'api_key';

  // Resolve organizationId from the user document
  if (user.organizationId) {
    request.organizationId = user.organizationId as string;
  } else {
    // Fallback: find org by membership (same as Clerk JWT fallback 2)
    const orgsCol = db.collection('organizations');
    const orgByMember = await orgsCol.findOne({ 'members.userId': user.clerkId });
    if (orgByMember?.clerkId) {
      request.organizationId = orgByMember.clerkId;
    }
  }

  // Resolve plan + trial status (same as Clerk JWT path)
  try {
    const resolved = await resolvePlan(request.userId, request.organizationId);
    request.plan = resolved.plan;
    request.trialExpired = resolved.trialExpired;
  } catch (err) {
    request.log.warn({ err }, 'Failed to resolve plan for API key auth, defaulting to unpaid');
    request.plan = 'unpaid';
    request.trialExpired = true;
  }

  // Update lastUsed timestamp (fire-and-forget, don't block the request)
  usersCol.updateOne(
    { clerkId: user.clerkId, 'apiKeys.key': apiKey },
    { $set: { 'apiKeys.$.lastUsed': new Date() } },
  ).catch((err) => {
    request.log.warn({ err }, 'Failed to update API key lastUsed');
  });
}

