import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../config/database.js';
import { config } from '../../config/env.js';
import { encrypt } from '../../utils/encryption.js';
import { serializeDoc } from '../../utils/sanitize.js';
import {
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
  organizationResponseSchema,
} from '../../validation/response-schemas.js';
import { requirePermission, resolveOrgRole } from '../../middleware/permission.middleware.js';
import { ORG_ROLES, ROLE_PERMISSIONS } from '@openclaw-business/shared';
import type { OrgRole } from '@openclaw-business/shared';

export async function organizationRoutes(fastify: FastifyInstance) {
  // Trial guard: block org mutations when trial expired
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' && request.trialExpired) {
      return reply.code(403).send({ error: 'Payment required. Upgrade to Professional to continue.' });
    }
  });

  const db = getDatabase();
  const orgsCollection = db.collection('organizations');
  const usersCollection = db.collection('users');

  // GET /api/organization - Get current user's organization
  // Note: org resolution (JWT → user doc → membership → Clerk API) is handled
  // by authMiddleware, so request.organizationId is already resolved here.
  fastify.get('/', {
    schema: {
      tags: ['Organization'],
      summary: 'Get current organization',
      description: 'Returns the organization associated with the authenticated user. Sensitive fields like encrypted API keys are sanitized to boolean flags.',
      response: {
        200: z.object({ organization: organizationResponseSchema.extend({
          toolApiKeys: z.record(z.any()).optional(),
        }) }),
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const orgClerkId = request.organizationId;

    if (!orgClerkId) {
      return reply.code(404).send({ error: 'No organization found' });
    }

    const org = await orgsCollection.findOne({ clerkId: orgClerkId });
    if (!org) {
      return reply.code(404).send({ error: 'Organization not found' });
    }

    // Sanitize: never send encrypted key values to the frontend.
    // Only indicate whether keys are configured (boolean flags).
    // Provide safe defaults for fields that may not exist yet.
    const sanitizedOrg = {
      ...org,
      slug: org.slug || '',
      subscription: org.subscription || { plan: 'unpaid', status: 'active' },
      toolApiKeys: org.toolApiKeys ? {
        hasBraveApiKey: !!org.toolApiKeys.braveApiKeyEncrypted,
        hasTavilyApiKey: !!org.toolApiKeys.tavilyApiKeyEncrypted,
      } : undefined,
    };

    return { organization: serializeDoc(sanitizedOrg) };
  });

  // PATCH /api/organization - Update organization
  fastify.patch('/', {
    schema: {
      tags: ['Organization'],
      summary: 'Update organization',
      description: 'Updates organization details including name, metadata, features, and tool API keys. Only provided fields are updated.',
      body: z.object({
        name: z.string().optional(),
        industry: z.string().optional(),
        teamSize: z.string().optional(),
        primaryUseCase: z.string().optional(),
        features: z.record(z.any()).optional(),
        toolApiKeys: z.record(z.any()).optional(),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
      },
    },
    preHandler: requirePermission('settings.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    const body = request.body as any;

    if (!organizationId) {
      return reply.code(400).send({ error: 'No active organization' });
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (body.name && body.name.trim()) {
      updateData.name = body.name.trim();
    }

    if (body.industry || body.teamSize || body.primaryUseCase) {
      if (body.industry) updateData['metadata.industry'] = body.industry;
      if (body.teamSize) updateData['metadata.teamSize'] = body.teamSize;
      if (body.primaryUseCase) updateData['metadata.primaryUseCase'] = body.primaryUseCase;
    }

    // Features (tier-gated: whiteLabel)
    if (body.features && typeof body.features === 'object') {
      if (typeof body.features.whiteLabel === 'boolean') {
        updateData['features.whiteLabel'] = body.features.whiteLabel;
      }
    }

    // Tool API keys (Brave Search, Tavily, etc.) — org-level, encrypted
    // These are used by deployed agents, NOT platform-level keys.
    if (body.toolApiKeys && typeof body.toolApiKeys === 'object') {
      if (typeof body.toolApiKeys.braveApiKey === 'string') {
        const key = body.toolApiKeys.braveApiKey.trim();
        updateData['toolApiKeys.braveApiKeyEncrypted'] = key ? encrypt(key) : '';
      }
      if (typeof body.toolApiKeys.tavilyApiKey === 'string') {
        const key = body.toolApiKeys.tavilyApiKey.trim();
        updateData['toolApiKeys.tavilyApiKeyEncrypted'] = key ? encrypt(key) : '';
      }
    }

    await orgsCollection.updateOne(
      { clerkId: organizationId },
      { $set: updateData }
    );

    return { success: true };
  });

  // GET /api/organization/members - Get team members
  fastify.get('/members', {
    schema: {
      tags: ['Organization'],
      summary: 'List organization members',
      description: 'Returns all members of the current organization with their profile information and roles.',
      response: {
        200: z.object({
          members: z.array(z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            imageUrl: z.string(),
            role: z.string(),
            status: z.string(),
            joined: z.string().optional(),
          })),
        }),
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('team.view'),
  }, async (request, reply) => {
    const userId = request.userId;

    const user = await usersCollection.findOne({ clerkId: userId });
    if (!user || !user.organizationId) {
      return reply.code(404).send({ error: 'No organization found' });
    }

    const org = await orgsCollection.findOne({ clerkId: user.organizationId });
    if (!org) {
      return reply.code(404).send({ error: 'Organization not found' });
    }

    const members = await Promise.all(
      (org.members || []).map(async (member: any) => {
        const memberUser = await usersCollection.findOne({ clerkId: member.userId });
        return {
          id: member.userId,
          name: memberUser ? `${memberUser.firstName || ''} ${memberUser.lastName || ''}`.trim() : 'Unknown',
          email: memberUser?.email || '',
          imageUrl: memberUser?.imageUrl || '',
          role: member.role,
          status: 'active',
          joined: member.joinedAt instanceof Date ? member.joinedAt.toISOString() : member.joinedAt,
        };
      })
    );

    return { members };
  });

  // POST /api/organization/members - Invite member (Resend email when configured, else Clerk)
  fastify.post('/members', {
    schema: {
      tags: ['Organization'],
      summary: 'Invite organization member',
      description: 'Sends an invitation to a new member via Clerk Invitations API. The email must be valid and the role must be Owner, Admin, or Member.',
      body: z.object({
        email: z.string().email(),
        role: z.enum(['Owner', 'Admin', 'Member']),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          message: z.string(),
          invitationId: z.string(),
        }),
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
    preHandler: requirePermission('team.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    const { email, role } = request.body as any;
    
    if (!email || !email.trim()) {
      return reply.code(400).send({ error: 'Email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.code(400).send({ error: 'Invalid email format' });
    }

    if (!role || !['Owner', 'Admin', 'Member'].includes(role)) {
      return reply.code(400).send({ error: 'Invalid role' });
    }

    if (!organizationId) {
      return reply.code(400).send({ error: 'No active organization' });
    }

    try {
      const { isResendConfigured, sendInviteEmail } = await import('../../services/resend.service.js');
      const frontendUrl = config.frontendUrl || 'http://localhost:3000';
      const crypto = await import('node:crypto');

      if (isResendConfigured()) {
        // Custom flow: store invite in DB, send via Resend
        const invitesCol = db.collection('organization_invitations');

        // Duplicate check: reject if a pending invite already exists for this email+org
        const existing = await invitesCol.findOne({
          organizationId,
          email: email.trim().toLowerCase(),
          status: 'pending',
          expiresAt: { $gt: new Date() },
        });
        if (existing) {
          return reply.code(400).send({ error: 'An invitation for this email is already pending' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const org = await orgsCollection.findOne({ clerkId: organizationId });
        const inviterUser = await usersCollection.findOne({ clerkId: userId });
        const inviterName = inviterUser
          ? `${inviterUser.firstName || ''} ${inviterUser.lastName || ''}`.trim() || inviterUser.email || 'A team member'
          : 'A team member';

        await invitesCol.insertOne({
          organizationId,
          email: email.trim().toLowerCase(),
          role: role.toLowerCase() === 'owner' ? 'owner' : role.toLowerCase() === 'admin' ? 'admin' : 'editor',
          token,
          inviterId: userId,
          expiresAt,
          status: 'pending',
          createdAt: new Date(),
        });

        const acceptUrl = `${frontendUrl}/invite/accept?token=${token}`;
        const resendResult = await sendInviteEmail({
          to: email.trim(),
          orgName: org?.name || 'Your team',
          inviterName,
          role: role === 'Owner' ? 'Owner' : role === 'Admin' ? 'Admin' : 'Member',
          acceptUrl,
          expiresInDays: 7,
        });

        if (!resendResult.success) {
          await invitesCol.deleteOne({ token });
          return reply.code(500).send({ error: resendResult.error || 'Failed to send invitation email' });
        }

        return {
          success: true,
          message: 'Invitation sent via email',
          invitationId: token,
        };
      }

      // Fallback: Clerk Invitations API
      const clerkResponse = await fetch(
        `https://api.clerk.com/v1/organizations/${organizationId}/invitations`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.clerkSecretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email_address: email.trim(),
            role: role.toLowerCase() === 'owner' ? 'org:admin' : role.toLowerCase() === 'admin' ? 'org:admin' : 'org:member',
          }),
        }
      );

      if (!clerkResponse.ok) {
        const errorData = await clerkResponse.json().catch(() => ({}));
        const errorMessage = (errorData as any)?.errors?.[0]?.long_message || 'Failed to send invitation';
        return reply.code(clerkResponse.status as 400).send({ error: errorMessage });
      }

      const invitation = await clerkResponse.json();

      return { 
        success: true, 
        message: 'Invitation sent',
        invitationId: (invitation as any).id,
      };
    } catch (error) {
      request.log.error({ error }, 'Failed to send organization invitation');
      return reply.code(500).send({ error: 'Failed to send invitation' });
    }
  });

  // DELETE /api/organization/members/:id - Remove member
  fastify.delete<{ Params: { id: string } }>('/members/:id', {
    schema: {
      tags: ['Organization'],
      summary: 'Remove organization member',
      description: 'Removes a member from the organization in both Clerk and the local database.',
      params: z.object({
        id: z.string().describe('Clerk user ID of the member to remove'),
      }),
      response: {
        200: successResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('team.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const memberId = request.params.id;
    const organizationId = request.organizationId;

    if (!organizationId) {
      return reply.code(404).send({ error: 'No organization found' });
    }

    // Cannot remove yourself
    if (memberId === userId) {
      return reply.code(400).send({ error: 'Cannot remove yourself from the organization' });
    }

    // Check if target is last owner
    const org = await orgsCollection.findOne({ clerkId: organizationId });
    if (!org) {
      return reply.code(404).send({ error: 'Organization not found' });
    }

    const targetMember = (org.members || []).find((m: any) => m.userId === memberId);
    if (!targetMember) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    if (targetMember.role === 'owner') {
      const ownerCount = (org.members || []).filter((m: any) => m.role === 'owner').length;
      if (ownerCount <= 1) {
        return reply.code(400).send({ error: 'Cannot remove the last owner' });
      }
    }

    // Remove from Clerk organization — abort if Clerk fails
    try {
      const clerkRes = await fetch(
        `https://api.clerk.com/v1/organizations/${organizationId}/memberships/${memberId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${config.clerkSecretKey}`,
          },
        }
      );
      if (!clerkRes.ok && clerkRes.status !== 404) {
        request.log.error({ status: clerkRes.status }, 'Clerk member removal failed');
        return reply.code(500).send({ error: 'Failed to remove member from identity provider' });
      }
    } catch (error) {
      request.log.error({ error }, 'Failed to remove member from Clerk');
      return reply.code(500).send({ error: 'Failed to remove member from identity provider' });
    }

    // Remove from local DB
    await orgsCollection.updateOne(
      { clerkId: organizationId },
      {
        $pull: {
          members: { userId: memberId },
        } as any,
      }
    );

    // Audit
    if (request.audit) {
      await request.audit({
        action: 'security.permission_changed',
        category: 'security.change',
        title: 'Member removed from organization',
        description: `Removed user ${memberId} from the organization`,
        riskLevel: 'high',
        outcome: 'success',
        resource: { type: 'member', id: memberId },
      });
    }

    return { success: true };
  });

  // PATCH /api/organization/members/:id - Update member role
  fastify.patch<{ Params: { id: string } }>('/members/:id', {
    schema: {
      tags: ['Organization'],
      summary: 'Update member role',
      description: 'Updates the role of an existing organization member in both Clerk and the local database.',
      params: z.object({
        id: z.string().describe('Clerk user ID of the member to update'),
      }),
      body: z.object({
        role: z.enum(['Owner', 'Admin', 'Member']),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('team.manage'),
  }, async (request, reply) => {
    const memberId = request.params.id;
    const { role } = request.body as any;
    const organizationId = request.organizationId;

    if (!role || !['Owner', 'Admin', 'Member'].includes(role)) {
      return reply.code(400).send({ error: 'Invalid role' });
    }

    if (!organizationId) {
      return reply.code(404).send({ error: 'No organization found' });
    }

    // Map legacy role to Havoc RBAC role for local DB
    const havocRole = role === 'Owner' ? 'owner' : role === 'Admin' ? 'admin' : 'editor';

    // Update in Clerk — abort if fails
    try {
      const clerkRes = await fetch(
        `https://api.clerk.com/v1/organizations/${organizationId}/memberships/${memberId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${config.clerkSecretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            role: role === 'Member' ? 'org:member' : 'org:admin',
          }),
        }
      );
      if (!clerkRes.ok) {
        request.log.error({ status: clerkRes.status }, 'Clerk role update failed');
        return reply.code(500).send({ error: 'Failed to update role in identity provider' });
      }
    } catch (error) {
      request.log.error({ error }, 'Failed to update member role in Clerk');
      return reply.code(500).send({ error: 'Failed to update role in identity provider' });
    }

    // Update in local DB with mapped Havoc role
    const result = await orgsCollection.updateOne(
      { clerkId: organizationId, 'members.userId': memberId },
      {
        $set: {
          'members.$.role': havocRole,
        },
      }
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    return { success: true };
  });

  // ── RBAC: Role & Permission Management ──────────────────────────

  // GET /api/organization/roles - List all available roles + permissions
  fastify.get('/roles', {
    schema: {
      tags: ['Organization'],
      summary: 'List available RBAC roles',
      description: 'Returns all available organization roles with their default permissions. Used by the frontend to display role options.',
    },
    preHandler: requirePermission('team.view'),
  }, async (request, reply) => {
    const roleDescriptions: Record<string, { name: string; description: string }> = {
      owner: { name: 'Owner', description: 'Full access including billing and org deletion' },
      admin: { name: 'Admin', description: 'Manage agents, team, config, and providers' },
      editor: { name: 'Editor', description: 'Configure and operate agents, manage workspace' },
      viewer: { name: 'Viewer', description: 'Read-only access to dashboards and analytics' },
      billing_admin: { name: 'Billing Admin', description: 'Manage billing and subscriptions' },
    };

    return {
      roles: ORG_ROLES.map((id) => ({
        id,
        name: roleDescriptions[id]?.name || id,
        description: roleDescriptions[id]?.description || '',
        permissions: ROLE_PERMISSIONS[id as keyof typeof ROLE_PERMISSIONS] || [],
        isCustomizable: id !== 'owner',
      })),
    };
  });

  // GET /api/organization/permissions - Get current user's effective permissions
  fastify.get('/permissions', {
    schema: {
      tags: ['Organization'],
      summary: 'Get current user permissions',
      description: 'Returns the effective role and permissions for the authenticated user within the current organization.',
    },
  }, async (request, reply) => {
    const { role, permissions } = await resolveOrgRole(request);
    return { role, permissions };
  });

  // PATCH /api/organization/members/:id/role - Set Havoc RBAC role
  fastify.patch<{ Params: { id: string } }>('/members/:id/role', {
    schema: {
      tags: ['Organization'],
      summary: 'Set member RBAC role',
      description: 'Sets the granular Havoc RBAC role for an organization member. Only owners and admins can change roles. Owners cannot be demoted by non-owners.',
      params: z.object({ id: z.string().describe('Clerk user ID of the member') }),
      body: z.object({
        role: z.enum(['owner', 'admin', 'editor', 'viewer', 'billing_admin']),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('team.manage'),
  }, async (request, reply) => {
    const memberId = request.params.id;
    const { role: newRole } = request.body as any;
    const organizationId = request.organizationId;

    if (!organizationId) {
      return reply.code(400).send({ error: 'No active organization' });
    }

    // Resolve caller's role
    const { role: callerRole } = await resolveOrgRole(request);

    // Only owners can assign/remove owner role
    if (newRole === 'owner' && callerRole !== 'owner') {
      return reply.code(403).send({ error: 'Only owners can assign the owner role' });
    }

    // Check target member exists
    const org = await orgsCollection.findOne({ clerkId: organizationId });
    if (!org) {
      return reply.code(404).send({ error: 'Organization not found' });
    }

    const targetMember = (org.members || []).find((m: any) => m.userId === memberId);
    if (!targetMember) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    // Non-owners cannot demote owners
    if (targetMember.role === 'owner' && callerRole !== 'owner') {
      return reply.code(403).send({ error: 'Only owners can change another owner\'s role' });
    }

    // Cannot demote yourself if you're the last owner
    if (memberId === request.userId && targetMember.role === 'owner' && newRole !== 'owner') {
      const ownerCount = (org.members || []).filter((m: any) => m.role === 'owner').length;
      if (ownerCount <= 1) {
        return reply.code(400).send({ error: 'Cannot demote the last owner. Transfer ownership first.' });
      }
    }

    const previousRole = targetMember.role;

    const result = await orgsCollection.updateOne(
      { clerkId: organizationId, 'members.userId': memberId },
      { $set: { 'members.$.role': newRole, updatedAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    // Audit: permission_changed
    if (request.audit) {
      await request.audit({
        action: 'security.permission_changed',
        category: 'security.change',
        title: `Role changed for member`,
        description: `Changed role of user ${memberId} from "${previousRole}" to "${newRole}"`,
        riskLevel: newRole === 'owner' ? 'critical' : 'high',
        outcome: 'success',
        resource: { type: 'member', id: memberId },
        changes: [{ field: 'role', before: previousRole, after: newRole }],
      });
    }

    return { success: true };
  });

  // ── SSO / SCIM Security Settings ──────────────────────────────

  // GET /api/organization/security - Get SSO/SCIM settings
  fastify.get('/security', {
    schema: {
      tags: ['Organization'],
      summary: 'Get SSO/SCIM security settings',
    },
    preHandler: requirePermission('settings.view'),
  }, async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.code(400).send({ error: 'No active organization' });

    const org = await orgsCollection.findOne(
      { clerkId: organizationId },
      { projection: { ssoRequired: 1, allowedDomains: 1, scimEnabled: 1 } },
    );

    return {
      ssoRequired: org?.ssoRequired || false,
      allowedDomains: org?.allowedDomains || [],
      scimEnabled: org?.scimEnabled || false,
    };
  });

  // PATCH /api/organization/security - Update SSO/SCIM settings
  fastify.patch('/security', {
    schema: {
      tags: ['Organization'],
      summary: 'Update SSO/SCIM security settings',
      body: z.object({
        ssoRequired: z.boolean().optional(),
        allowedDomains: z.array(z.string()).optional(),
        scimEnabled: z.boolean().optional(),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
      },
    },
    preHandler: requirePermission('settings.manage'),
  }, async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.code(400).send({ error: 'No active organization' });

    const body = request.body as any;
    const updates: any = { updatedAt: new Date() };
    
    if (body.ssoRequired !== undefined) updates.ssoRequired = body.ssoRequired;
    if (body.allowedDomains !== undefined) updates.allowedDomains = body.allowedDomains;
    if (body.scimEnabled !== undefined) updates.scimEnabled = body.scimEnabled;

    await orgsCollection.updateOne(
      { clerkId: organizationId },
      { $set: updates },
    );

    // Audit: SSO settings changed
    if (request.audit) {
      await request.audit({
        action: 'security.permission_changed',
        category: 'security.change',
        title: 'SSO/SCIM settings updated',
        description: `Updated security settings: ${Object.keys(body).join(', ')}`,
        riskLevel: 'high',
        outcome: 'success',
        changes: Object.entries(body).map(([field, value]) => ({
          field,
          before: undefined,
          after: value,
        })),
      });
    }

    return { success: true };
  });
}
