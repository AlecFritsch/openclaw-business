"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { useTranslations } from 'next-intl';
import { showToast } from "@/components/toast";
import { Check, Loader2, ArrowRight } from "lucide-react";
import { apiClient } from "@/lib/api-client";

const INDUSTRY_KEYS = ["real-estate", "agency", "consulting", "ecommerce", "services", "other"] as const;

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const { getToken } = useAuth();

  const industries = useMemo(() => INDUSTRY_KEYS.map((value) => ({ value, label: t(`industries.${value}`) })), [t]);
  const { createOrganization, setActive } = useOrganizationList();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({ orgName: "", industry: "" });
  const canProceed = formData.orgName.trim().length > 0;

  const handleCreateOrg = async () => {
    if (!canProceed) return;
    setLoading(true);
    try {
      if (!createOrganization || !setActive) {
        showToast("Organisation konnte nicht erstellt werden", "error");
        return;
      }
      const org = await createOrganization({ name: formData.orgName });
      await setActive({ organization: org.id });
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 800 + attempt * 400));
        const freshToken = await getToken({ skipCache: true });
        if (freshToken) {
          try { await apiClient.updateOrganization(freshToken, { industry: formData.industry }); break; } catch { /* retry */ }
        }
      }
      window.location.href = "/waiting";
    } catch { showToast("Fehler beim Erstellen", "error"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-card">
      {/* Left Panel (Desktop) */}
      <div className="hidden lg:flex lg:w-[400px] xl:w-[440px] bg-gray-950 text-white p-10 xl:p-12 flex-col justify-between fixed left-0 top-0 bottom-0 z-10">
        <div className="flex items-center gap-2.5">
          <Image src="https://ucarecdn.com/f9188e54-9da2-49b4-a1c7-9ebe496c7060/logo_transparent_weiss.png" alt="OpenClaw Business" width={24} height={24} className="h-6 w-auto" />
          <span className="text-sm font-medium tracking-tight">OpenClaw Business</span>
        </div>
        <div>
          <h2 className="text-2xl xl:text-3xl font-medium tracking-tight leading-[1.25] mb-8">AI Mitarbeiter für dein Business</h2>
          <div className="space-y-5">
            {[
              { title: "Autonome Agents", desc: "Arbeiten eigenständig, 24/7" },
              { title: "DSGVO-konform", desc: "EU-hosted, deine Daten bleiben bei dir" },
              { title: "In Minuten live", desc: "Kein Code, kein Setup-Aufwand" },
            ].map((feat, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 border border-white/20 flex items-center justify-center flex-shrink-0 mt-0.5"><Check size={10} strokeWidth={2} /></div>
                <div>
                  <div className="text-sm font-medium">{feat.title}</div>
                  <div className="text-xs text-white/40 mt-0.5">{feat.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs text-white/25 font-mono tracking-wide">DSGVO-konform · EU-hosted · ISO 27001</div>
      </div>

      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between px-5 py-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Image src="https://ucarecdn.com/df601530-a09a-4c18-b5e4-ed8072cfdf24/logo_transparent_dunkel.png" alt="OpenClaw Business" width={20} height={20} className="h-5 w-auto dark:hidden" />
          <Image src="https://ucarecdn.com/f9188e54-9da2-49b4-a1c7-9ebe496c7060/logo_transparent_weiss.png" alt="OpenClaw Business" width={20} height={20} className="h-5 w-auto hidden dark:block" />
          <span className="text-sm font-medium tracking-tight">OpenClaw Business</span>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 lg:ml-[400px] xl:ml-[440px] min-h-screen flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-10 xl:px-14">
          <div className="w-full max-w-lg space-y-8">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2">Wie heißt dein Unternehmen?</h1>
              <p className="text-sm text-muted-foreground">Wir richten deinen Workspace ein.</p>
            </div>
            <div className="space-y-5">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Unternehmensname</label>
                <input type="text" value={formData.orgName} onChange={(e) => setFormData({ ...formData, orgName: e.target.value })} placeholder="z.B. Mustermann Immobilien"
                  className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-all placeholder:text-muted-foreground/50" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Branche</label>
                <div className="grid grid-cols-2 gap-2">
                  {industries.map((ind) => (
                    <button key={ind.value} onClick={() => setFormData({ ...formData, industry: ind.value })}
                      className={`px-3 py-2 text-xs rounded-lg border transition-all text-left outline-none focus:outline-none focus-visible:outline-none focus:ring-0 active:outline-none ${formData.industry === ind.value ? 'border-foreground bg-foreground/5 font-medium' : 'border-border hover:border-foreground/30 text-muted-foreground'}`}>
                      {ind.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={handleCreateOrg} disabled={!canProceed || loading}
                className="flex items-center gap-2 px-5 py-2.5 text-sm bg-foreground text-primary-foreground rounded-lg hover:bg-foreground/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><span>Weiter</span><ArrowRight className="w-3.5 h-3.5" /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
