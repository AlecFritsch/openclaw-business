'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslations } from 'next-intl';

interface RoleCardProps {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isCustomizable: boolean;
  isActive?: boolean;
}

const PERMISSION_CATEGORIES: Record<string, string[]> = {
  agents: ['agents.create', 'agents.delete', 'agents.view', 'agents.configure', 'agents.deploy', 'agents.channels.manage', 'agents.workspace.edit', 'agents.skills.manage', 'agents.workflows.manage', 'agents.team.manage'],
  sessions: ['sessions.view', 'sessions.send', 'sessions.manage'],
  billing: ['billing.view', 'billing.manage'],
  analytics: ['analytics.view', 'analytics.export'],
  audit: ['audit.view', 'audit.export', 'audit.verify'],
  providers: ['providers.view', 'providers.manage'],
  team: ['team.view', 'team.invite', 'team.manage'],
  settings: ['settings.view', 'settings.manage'],
  approvals: ['approvals.view', 'approvals.manage'],
  other: ['api_keys.view', 'api_keys.manage', 'logs.view', 'contacts.view', 'contacts.manage', 'integrations.manage', 'webhooks.manage'],
};

export function RoleCard({ id, name, description, permissions, isCustomizable, isActive }: RoleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations('rbac');

  const groupedPermissions = Object.entries(PERMISSION_CATEGORIES)
    .map(([category, allPerms]) => ({
      category,
      granted: allPerms.filter(p => permissions.includes(p)),
      total: allPerms.length,
    }))
    .filter(g => g.granted.length > 0);

  return (
    <div className={`border rounded-xl transition-all ${isActive ? 'border-black dark:border-foreground bg-muted' : 'border-border'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-4 p-4 text-left"
      >
        <div className={`w-8 h-8 flex items-center justify-center text-xs font-mono shrink-0 mt-0.5 rounded-lg ${isActive ? 'bg-foreground text-primary-foreground' : 'border border-gray-300 dark:border-border'}`}>
          {name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{name}</span>
            <span className="text-xs text-muted-foreground font-mono">
              {permissions.length} {permissions.length === 1 ? 'permission' : 'permissions'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-border/60 pt-3">
              {groupedPermissions.map(({ category, granted, total }) => (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                      {category}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {granted.length}/{total}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {granted.map(perm => (
                      <span
                        key={perm}
                        className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground rounded font-mono"
                      >
                        {perm.split('.').pop()}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
