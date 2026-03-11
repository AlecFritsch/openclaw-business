"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { showToast } from "@/components/toast";
import { AppShell } from "@/components/app-shell";
import { apiClient } from "@/lib/api-client";

export default function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [templateId, setTemplateId] = useState<string>('');
  const [template, setTemplate] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { getToken } = useAuth();
  const router = useRouter();
  const t = useTranslations('marketplaceDetail');
  const tc = useTranslations('common');
  const toast = useTranslations('toasts');

  useEffect(() => {
    params.then(p => setTemplateId(p.id));
  }, [params]);

  useEffect(() => {
    if (!templateId) return;
    const fetchTemplate = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await apiClient.getTemplate(token, templateId);
        setTemplate(data.template || data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Template not found');
      } finally {
        setIsLoading(false);
      }
    };
    fetchTemplate();
  }, [templateId, getToken]);

  const handleDeploy = async () => {
    setIsDeploying(true);
    try {
      const token = await getToken();
      if (!token) return;
      const result = await apiClient.deployFromTemplate(token, templateId, {});
      showToast(toast("agentDeployed"), "success");
      if (result.agent?._id) {
        router.push(`/agents/${result.agent._id}`);
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Deployment failed", "error");
      setIsDeploying(false);
    }
  };

  const getCategoryCode = (cat: string) => {
    switch (cat) {
      case 'sales': return 'SL';
      case 'support': return 'SP';
      case 'marketing': return 'MK';
      case 'operations': return 'OP';
      case 'finance': return 'FN';
      default: return 'AG';
    }
  };

  if (isLoading) {
    return (
      <AppShell embedded>
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-gray-300 dark:border-border border-t-foreground rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (error || !template) {
    return (
      <AppShell embedded>
        <div className="mb-8">
          <Link href="/templates" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {t('backToMarketplace')}
          </Link>
        </div>
        <div className="text-center text-red-500 py-12">{error || t('notFound')}</div>
      </AppShell>
    );
  }

  return (
    <AppShell embedded>
      <div>
        <div className="mb-8">
          <Link href="/templates" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {t('backToMarketplace')}
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2 space-y-12">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-20 h-20 rounded-xl border-2 border-gray-300 dark:border-border flex items-center justify-center text-xl font-mono">
                  {template.icon || getCategoryCode(template.category)}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h1 className="text-2xl font-medium">{template.name}</h1>
                      <p className="text-sm text-muted-foreground mt-1 capitalize">{template.category}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-green-600 dark:text-green-400">Included in plan</div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-4">{template.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-6 text-sm">
                <span className="text-muted-foreground">{template.popularity || 0} {t('deployments')}</span>
                {template.channels?.length > 0 && (
                  <span className="text-muted-foreground">{template.channels.length} {t('channels')}</span>
                )}
              </div>
            </motion.div>

            {/* Features */}
            {template.features?.length > 0 && (
              <div className="space-y-4">
                <h2 className="section-header">{t('features')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {template.features.map((feature: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground mt-0.5">→</span>
                      <span className="text-muted-foreground">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Integrations */}
            {template.integrations?.length > 0 && (
              <div className="space-y-4">
                <h2 className="section-header">{t('integrations')}</h2>
                <div className="flex flex-wrap gap-2">
                  {template.integrations.map((int: string) => (
                    <div key={int} className="px-3 py-1.5 rounded-lg border border-border text-xs">{int}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Channels */}
            {template.channels?.length > 0 && (
              <div className="space-y-4">
                <h2 className="section-header">{t('channels')}</h2>
                <div className="flex flex-wrap gap-2">
                  {template.channels.map((ch: string) => (
                    <div key={ch} className="px-3 py-1.5 rounded-lg border border-border text-xs capitalize">{ch}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="card sticky top-24 space-y-6">
              <button onClick={handleDeploy} disabled={isDeploying} className="btn-primary-sm w-full py-3 disabled:opacity-50">
                {isDeploying ? tc('deploying') : t('deployAgent')}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                {t('customizeNote')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
