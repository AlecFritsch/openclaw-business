// ── Granulare RBAC Permission Middleware ─────────────────────────
// resolveOrgRole + requirePermission Factory fuer Fastify preHandler.

import { FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../config/database.js';
import type {
  Permission,
  OrgRole,
  OrgRoleOverrides,
} from '@openclaw-business/shared';
import {
  mapClerkRole,
  hasPermission,
  getEffectivePermissions,
} from '@openclaw-business/shared';

declare module 'fastify' {
  interface FastifyRequest {
    /** Resolved Havoc RBAC role (granular, not Clerk role) */
    resolvedRole?: OrgRole;
    /** Effective permissions for the current user */
    permissions?: Permission[];
  }
}

/**
 * Resolves the effective OrgRole for the current request.
 * Priority: Org DB member.role override > Clerk JWT org_role mapping.
 * Caches result on request to avoid repeated DB lookups.
 */
export async function resolveOrgRole(request: FastifyRequest): Promise<{
  role: OrgRole;
  permissions: Permission[];
}> {
  // Return cached if already resolved
  if (request.resolvedRole && request.permissions) {
    return { role: request.resolvedRole, permissions: request.permissions };
  }

  const clerkRole: OrgRole = mapClerkRole(request.orgRole);
  let role: OrgRole = clerkRole;
  let overrides: OrgRoleOverrides | undefined;

  // Role hierarchy for comparison (lower index = higher privilege)
  const ROLE_HIERARCHY: OrgRole[] = ['owner', 'admin', 'editor', 'billing_admin', 'viewer'];

  // Check org document for custom role assignment
  if (request.organizationId) {
    try {
      const db = getDatabase();
      const org = await db.collection('organizations').findOne(
        { clerkId: request.organizationId },
        { projection: { members: 1, roleOverrides: 1 } },
      );

      if (org) {
        // Find member's custom role
        const member = (org.members || []).find(
          (m: any) => m.userId === request.userId,
        );

        if (member?.role) {
          const memberRole = member.role as string;
          let dbRole: OrgRole | null = null;

          // Map Clerk-prefixed roles AND legacy roles to Havoc OrgRoles
          if (memberRole === 'org:admin' || memberRole === 'admin') {
            dbRole = 'admin';
          } else if (memberRole === 'org:member' || memberRole === 'member') {
            dbRole = 'editor';
          } else if (['owner', 'editor', 'viewer', 'billing_admin'].includes(memberRole)) {
            dbRole = memberRole as OrgRole;
          }

          if (dbRole) {
            // Use the HIGHER of Clerk role and DB role (never downgrade)
            const clerkIdx = ROLE_HIERARCHY.indexOf(clerkRole);
            const dbIdx = ROLE_HIERARCHY.indexOf(dbRole);
            role = dbIdx <= clerkIdx ? dbRole : clerkRole;
          }
        }

        overrides = org.roleOverrides as OrgRoleOverrides | undefined;
      }
    } catch {
      // DB lookup failed — use Clerk role fallback
    }
  }

  const permissions = getEffectivePermissions(role, overrides);

  // Cache on request
  request.resolvedRole = role;
  request.permissions = permissions;

  return { role, permissions };
}

/**
 * Factory: Creates a Fastify preHandler that checks if the user has
 * ALL of the specified permissions. Returns 403 if any is missing.
 *
 * Usage: `{ preHandler: requirePermission('agents.create') }`
 * Usage: `{ preHandler: requirePermission('agents.configure', 'agents.deploy') }`
 */
export function requirePermission(...requiredPermissions: Permission[]) {
  return async function checkPermission(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const { role, permissions } = await resolveOrgRole(request);

    for (const required of requiredPermissions) {
      if (!permissions.includes(required)) {
        return reply.code(403).send({
          error: 'Insufficient permissions',
          message: `This action requires the "${required}" permission. Your role "${role}" does not have it.`,
          requiredPermission: required,
          currentRole: role,
        });
      }
    }
  };
}

