// ── Permission / Auth Tests ──────────────────────────────────────
// Critical: Wrong permissions = data leaks or unauthorized access.

import { describe, it, expect } from 'vitest';
import {
  mapClerkRole,
  hasPermission,
  getEffectivePermissions,
  ROLE_PERMISSIONS,
  ORG_ROLES,
} from '@openclaw-business/shared';
import type { OrgRole, OrgRoleOverrides } from '@openclaw-business/shared';

describe('mapClerkRole', () => {
  it('org:admin → admin', () => expect(mapClerkRole('org:admin')).toBe('admin'));
  it('org:member → editor', () => expect(mapClerkRole('org:member')).toBe('editor'));
  it('undefined → viewer (safe default)', () => expect(mapClerkRole(undefined)).toBe('viewer'));
  it('unknown string → viewer', () => expect(mapClerkRole('garbage')).toBe('viewer'));
});

describe('RBAC permission matrix', () => {
  it('owner has ALL permissions', () => {
    // Owner must have every single permission defined
    const allPermissions = new Set<string>();
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const p of perms) allPermissions.add(p);
    }
    for (const p of allPermissions) {
      expect(hasPermission('owner', p as any), `owner missing: ${p}`).toBe(true);
    }
  });

  it('viewer cannot create/delete/deploy agents', () => {
    expect(hasPermission('viewer', 'agents.create')).toBe(false);
    expect(hasPermission('viewer', 'agents.delete')).toBe(false);
    expect(hasPermission('viewer', 'agents.deploy')).toBe(false);
  });

  it('viewer cannot manage billing', () => {
    expect(hasPermission('viewer', 'billing.manage')).toBe(false);
  });

  it('viewer CAN view agents and sessions (read-only)', () => {
    expect(hasPermission('viewer', 'agents.view')).toBe(true);
    expect(hasPermission('viewer', 'sessions.view')).toBe(true);
  });

  it('editor can deploy but cannot delete agents', () => {
    expect(hasPermission('editor', 'agents.deploy')).toBe(true);
    expect(hasPermission('editor', 'agents.delete')).toBe(false);
  });

  it('admin cannot manage billing (only owner can)', () => {
    expect(hasPermission('admin', 'billing.manage')).toBe(false);
    expect(hasPermission('owner', 'billing.manage')).toBe(true);
  });

  it('billing_admin can manage billing but not agents', () => {
    expect(hasPermission('billing_admin', 'billing.manage')).toBe(true);
    expect(hasPermission('billing_admin', 'agents.create')).toBe(false);
    expect(hasPermission('billing_admin', 'agents.delete')).toBe(false);
  });
});

describe('permission overrides', () => {
  it('grant: viewer gets agents.create via override', () => {
    const overrides: OrgRoleOverrides = {
      viewer: { grant: ['agents.create'] },
    };
    expect(hasPermission('viewer', 'agents.create', overrides)).toBe(true);
  });

  it('deny: admin loses team.manage via override', () => {
    const overrides: OrgRoleOverrides = {
      admin: { deny: ['team.manage'] },
    };
    expect(hasPermission('admin', 'team.manage', overrides)).toBe(false);
  });

  it('deny takes precedence over base permissions', () => {
    const overrides: OrgRoleOverrides = {
      owner: { deny: ['agents.delete'] },
    };
    expect(hasPermission('owner', 'agents.delete', overrides)).toBe(false);
  });

  it('getEffectivePermissions applies grant + deny', () => {
    const overrides: OrgRoleOverrides = {
      viewer: {
        grant: ['agents.create'],
        deny: ['agents.view'],
      },
    };
    const perms = getEffectivePermissions('viewer', overrides);
    expect(perms).toContain('agents.create');
    expect(perms).not.toContain('agents.view');
  });
});

describe('role hierarchy safety', () => {
  it('every role has at least basic view permissions', () => {
    for (const role of ORG_ROLES) {
      const perms = getEffectivePermissions(role);
      expect(perms.length, `${role} has no permissions`).toBeGreaterThan(0);
    }
  });

  it('higher roles have strictly more permissions', () => {
    const hierarchy: OrgRole[] = ['viewer', 'editor', 'admin', 'owner'];
    for (let i = 1; i < hierarchy.length; i++) {
      const lower = getEffectivePermissions(hierarchy[i - 1]);
      const higher = getEffectivePermissions(hierarchy[i]);
      expect(higher.length).toBeGreaterThanOrEqual(lower.length);
    }
  });
});
