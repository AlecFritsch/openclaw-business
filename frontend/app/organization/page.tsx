"use client";

import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { useTranslations } from 'next-intl';
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { AppShell } from "@/components/app-shell";
import { Dropdown } from "@/components/ui/dropdown";
import { usePermissions } from '@/lib/use-permissions';
import { invalidatePermissionsCache } from '@/lib/use-permissions';
import { PermissionGate } from '@/components/permission-gate';
import { apiClient } from '@/lib/api-client';

const HAVOC_ROLES = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'billing_admin', label: 'Billing Admin' },
];

export default function OrganizationPage() {
  const { getToken, userId: myUserId } = useAuth();
  const {
    isLoaded,
    organization,
    memberships,
    invitations,
  } = useOrganization({
    memberships: { infinite: true },
    invitations: { infinite: true },
  });

  const t = useTranslations('organization');
  const tc = useTranslations('common');
  const toast = useTranslations('toasts');
  const tRbac = useTranslations('rbac');
  const confirm = useConfirm();

  const { can, role: myRole, refetch: refetchPermissions } = usePermissions();
  
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("org:member");
  const [orgName, setOrgName] = useState("");
  const [memberRoles, setMemberRoles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (organization) {
      setOrgName(organization.name || "");
    }
  }, [organization]);

  // Load member Havoc roles from backend permissions
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await apiClient.getTeamMembers(token);
        if (data?.members && Array.isArray(data.members)) {
          const roleMap: Record<string, string> = {};
          for (const m of data.members) {
            if (m.id && m.role) roleMap[m.id] = m.role;
          }
          setMemberRoles(roleMap);
        }
      } catch (err) {
      }
    })();
  }, [getToken]);

  const handleSaveOrg = async () => {
    if (!orgName.trim()) {
      showToast(toast("orgNameEmpty"), "error");
      return;
    }
    if (!organization) return;
    try {
      await organization.update({ name: orgName });
      showToast(toast("orgUpdated"), "success");
    } catch (error) {
      showToast(toast("orgUpdateFailed"), "error");
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      showToast(toast("emailRequired"), "error");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inviteEmail)) {
      showToast(toast("emailInvalid"), "error");
      return;
    }
    if (!organization) return;
    try {
      const token = await getToken();
      if (!token) return;
      const clerkRole = inviteRole === 'org:admin' ? 'Admin' : 'Member';
      await apiClient.inviteTeamMember(token, inviteEmail, clerkRole);
      showToast(toast("inviteSent"), "success");
      setShowInvite(false);
      setInviteEmail("");
      setInviteRole("org:member");
    } catch (error) {
      showToast(toast("inviteFailed"), "error");
    }
  };

  const handleRemove = async (userId: string, name: string) => {
    if (!await confirm({ description: t('removeConfirm', { name }), confirmLabel: tc('remove') || 'Remove', variant: 'destructive' })) return;
    if (!organization) return;
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.removeTeamMember(token, userId);
      showToast(toast("memberRemoved"), "success");
      memberships?.revalidate?.();
    } catch (error) {
      showToast(toast("memberRemoveFailed"), "error");
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.setMemberRole(token, userId, newRole);
      setMemberRoles(prev => ({ ...prev, [userId]: newRole }));
      invalidatePermissionsCache();
      await refetchPermissions();
      showToast(tRbac("roleChanged"), "success");
    } catch (error: any) {
      const msg = error?.message || toast("roleUpdateFailed");
      showToast(msg, "error");
    }
  };

  if (!isLoaded) {
    return (
      <AppShell embedded>
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-gray-300 dark:border-border border-t-foreground rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!organization) {
    return (
      <AppShell embedded>
        <div className="mb-8">
          <h1 className="text-2xl font-medium mb-2">{t('noOrg')}</h1>
          <p className="text-sm text-muted-foreground">{t('noOrgDesc')}</p>
        </div>
        <div className="card text-center py-12">
          <p className="text-sm text-muted-foreground mb-4">{t('noOrgNote')}</p>
          <button onClick={() => window.location.href = '/onboarding'} className="btn-primary-sm px-6">
            {t('goToOnboarding')}
          </button>
        </div>
      </AppShell>
    );
  }

  const teamMembers = memberships?.data || [];
  const pendingInvitations = invitations?.data || [];

  // Determine which Havoc role options to show in dropdown
  const getRoleOptions = (targetMemberClerkRole?: string) => {
    const opts = HAVOC_ROLES.map(r => ({
      value: r.value,
      label: tRbac(`roles.${r.value}` as any),
    }));
    // Only owners can assign owner role
    if (myRole !== 'owner') {
      return opts.filter(o => o.value !== 'owner');
    }
    return opts;
  };

  const getMemberHavocRole = (userId: string): string => {
    return memberRoles[userId] || 'editor';
  };

  return (
    <AppShell embedded>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-medium mb-2">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {/* Organization Info */}
      <div className="card space-y-6 mb-8">
        <div>
          <h3 className="section-header mb-1">
            {t('orgDetails')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('orgDetailsDesc')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">{t('orgName')}</label>
            <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} className="input" />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">{t('orgId')}</label>
            <input type="text" value={organization.id || ""} className="input font-mono" disabled />
          </div>
        </div>
        <PermissionGate permission="settings.manage">
          <button onClick={handleSaveOrg} className="btn-primary-sm px-4">{tc('saveChanges')}</button>
        </PermissionGate>
      </div>

      {/* Team Members */}
      <div className="space-y-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">{t('teamMembers')}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {t('memberCount', { count: teamMembers.length })}
            </p>
          </div>
          <PermissionGate permission="team.invite">
            <button onClick={() => setShowInvite(true)} className="btn-primary-sm px-4">
              {t('inviteMember')}
            </button>
          </PermissionGate>
        </div>

        {showInvite && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="card space-y-4">
            <h4 className="section-header">{t('inviteTeamMember')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('emailAddress')}</label>
                <input type="email" placeholder={t('emailPlaceholder')} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="input" />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('roleLabel')}</label>
                <Dropdown
                  value={inviteRole}
                  onChange={setInviteRole}
                  options={[
                    { value: "org:member", label: t('member') },
                    { value: "org:admin", label: t('admin') },
                  ]}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleInvite} className="btn-primary-sm px-4">{t('sendInvitation')}</button>
              <button onClick={() => setShowInvite(false)} className="btn-ghost-sm px-4">{tc('cancel')}</button>
            </div>
          </motion.div>
        )}

        {teamMembers.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-sm text-muted-foreground">{t('noTeamMembers')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {teamMembers.map((member, i) => {
              const userId = member.publicUserData?.userId ?? '';
              const havocRole = getMemberHavocRole(userId);
                      const isSelf = userId === myUserId;
                      return (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="card"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="w-10 h-10 shrink-0 rounded-full border border-gray-300 dark:border-border flex items-center justify-center text-xs font-mono bg-secondary/50">
                        {member.publicUserData?.firstName?.[0] || 'U'}
                        {member.publicUserData?.lastName?.[0] || ''}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {member.publicUserData?.firstName} {member.publicUserData?.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {member.publicUserData?.identifier}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap">
                      <Dropdown
                        value={havocRole}
                        onChange={(newRole) => handleRoleChange(userId, newRole)}
                        options={getRoleOptions(member.role)}
                        disabled={isSelf || !can('team.manage') || (havocRole === 'owner' && myRole !== 'owner')}
                        size="sm"
                        className="w-36"
                      />
                      {can('team.manage') && !isSelf && havocRole !== 'owner' && (
                        <button
                          onClick={() => handleRemove(member.publicUserData?.userId ?? '', `${member.publicUserData?.firstName ?? ''} ${member.publicUserData?.lastName ?? ''}`)}
                          className="btn-ghost-sm px-4 text-red-600 hover:text-red-700"
                        >
                          {tc('remove')}
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Roles & Permissions — hidden for SMB simplification */}
    </AppShell>
  );
}
