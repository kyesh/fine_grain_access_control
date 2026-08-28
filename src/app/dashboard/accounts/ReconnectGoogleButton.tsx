"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { usePostHog } from "posthog-js/react";
import {
  startGoogleReconnect, DRIVE_FILE_SCOPE, GMAIL_MODIFY_SCOPE, type ClerkUserLike,
} from "../googleReconnect";

/**
 * The control every "reconnect Google from the Accounts page" message points
 * at. Runs the shared reconnect leg (reauthorize, or destroy+recreate for a
 * broken grant) and sends the user through Google's consent, returning here
 * with ?reconnected=1. Failures render inline — never a button that silently
 * does nothing.
 *
 * Gmail is requested explicitly (not just drive.file): the missing-scope
 * lockout this button remediates is a grant whose Gmail checkbox was left
 * unchecked, and only listing the scope guarantees Google re-presents it.
 *
 * `?reconnect=1` (minted into MCP tool errors) auto-fires the flow on load so
 * the agent's link is one click from Google's consent screen — but ONLY on
 * the safe reauthorize branch: a non-verified account takes the
 * destroy+recreate leg, which must stay behind an explicit click.
 */
export function ReconnectGoogleButton({ prominent = false }: { prominent?: boolean }) {
  const { user, isLoaded } = useUser();
  const posthog = usePostHog();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoFired = useRef(false);
  const justReconnected = params.get("reconnected") === "1";
  const autoRequested = params.get("reconnect") === "1";

  const start = async (source: string) => {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    posthog?.capture("google_reconnect_started", { source });
    try {
      const url = await startGoogleReconnect(
        user as unknown as ClerkUserLike,
        `${window.location.origin}/dashboard/accounts?reconnected=1`,
        [GMAIL_MODIFY_SCOPE, DRIVE_FILE_SCOPE],
      );
      window.location.href = url;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[accounts] Google reconnect failed:", err);
      posthog?.capture("picker_flow_error", { stage: "accounts_reconnect", message });
      setError(
        `Could not start Google authorization (${message}). Retry in a moment; if it keeps failing, sign out and back in, then try again.`,
      );
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!autoRequested || autoFired.current || !isLoaded || !user || justReconnected) return;
    const google = user.externalAccounts.find(
      acc => acc.provider === "google" || (acc.provider as string) === "oauth_google",
    );
    if (google?.verification?.status !== "verified") return;
    autoFired.current = true;
    void start("agent_link");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when the session hydrates
  }, [autoRequested, isLoaded, user, justReconnected]);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={() => start("accounts_page")}
        disabled={busy}
        className={
          prominent
            ? "rounded-sm bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            : "rounded-sm border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-card disabled:opacity-60"
        }
      >
        {busy ? "Opening Google…" : "Reconnect Google"}
      </button>
      {justReconnected && !error && (
        <p className="text-[11px] text-success-foreground">✓ Google reconnected.</p>
      )}
      {error && (
        <p className="max-w-xs text-right text-[11px] text-destructive [overflow-wrap:anywhere]">{error}</p>
      )}
    </div>
  );
}
