'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { apiClient } from './api-client';
import type { Permission, OrgRole } from '@openclaw-business/shared';

interface UsePermissionsReturn {
  /** Resolved RBAC role */
  role: OrgRole | null;
  /** All effective permissions */
  permissions: Permission[];
  /** Check if user has a specific permission */
  can: (permission: Permission) => boolean;
  /** Check if user has ALL of the specified permissions */
  canAll: (...permissions: Permission[]) => boolean;
  /** Check if user has ANY of the specified permissions */
  canAny: (...permissions: Permission[]) => boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: string | null;
  /** Refetch permissions */
  refetch: () => Promise<void>;
}

let _cachedPermissions: { role: OrgRole; permissions: Permission[] } | null = null;
let _cacheOrgId: string | null = null;

/**
 * Hook that fetches and caches the current user's RBAC role and permissions.
 * Uses a module-level cache so multiple components don't trigger multiple fetches.
 */
export function usePermissions(): UsePermissionsReturn {
  const { getToken, orgId } = useAuth();
  const [role, setRole] = useState<OrgRole | null>(_cachedPermissions?.role ?? null);
  const [permissions, setPermissions] = useState<Permission[]>(_cachedPermissions?.permissions ?? []);
  const [isLoading, setIsLoading] = useState(!_cachedPermissions);
  const [error, setError] = useState<string | null>(null);

  const fetchPermissions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const token = await getToken();
      if (!token) {
        setError('Not authenticated');
        return;
      }
      const data = await apiClient.getUserPermissions(token);
      const result = {
        role: data.role as OrgRole,
        permissions: data.permissions as Permission[],
      };
      _cachedPermissions = result;
      _cacheOrgId = orgId ?? null;
      setRole(result.role);
      setPermissions(result.permissions);
    } catch (err: any) {
      setError(err?.message || 'Failed to load permissions');
    } finally {
      setIsLoading(false);
    }
  }, [getToken, orgId]);

  useEffect(() => {
    // Invalidate cache if org changed
    if (_cacheOrgId !== (orgId ?? null)) {
      _cachedPermissions = null;
    }

    if (!_cachedPermissions) {
      fetchPermissions();
    } else {
      setRole(_cachedPermissions.role);
      setPermissions(_cachedPermissions.permissions);
      setIsLoading(false);
    }
  }, [fetchPermissions, orgId]);

  const can = useCallback(
    (permission: Permission) => permissions.includes(permission),
    [permissions],
  );

  const canAll = useCallback(
    (...required: Permission[]) => required.every((p) => permissions.includes(p)),
    [permissions],
  );

  const canAny = useCallback(
    (...required: Permission[]) => required.some((p) => permissions.includes(p)),
    [permissions],
  );

  return useMemo(
    () => ({ role, permissions, can, canAll, canAny, isLoading, error, refetch: fetchPermissions }),
    [role, permissions, can, canAll, canAny, isLoading, error, fetchPermissions],
  );
}

/** Invalidate the cached permissions (call after role change) */
export function invalidatePermissionsCache() {
  _cachedPermissions = null;
  _cacheOrgId = null;
}
