"use client";

import { useUser, useReverification } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { usePostHog } from "posthog-js/react";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import {
  startGoogleReconnect, DRIVE_FILE_SCOPE, GMAIL_MODIFY_SCOPE,
  type ClerkUserLike, type ReconnectPrompt,
} from "./googleReconnect";
import { describeMissingGoogleAccess, type GoogleAccessLike } from "@/lib/googleScopeCopy";

/**
 * The dashboard's "Google access is incomplete" card.
 *
 * Copy names the scope that is actually missing (googleScopeCopy.ts) — a
 * drive.file-only gap used to read as "you have not granted access to your
 * Gmail", to users whose Gmail worked fine.
 *
 * Post-sign-in auto-repair: a plain Google sign-in rewrites Clerk's grant
 * with the sign-in request's scope set, which does not include drive.file
 * (2026-09-04 finding — every production grant last written by a sign-in
 * lacked it). For a user whose Sheets/Docs rules depend on drive.file, the
 * card starts the reconnect on its own right after the sign-in that removed
 * the scope, instead of waiting for the next agent call to fail. Gated to:
 * Gmail scope present (otherwise this is a fresh/no-grant account that should
 * click deliberately), a sign-in within the last few minutes, a verified
 * external account (the destroy+recreate leg stays behind a click), not an
 * OAuth return leg, and once per sign-in (localStorage keyed on lastSignInAt —
 * /dashboard redirects to the slug route and both mount this card).
 */

const AUTO_REPAIR_WINDOW_MS = 10 * 60_000;

/**
 * `consent` is the measured-safe prompt: Google returns a refresh token only
 * on a consent pass, and a grant without one dies at the first access-token
 * expiry. Revisit after the 2026-09-04 silent-reauthorize measurement.
 */
const AUTO_REPAIR_PROMPT: ReconnectPrompt = "consent";

export function ConnectGoogleWarning({
  access,
  needsDriveFile,
  lastSignInAt,
}: {
  access: GoogleAccessLike;
  needsDriveFile: boolean;
  lastSignInAt: number | null;
}) {
  const { user, isLoaded } = useUser();
  const posthog = usePostHog();
  const [isLoading, setIsLoading] = useState(false);
  const autoFired = useRef(false);

  const copy = describeMissingGoogleAccess(access, needsDriveFile);

  const connectAction = async (prompt: ReconnectPrompt, returnTo: string) => {
    if (!user) return;
    // Shared reconnect leg — this card once carried its own gmail.modify-only
    // copy of the flow, leaving repaired grants without drive.file.
    const verificationUrl = await startGoogleReconnect(
      user as unknown as ClerkUserLike,
      returnTo,
      [GMAIL_MODIFY_SCOPE, DRIVE_FILE_SCOPE],
      prompt,
    );
    window.location.href = verificationUrl;
  };

  const enhancedConnectAction = useReverification(connectAction);

  const handleConnect = async (source: "card" | "sign_in_auto") => {
    setIsLoading(true);
    posthog?.capture("google_reconnect_started", { source, missing: copy?.missing ?? [] });
    try {
      // The Accounts page verifies ?reconnected=1 with a real tokeninfo poll
      // and closes the reconnect funnel (returned → verified|incomplete); a
      // manual click returns here, where the card simply disappears on success.
      const returnTo = source === "sign_in_auto"
        ? `${window.location.origin}/dashboard/accounts?reconnected=1`
        : window.location.href;
      await enhancedConnectAction(source === "sign_in_auto" ? AUTO_REPAIR_PROMPT : "consent", returnTo);
    } catch (error) {
      if (isReverificationCancelledError(error)) {
        console.log("User cancelled reverification modal");
      } else {
        console.error("Failed to connect Google:", error);
      }
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoaded || !user || autoFired.current) return;
    if (!needsDriveFile || access.driveFile || !access.gmail) return;
    if (!lastSignInAt || Date.now() - lastSignInAt > AUTO_REPAIR_WINDOW_MS) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("reconnected") || params.has("autoOpenPicker")) return;
    const google = user.externalAccounts.find(
      acc => acc.provider === "google" || (acc.provider as string) === "oauth_google",
    );
    if (google?.verification?.status !== "verified") return;
    const key = `fgac_auto_rewiden_${lastSignInAt}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      return;
    }
    autoFired.current = true;
    void handleConnect("sign_in_auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when the session hydrates
  }, [isLoaded, user, needsDriveFile, access.driveFile, access.gmail, lastSignInAt]);

  if (!copy) return null;

  return (
    <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-md shadow-sm mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-amber-800">{copy.title}</h3>
            <div className="mt-1 text-sm text-amber-700">
              <p>{copy.body}</p>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0">
          <button
            onClick={() => handleConnect("card")}
            disabled={isLoading}
            type="button"
            className="flex items-center gap-3 bg-white border border-[#dadce0] rounded text-[#3c4043] text-sm font-medium font-roboto px-3 py-2 hover:bg-[#f8f9fa] shadow-sm transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <span className="px-5">Connecting...</span>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  <path fill="none" d="M0 0h48v48H0z"/>
                </svg>
                <span className="font-roboto font-medium">{copy.button}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
