"use client";

import { useState, useEffect, Suspense } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams, useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import { AppShell } from "@/components/app-shell";
import { Check, X } from "lucide-react";
import { SignIn, SignUp } from "@clerk/nextjs";

function InviteAcceptContent() {
  const { isSignedIn, getToken } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error" | "signin">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Invalid invitation link. No token provided.");
      return;
    }

    if (!isSignedIn) {
      setStatus("signin");
      return;
    }

    (async () => {
      try {
        const authToken = await getToken();
        if (!authToken) {
          setStatus("signin");
          return;
        }
        const result = await apiClient.acceptInvitation(authToken, token);
        setStatus("success");
        setMessage(result.message || "You've joined the organization!");
        showToast(result.message || "Welcome to the team!", "success");
        setTimeout(() => router.push("/organization"), 1500);
      } catch (err: any) {
        setStatus("error");
        setMessage(err?.message || "Failed to accept invitation");
        showToast(err?.message || "Could not accept invitation", "error");
      }
    })();
  }, [token, isSignedIn, getToken, router]);

  if (status === "signin") {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
        <h1 className="text-2xl font-medium mb-2">Sign in to accept</h1>
        <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
          You need to sign in to accept this invitation. If you don&apos;t have an account, sign up first.
        </p>
        <SignIn
          forceRedirectUrl={`/invite/accept?token=${token}`}
          fallbackRedirectUrl={`/invite/accept?token=${token}`}
        />
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-300 dark:border-border border-t-foreground rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground mt-4">Accepting invitation...</p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center px-4">
        <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <Check className="w-6 h-6 text-green-600 dark:text-green-400" strokeWidth={2} />
        </div>
        <h1 className="text-2xl font-medium mb-2">Welcome!</h1>
        <p className="text-sm text-muted-foreground text-center">{message}</p>
        <p className="text-xs text-muted-foreground mt-2">Redirecting to organization...</p>
      </div>
    );
  }

  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center px-4">
      <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
        <X className="w-6 h-6 text-red-600 dark:text-red-400" strokeWidth={2} />
      </div>
      <h1 className="text-2xl font-medium mb-2">Invitation failed</h1>
      <p className="text-sm text-muted-foreground text-center max-w-md">{message}</p>
      <button
        onClick={() => router.push("/")}
        className="mt-6 text-sm px-4 py-2 bg-foreground text-primary-foreground rounded-lg hover:opacity-80"
      >
        Go to Dashboard
      </button>
    </div>
  );
}

export default function InviteAcceptPage() {
  return (
    <AppShell embedded>
      <Suspense
        fallback={
          <div className="min-h-[40vh] flex flex-col items-center justify-center">
            <div className="w-6 h-6 border-2 border-gray-300 dark:border-border border-t-foreground rounded-full animate-spin" />
          </div>
        }
      >
        <InviteAcceptContent />
      </Suspense>
    </AppShell>
  );
}
