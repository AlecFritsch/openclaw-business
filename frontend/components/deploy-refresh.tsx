"use client";

import { useEffect } from "react";

/**
 * Detects stale client bundles after a deployment and auto-reloads.
 *
 * Next.js generates unique server action IDs per build. When the server is
 * redeployed, old browser tabs still reference the previous build's action IDs.
 * This causes "Failed to find Server Action" errors.
 *
 * This component catches those errors globally and triggers a single reload.
 * It also catches ChunkLoadError (stale JS chunks after deployment).
 */
export function DeployRefresh() {
  useEffect(() => {
    let reloading = false;

    const handleError = (event: ErrorEvent) => {
      if (reloading) return;
      const msg = event.message || "";
      const errStr = String(event.error) || "";

      const isStaleAction =
        msg.includes("Failed to find Server Action") ||
        errStr.includes("Failed to find Server Action");

      const isChunkError =
        msg.includes("ChunkLoadError") ||
        msg.includes("Loading chunk") ||
        errStr.includes("ChunkLoadError");

      if (isStaleAction || isChunkError) {
        reloading = true;
        window.location.reload();
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (reloading) return;
      const reason = String(event.reason || "");

      if (
        reason.includes("Failed to find Server Action") ||
        reason.includes("ChunkLoadError") ||
        reason.includes("Loading chunk")
      ) {
        reloading = true;
        window.location.reload();
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
