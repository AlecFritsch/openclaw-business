// ── Granulare RBAC Permissions ───────────────────────────────────
// Rollen, Permissions, statisches Mapping, pure Helper-Functions.
// Shared zwischen Frontend + Backend.

/** Alle granularen Permissions (36 Actions) */
export type Permission =
  // Agents
  | 'agents.create'
  | 'agents.delete'
  | 'agents.view'
  | 'agents.configure'
  | 'agents.deploy'
  | 'agents.channels.manage'
  | 'agents.workspace.edit'
  | 'agents.skills.manage'
  | 'agents.workflows.manage'
  | 'agents.team.manage'
  // Sessions & Messages
  | 'sessions.view'
  | 'sessions.send'
  | 'sessions.manage'
  // Billing
  | 'billing.view'
  | 'billing.manage'
  // Analytics
  | 'analytics.view'
  | 'analytics.export'
  // Audit
  | 'audit.view'
  | 'audit.export'
  | 'audit.verify'
  // Providers
  | 'providers.view'
  | 'providers.manage'
  // Team / Org
  | 'team.view'
  | 'team.invite'
  | 'team.manage'
  // Settings
  | 'settings.view'
  | 'settings.manage'
  // API Keys
  | 'api_keys.view'
  | 'api_keys.manage'
  // Logs
  | 'logs.view'
  // Contacts
  | 'contacts.view'
  | 'contacts.manage'
  // Integrations
  | 'integrations.manage'
  // Webhooks
  | 'webhooks.manage'
  // Approvals
  | 'approvals.view'
  | 'approvals.manage';

/** Org-Level Rollen */
export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'billing_admin';

/** Alle verfuegbaren Rollen in Reihenfolge (hoechste zuerst) */
export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'editor', 'viewer', 'billing_admin'];

/** Statisches Mapping: Welche Rolle hat welche Permissions */
export const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  owner: [
    'agents.create', 'agents.delete', 'agents.view', 'agents.configure', 'agents.deploy',
    'agents.channels.manage', 'agents.workspace.edit', 'agents.skills.manage',
    'agents.workflows.manage', 'agents.team.manage',
    'sessions.view', 'sessions.send', 'sessions.manage',
    'billing.view', 'billing.manage',
    'analytics.view', 'analytics.export',
    'audit.view', 'audit.export', 'audit.verify',
    'providers.view', 'providers.manage',
    'team.view', 'team.invite', 'team.manage',
    'settings.view', 'settings.manage',
    'api_keys.view', 'api_keys.manage',
    'logs.view',
    'contacts.view', 'contacts.manage',
    'integrations.manage',
    'webhooks.manage',
    'approvals.view', 'approvals.manage',
  ],

  admin: [
    'agents.create', 'agents.delete', 'agents.view', 'agents.configure', 'agents.deploy',
    'agents.channels.manage', 'agents.workspace.edit', 'agents.skills.manage',
    'agents.workflows.manage', 'agents.team.manage',
    'sessions.view', 'sessions.send', 'sessions.manage',
    'billing.view',
    'analytics.view', 'analytics.export',
    'audit.view', 'audit.export', 'audit.verify',
    'providers.view', 'providers.manage',
    'team.view', 'team.invite', 'team.manage',
    'settings.view', 'settings.manage',
    'api_keys.view', 'api_keys.manage',
    'logs.view',
    'contacts.view', 'contacts.manage',
    'integrations.manage',
    'webhooks.manage',
    'approvals.view', 'approvals.manage',
  ],

  editor: [
    'agents.view', 'agents.configure', 'agents.deploy',
    'agents.channels.manage', 'agents.workspace.edit', 'agents.skills.manage',
    'agents.workflows.manage',
    'sessions.view', 'sessions.send',
    'billing.view',
    'analytics.view',
    'audit.view',
    'providers.view',
    'team.view',
    'settings.view',
    'api_keys.view',
    'logs.view',
    'contacts.view', 'contacts.manage',
    'integrations.manage',
    'webhooks.manage',
    'approvals.view', 'approvals.manage',
  ],

  viewer: [
    'agents.view',
    'sessions.view',
    'billing.view',
    'analytics.view',
    'audit.view',
    'providers.view',
    'team.view',
    'settings.view',
    'api_keys.view',
    'logs.view',
    'contacts.view',
    'approvals.view',
  ],

  billing_admin: [
    'billing.view', 'billing.manage',
    'analytics.view', 'analytics.export',
    'audit.view',
    'team.view',
    'settings.view',
    'logs.view',
  ],
};

/** Clerk-Rolle auf Havoc OrgRole mappen (Abwaertskompatibilitaet) */
export function mapClerkRole(clerkRole: string | undefined): OrgRole {
  switch (clerkRole) {
    case 'org:admin': return 'admin';
    case 'org:member': return 'editor';
    default: return 'viewer';
  }
}

/**
 * Prueft ob eine Rolle eine bestimmte Permission hat.
 * Beruecksichtigt optionale Org-Level Overrides.
 */
export function hasPermission(
  role: OrgRole,
  permission: Permission,
  overrides?: OrgRoleOverrides,
): boolean {
  // Custom Overrides haben Vorrang
  if (overrides) {
    const roleOverride = overrides[role];
    if (roleOverride) {
      if (roleOverride.deny?.includes(permission)) return false;
      if (roleOverride.grant?.includes(permission)) return true;
    }
  }
  // Fallback: statisches Mapping
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Gibt alle effektiven Permissions fuer eine Rolle zurueck.
 * Beruecksichtigt optionale Org-Level Overrides.
 */
export function getEffectivePermissions(
  role: OrgRole,
  overrides?: OrgRoleOverrides,
): Permission[] {
  const base = ROLE_PERMISSIONS[role] || [];
  if (!overrides) return [...base];

  const roleOverride = overrides[role];
  if (!roleOverride) return [...base];

  let permissions = new Set<Permission>(base);

  // Grants hinzufuegen
  if (roleOverride.grant) {
    for (const p of roleOverride.grant) permissions.add(p);
  }

  // Denies entfernen
  if (roleOverride.deny) {
    for (const p of roleOverride.deny) permissions.delete(p);
  }

  return Array.from(permissions);
}

/** Org-Level Custom Overrides (pro Rolle: zusaetzliche Grants oder Denies) */
export type OrgRoleOverrides = Partial<Record<OrgRole, {
  grant?: Permission[];
  deny?: Permission[];
}>>;

/** API Response fuer /api/organization/permissions */
export interface UserPermissionsResponse {
  role: OrgRole;
  permissions: Permission[];
}

/** API Response fuer /api/organization/roles */
export interface RolesListResponse {
  roles: Array<{
    id: OrgRole;
    name: string;
    description: string;
    permissions: Permission[];
    isCustomizable: boolean;
  }>;
}
