'use client';

import { ReactNode } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import type { Permission } from '@openclaw-business/shared';

interface PermissionGateProps {
  /** Required permission(s). If array, ALL must be present. */
  permission: Permission | Permission[];
  /** Render when user has permission */
  children: ReactNode;
  /** Optional fallback when user lacks permission */
  fallback?: ReactNode;
  /** If true, require ANY of the permissions instead of ALL */
  any?: boolean;
}

/**
 * Renders children only if the current user has the required permission(s).
 * While loading, renders nothing (avoids flash of forbidden content).
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
  any: matchAny = false,
}: PermissionGateProps) {
  const { can, canAll, canAny, isLoading } = usePermissions();

  if (isLoading) return null;

  const perms = Array.isArray(permission) ? permission : [permission];
  const hasAccess = matchAny ? canAny(...perms) : canAll(...perms);

  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
