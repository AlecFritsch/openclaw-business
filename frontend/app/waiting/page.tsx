"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AppShell } from "@/components/app-shell";
import { apiClient } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { showToast } from "@/components/toast";
import { CreditCard, Loader2 } from "lucide-react";

export default function WaitingPage() {
  const { getToken } = useAuth();
  const { can } = usePermissions();
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    if (!can("billing.manage")) {
      showToast("Nur Admins können den Plan abschließen.", "error");
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const { url } = await apiClient.createCheckout(token);
      window.location.href = url;
    } catch {
      showToast("Checkout konnte nicht gestartet werden.", "error");
      setLoading(false);
    }
  };

  return (
    <AppShell embedded>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl border border-border flex items-center justify-center mx-auto mb-6">
            <CreditCard className="w-7 h-7 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-medium mb-2">Professional Plan aktivieren</h1>
          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            €250 pro User pro Monat. Schließe jetzt ab, um loszulegen.
          </p>
          <button
            onClick={handleCheckout}
            disabled={loading || !can("billing.manage")}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm bg-foreground text-primary-foreground rounded-lg hover:bg-foreground/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            {loading ? "Wird geladen…" : "Zum Stripe Checkout"}
          </button>
          <p className="text-xs text-muted-foreground mt-6">
            Fragen?{" "}
            <a href="mailto:support@your-domain.com" className="text-foreground hover:underline">support@your-domain.com</a>
          </p>
        </div>
      </div>
    </AppShell>
  );
}
