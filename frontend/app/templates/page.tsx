"use client";

import { Suspense } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import type { Template } from "@openclaw-business/shared";

const categoryKeys = ["all", "sales", "support", "operations"] as const;

export default function MarketplacePage() {
  const t = useTranslations('marketplace');

  return (
    <Suspense fallback={
      <AppShell embedded>
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-gray-300 dark:border-border border-t-foreground rounded-full animate-spin" />
        </div>
      </AppShell>
    }>
      <MarketplaceContent />
    </Suspense>
  );
}

function MarketplaceContent() {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const t = useTranslations('marketplace');
  const tc = useTranslations('common');
  const toast = useTranslations('toasts');
  const isOnboarding = searchParams.get("onboarding") === "1";
  const initialCategory = searchParams.get("category");

  const [selectedCategory, setSelectedCategory] = useState(
    initialCategory ? categoryKeys.find((c) => c === initialCategory) || "all" : "all"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const params: any = {};
        if (selectedCategory !== "all") params.category = selectedCategory;
        if (searchQuery) params.search = searchQuery;
        const data = await apiClient.getTemplates(token, params);
        setTemplates(data.templates || []);
      } catch (error) {
      } finally {
        setIsLoading(false);
      }
    };
    fetchTemplates();
  }, [getToken, selectedCategory, searchQuery]);

  const handleDeploy = async (templateId: string, templateName: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.deployFromTemplate(token, templateId);
      showToast(`${templateName} deployed successfully!`, "success");
    } catch (error) {
      showToast(toast("deployFailed"), "error");
    }
  };

  const getCategoryCode = (category: string): string => {
    const codes: Record<string, string> = {
      sales: "SL", support: "SP", marketing: "EM", operations: "OP", finance: "FI",
    };
    return codes[category] || "AG";
  };

  return (
    <AppShell embedded>
      <div>
        {/* Onboarding welcome banner */}
        {isOnboarding && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-6 rounded-xl border-2 border-black dark:border-foreground bg-muted"
          >
            <h2 className="text-lg font-medium mb-1">{t('deployFirst')}</h2>
            <p className="text-sm text-muted-foreground mb-3">
              {t('deployFirstDesc')}{" "}
              <Link href="/agents/builder" className="underline hover:text-foreground">
                {t('buildCustom')}
              </Link>{" "}
              {t('buildCustomSuffix')}
            </p>
          </motion.div>
        )}

        <div className="mb-12">
          <h1 className="text-2xl font-medium mb-2">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('description')}
          </p>
        </div>

        {/* Search & Filters */}
        <div className="space-y-6 mb-12">
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input"
          />
          <div className="flex gap-2 overflow-x-auto pb-2">
            {categoryKeys.map((key) => (
              <button
                key={key}
                onClick={() => setSelectedCategory(key)}
                className={`px-4 py-2 text-xs rounded-lg border transition-colors whitespace-nowrap ${
                  selectedCategory === key
                    ? "bg-foreground text-primary-foreground border-black dark:border-foreground"
                    : "bg-card text-foreground border-border hover:border-foreground/30"
                }`}
              >
                {t(`categories.${key}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Templates Grid */}
        {isLoading ? (
          <div className="text-center text-muted-foreground py-16">{t('loadingTemplates')}</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">
              {t('noTemplates')} {searchQuery ? t('tryDifferent') : t('templatesWillAppear')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template, index) => (
              <motion.div
                key={template._id?.toString()}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <div className="card h-full hover:border-foreground/30 transition-all group">
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-lg border border-gray-300 dark:border-border flex items-center justify-center text-sm font-mono group-hover:border-black dark:group-hover:border-white group-hover:bg-black dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-black transition-colors">
                        {template.icon || getCategoryCode(template.category)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{template.name}</h3>
                        <div className="text-xs text-muted-foreground mt-1 capitalize">{template.category}</div>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{template.description}</p>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">{template.popularity} {t('deploys')}</span>
                      </div>
                      <span className="text-green-600 dark:text-green-400 font-medium">{t('included')}</span>
                    </div>
                    <button
                      onClick={() => handleDeploy(template._id!.toString(), template.name)}
                      className="btn-primary-sm w-full"
                    >
                      {t('deploy')}
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
