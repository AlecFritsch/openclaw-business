// ── Invitation Accept (Resend-based invites) ──────────────────────
// When RESEND_API_KEY is set, invites are stored in organization_invitations.
// User lands on /invite/accept?token=xxx, signs in if needed, then POSTs to accept.

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../config/database.js';
import { config } from '../../config/env.js';
import {
  successResponseSchema,
  errorResponseSchema,
} from '../../validation/response-schemas.js';

export async function invitationsRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const invitesCol = db.collection('organization_invitations');
  const orgsCol = db.collection('organizations');
  const usersCol = db.collection('users');

  // POST /api/invitations/accept - Accept an invitation (requires auth)
  fastify.post('/accept', {
    schema: {
      tags: ['Invitations'],
      summary: 'Accept team invitation',
      description: 'Accepts a pending invitation by token. User must be authenticated. Email must match the invitation.',
      body: z.object({
        token: z.string().min(1).describe('Invitation token from email link'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          message: z.string(),
          organizationId: z.string(),
        }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' }) as any;
    }

    const { token } = request.body as { token: string };
    if (!token?.trim()) {
      return reply.code(400).send({ error: 'Token is required' });
    }

    const invite = await invitesCol.findOne({
      token: token.trim(),
      status: 'pending',
    });

    if (!invite) {
      return reply.code(404).send({ error: 'Invitation not found or already used' });
    }

    if (new Date() > new Date(invite.expiresAt)) {
      await invitesCol.updateOne({ _id: invite._id }, { $set: { status: 'expired', updatedAt: new Date() } });
      return reply.code(400).send({ error: 'Invitation has expired' });
    }

    // Get current user's email from Clerk or our DB
    const user = await usersCol.findOne({ clerkId: userId });
    let userEmail = user?.email;
    if (!userEmail) {
      // Fallback: fetch from Clerk
      try {
        const clerkRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
          headers: { Authorization: `Bearer ${config.clerkSecretKey}` },
        });
        if (clerkRes.ok) {
          const clerkUser = await clerkRes.json();
          userEmail = clerkUser.email_addresses?.find((e: any) => e.id === clerkUser.primary_email_address_id)?.email_address
            || clerkUser.email_addresses?.[0]?.email_address;
        }
      } catch {
        // ignore — will fail open if no email can be resolved
      }
    }

    if (userEmail && userEmail.toLowerCase() !== invite.email) {
      return reply.code(403).send({ error: 'Invitation was sent to a different email address' });
    }

    const organizationId = invite.organizationId;
    const org = await orgsCol.findOne({ clerkId: organizationId });
    if (!org) {
      return reply.code(404).send({ error: 'Organization not found' });
    }

    // Add user to Clerk organization
    try {
      const clerkRes = await fetch(
        `https://api.clerk.com/v1/organizations/${organizationId}/memberships`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.clerkSecretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: userId,
            role: invite.role === 'owner' ? 'org:admin' : invite.role === 'admin' ? 'org:admin' : 'org:member',
          }),
        }
      );

      if (!clerkRes.ok) {
        const errData = await clerkRes.json().catch(() => ({}));
        const msg = (errData as any)?.errors?.[0]?.long_message || 'Failed to add you to the organization';
        return reply.code(500).send({ error: msg }) as any;
      }
    } catch (err: any) {
      request.log.error({ err }, 'Clerk membership creation failed');
      return reply.code(500).send({ error: 'Failed to add you to the organization' }) as any;
    }

    // Sync local org members
    const havocRole = invite.role === 'owner' ? 'owner' : invite.role === 'admin' ? 'admin' : 'editor';
    const members = org.members || [];
    if (!members.some((m: any) => m.userId === userId)) {
      await orgsCol.updateOne(
        { clerkId: organizationId },
        {
          $push: {
            members: {
              userId,
              role: havocRole,
              joinedAt: new Date(),
            },
          } as any,
          $set: { updatedAt: new Date() },
        }
      );
    }

    // Mark invite accepted
    await invitesCol.updateOne(
      { _id: invite._id },
      { $set: { status: 'accepted', acceptedAt: new Date(), acceptedBy: userId, updatedAt: new Date() } }
    );

    return {
      success: true,
      message: "You've joined the organization",
      organizationId,
    };
  });

  // GET /api/invitations/pending - List pending invitations for current org
  fastify.get('/pending', {
    schema: {
      tags: ['Invitations'],
      summary: 'List pending invitations',
      response: {
        200: z.object({
          invitations: z.array(z.object({
            email: z.string(),
            role: z.string(),
            createdAt: z.string(),
            expiresAt: z.string(),
            token: z.string(),
          })),
        }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.code(400).send({ error: 'No active organization' });

    const invites = await invitesCol.find({
      organizationId,
      status: 'pending',
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 }).toArray();

    return {
      invitations: invites.map(i => ({
        email: i.email,
        role: i.role,
        createdAt: i.createdAt?.toISOString?.() ?? new Date(i.createdAt).toISOString(),
        expiresAt: i.expiresAt?.toISOString?.() ?? new Date(i.expiresAt).toISOString(),
        token: i.token,
      })),
    };
  });

  // DELETE /api/invitations/:token - Revoke a pending invitation
  fastify.delete<{ Params: { token: string } }>('/:token', {
    schema: {
      tags: ['Invitations'],
      summary: 'Revoke invitation',
      params: z.object({ token: z.string().min(1) }),
      response: {
        200: z.object({ success: z.literal(true), message: z.string() }),
        400: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.code(400).send({ error: 'No active organization' });

    const result = await invitesCol.updateOne(
      { token: request.params.token, organizationId, status: 'pending' },
      { $set: { status: 'revoked', updatedAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Invitation not found or already used' });
    }

    return { success: true as const, message: 'Invitation revoked' };
  });
}
