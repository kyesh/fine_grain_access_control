"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useGooglePicker, PickedFile } from "./useGooglePicker";
import { TrackedVideoEmbed } from "@/components/TrackedVideoEmbed";
import { DRIVE_FILE_KINDS, type DriveFileKind } from "@/lib/driveFileKinds";

const SHEETS_DEMO_EMBED = "https://share.descript.com/embed/Fv9pwXugLUa";

type GrantStatus = "checking" | "needs_grant" | "verified" | "picked_other";

/**
 * Recovery UI for the "FGAC approved, Google grant missing" state — shared
 * by /dashboard/sheets-setup and /dashboard/docs-setup.
 *
 * Approving a file in FGAC only creates our rule; Google shares the file
 * with FGAC exclusively through a Google Picker pick (per-file drive.file
 * grant). Production showed users approving and then retrying into 404s
 * with no way out — this page IS the way out: one button that opens the
 * Picker, the demo video for anyone unsure (sheets has one today), and a
 * live verification check so we never again say "done" without Google
 * agreeing.
 */
export function FileGrantRecovery({
  kind,
  fileId,
  resourceName,
  fromApproval,
}: {
  kind: DriveFileKind;
  fileId: string | null;
  resourceName: string | null;
  fromApproval: boolean;
}) {
  const [status, setStatus] = useState<GrantStatus>(fileId ? "checking" : "needs_grant");
  const [busy, setBusy] = useState(false);
  const d = DRIVE_FILE_KINDS[kind];
  const short = kind === "sheet" ? "sheet" : d.noun;
  const verifyPath = kind === "sheet" ? "/api/rules/verify-sheets-access" : "/api/rules/verify-docs-access";
  const grantPath = kind === "sheet" ? "/api/rules/grant-sheets-access" : "/api/rules/grant-docs-access";
  const rulesKey = kind === "sheet" ? "sheetsRules" : "docsRules";

  const verify = useCallback(async (recovery: boolean): Promise<boolean> => {
    if (!fileId) return false;
    try {
      const res = await fetch(
        `${verifyPath}?${d.setupIdParam}=${encodeURIComponent(fileId)}${recovery ? "&context=recovery" : ""}`,
      );
      const data = await res.json();
      return data.state === "ok";
    } catch {
      return false;
    }
  }, [fileId, verifyPath, d.setupIdParam]);

  useEffect(() => {
    let cancelled = false;
    if (!fileId) return;
    verify(false).then(ok => {
      if (!cancelled) setStatus(ok ? "verified" : "needs_grant");
    });
    return () => { cancelled = true; };
  }, [fileId, verify]);

  const handleFilesPicked = async (picked: PickedFile[]) => {
    setBusy(true);
    try {
      // Upsert rules only for picked files that have none yet — re-POSTing
      // an existing rule would silently reset its Read/Write choice.
      const existing = await fetch(grantPath)
        .then(r => r.json())
        .then(dta => new Set((dta[rulesKey] ?? []).map((r: { targetResourceId: string }) => r.targetResourceId)))
        .catch(() => new Set());
      for (const file of picked) {
        if (existing.has(file.id)) continue;
        await fetch(grantPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetResourceId: file.id,
            resourceName: file.name,
            actionType: d.actionTypes.read,
          }),
        });
      }

      if (!fileId) {
        // No specific file to verify — a pick is all setup requires.
        setStatus(picked.length > 0 ? "verified" : "needs_grant");
        return;
      }
      const ok = await verify(true);
      if (ok) {
        setStatus("verified");
      } else {
        // The pick registered grants, just not for the file the agent asked
        // for — most likely the agent had the wrong id. Say so.
        setStatus(picked.length > 0 ? "picked_other" : "needs_grant");
      }
    } finally {
      setBusy(false);
    }
  };

  const { triggerAddSheets, isLoading: pickerLoading } = useGooglePicker(handleFilesPicked, kind);

  const fileLabel = resourceName || fileId || `your ${d.noun}`;
  const shortCap = short.charAt(0).toUpperCase() + short.slice(1);

  return (
    <div className="mx-auto mt-12 max-w-2xl px-6 pb-16">
      <div className="rounded-lg border border-border bg-card p-8">
        {status === "verified" ? (
          <>
            <h1 className="mb-2 text-xl font-bold text-success-foreground">✓ {shortCap} access verified</h1>
            <p className="text-sm text-muted-foreground">
              Google now shares {resourceName ? <strong>{fileLabel}</strong> : `the selected ${short}`} with
              FGAC and your access rule is active. The agent can retry its request now.
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-xl font-bold text-foreground">
              {fromApproval ? "Approved — one more step" : `Finish setting up ${short} access`}
            </h1>
            <p className="mb-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {fromApproval
                ? <>Your FGAC rule for <strong>{fileLabel}</strong> is saved, but Google hasn&apos;t shared the {short} itself with FGAC yet.</>
                : <>FGAC has a rule for <strong>{fileLabel}</strong>, but Google hasn&apos;t shared the {short} itself with FGAC yet.</>}
            </p>
            <p className="mb-5 text-sm text-muted-foreground">
              Google only shares a {short} when you pick it in Google&apos;s own file
              picker — that&apos;s the per-file permission FGAC runs on (nothing else
              in your Drive is shared). Pick the {short} below and you&apos;re done.
            </p>

            {status === "picked_other" && (
              <div className="mb-5 rounded-md border border-warning-foreground/30 bg-warning px-4 py-3 text-sm text-warning-foreground [overflow-wrap:anywhere]">
                The {short}(s) you picked are now shared with FGAC — but none of them
                matched the exact {d.noun} the agent asked for
                {fileId ? <> (ID <code className="font-mono text-xs">{fileId}</code>)</> : null}.
                If the agent guessed a wrong ID, that&apos;s fine: ask it to retry using
                the {short} you just picked. Otherwise, pick the exact {short} again.
              </div>
            )}

            <button
              onClick={() => triggerAddSheets(fileId ?? undefined)}
              disabled={pickerLoading || busy || status === "checking"}
              className="w-full rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {status === "checking"
                ? "Checking current access…"
                : busy
                  ? "Saving…"
                  : pickerLoading
                    ? "Opening Google Picker…"
                    : `Pick the ${short} in Google Picker`}
            </button>
            <p className="mt-2 text-xs text-subtle">
              First time? Google will ask you to allow FGAC&apos;s file picker
              (drive.file) and then bring you straight back here.
            </p>
          </>
        )}
      </div>

      {status !== "verified" && kind === "sheet" && (
        <div className="mt-6 rounded-lg border border-border bg-card p-2.5">
          <div className="px-1.5 pb-2 pt-1 text-sm font-semibold text-foreground">
            Watch how it works (2 min)
          </div>
          <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-surface-inverse">
            <TrackedVideoEmbed src={SHEETS_DEMO_EMBED} title="FGAC Google Sheets demo" />
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-xs text-subtle">
        <Link href="/dashboard" className="underline hover:text-foreground">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
