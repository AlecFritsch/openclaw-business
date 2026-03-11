"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";

const ALLOWED_WHEN_UNPAID = ["/waiting", "/billing", "/onboarding"];

export function PlanGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { getToken, orgId, isSignedIn } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isUnpaid, setIsUnpaid] = useState(false);

  useEffect(() => {
    if (!isSignedIn || !orgId) {
      setChecking(false);
      return;
    }

    const allowed = ALLOWED_WHEN_UNPAID.some((p) => pathname?.startsWith(p));
    if (allowed) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    getToken()
      .then((token) => {
        if (!token || cancelled) return;
        return apiClient.getUsage(token);
      })
      .then((res) => {
        if (cancelled) return;
        const plan = res?.usage?.plan;
        setIsUnpaid(plan === "unpaid" || plan === "trial");
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, orgId, isSignedIn, getToken]);

  useEffect(() => {
    if (!checking && isUnpaid) {
      const allowed = ALLOWED_WHEN_UNPAID.some((p) => pathname?.startsWith(p));
      if (!allowed) {
        window.location.href = "/waiting";
      }
    }
  }, [checking, isUnpaid, pathname]);

  return <>{children}</>;
}
