"use client";

import { useEffect, useState } from "react";
import { useGooglePicker, PickedSheet } from "../useGooglePicker";
import { TrackedVideoEmbed } from "@/components/TrackedVideoEmbed";

const SHEETS_DEMO_EMBED = "https://share.descript.com/embed/Fv9pwXugLUa";

type FlowState =
  | { step: "checking" }
  // Grant verified (or verification inconclusive) — straight to confirm.
  | { step: "confirm"; picked: PickedSheet[] | null; title: string | null }
  // No Google grant: the pick comes FIRST. The pick registers the grant and
  // confirms the file's identity; only then does approving mean anything.
  | { step: "need_pick"; pickFailed: boolean }
  // User picked file(s) that don't include the id the agent asked for.
  | { step: "substitute"; picked: PickedSheet[] };

/**
 * Picker-first approval flow for sheets magic links.
 *
 * Sequence: verify the Google-side grant on load. If Google can already
 * reach the sheet, approving is one click (title shown, since we can now
 * resolve it). If not, the user picks the sheet in Google's Picker BEFORE
 * any FGAC rule exists — approving blind on a raw id is how the connector
 * launch cohort ended up with rules for sheets Google couldn't serve. A
 * different-file pick becomes an explicit substitution: the grant follows
 * what the user actually picked, never the unverifiable id.
 */
export function SheetsApprovalFlow({
  token,
  spreadsheetId,
  resourceName,
  action,
  approveAction,
}: {
  token: string;
  spreadsheetId: string;
  resourceName: string | null;
  action: "sheets_expose" | "sheets_write";
  approveAction: (formData: FormData) => Promise<void>;
}) {
  const [state, setState] = useState<FlowState>({ step: "checking" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rules/verify-sheets-access?sid=${encodeURIComponent(spreadsheetId)}&context=link_open`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.state === "ok") {
          setState({ step: "confirm", picked: null, title: data.title ?? null });
        } else if (data.state === "missing") {
          setState({ step: "need_pick", pickFailed: false });
        } else {
          // Verification inconclusive (Google hiccup) — don't block the
          // approval; the server falls back to the recovery page if needed.
          setState({ step: "confirm", picked: null, title: null });
        }
      })
      .catch(() => { if (!cancelled) setState({ step: "confirm", picked: null, title: null }); });
    return () => { cancelled = true; };
  }, [spreadsheetId]);

  const handleSheetsPicked = (picked: PickedSheet[]) => {
    if (picked.length === 0) {
      setState({ step: "need_pick", pickFailed: true });
      return;
    }
    if (picked.some(s => s.id === spreadsheetId)) {
      setState({ step: "confirm", picked, title: picked.find(s => s.id === spreadsheetId)?.name ?? null });
    } else {
      setState({ step: "substitute", picked });
    }
  };

  const { triggerAddSheets, isLoading: pickerLoading, pickerError } = useGooglePicker(handleSheetsPicked);

  // A failed Google flow must be visible with a way forward — the silent
  // do-nothing button sent a real user away (2026-08-19).
  const pickerErrorBox = pickerError ? (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground [overflow-wrap:anywhere]" data-testid="picker-error">
      <span className="font-semibold">Google flow failed: </span>{pickerError}{" "}
      <a href="/dashboard/accounts" className="underline hover:opacity-80">Open the Accounts page</a>
    </div>
  ) : null;

  const sheetLabel = resourceName || spreadsheetId;
  const levelChoice = action === "sheets_expose";

  if (state.step === "checking") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="sheets-flow-checking">
        Checking whether Google already shares this sheet with FGAC…
      </p>
    );
  }

  if (state.step === "need_pick") {
    return (
      <div className="flex flex-col gap-4" data-testid="sheets-flow-pick-first">
        <div className="rounded-md border border-warning-foreground/30 bg-warning px-4 py-3 text-sm text-warning-foreground [overflow-wrap:anywhere]">
          Google hasn&apos;t shared <strong>{sheetLabel}</strong> with FGAC yet, so
          there&apos;s nothing to approve until you pick it. Google only shares a
          sheet when you choose it in Google&apos;s own file picker — that per-file
          permission is all FGAC runs on (nothing else in your Drive is shared).
        </div>
        {pickerErrorBox}
        {state.pickFailed && (
          <p className="text-sm text-muted-foreground">
            No sheet was selected. Open the picker and choose the sheet the
            agent should reach.
          </p>
        )}
        <button
          onClick={() => triggerAddSheets(spreadsheetId)}
          disabled={pickerLoading}
          className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pickerLoading ? "Opening Google Picker…" : "Step 1 — Pick the sheet in Google Picker"}
        </button>
        <p className="text-xs text-subtle">
          First time? Google will ask you to allow FGAC&apos;s file picker
          (drive.file) and then bring you straight back here.
        </p>
        <div className="rounded-lg border border-border bg-card p-2">
          <div className="px-1.5 pb-1.5 pt-0.5 text-sm font-semibold text-foreground">
            Watch how it works (2 min)
          </div>
          <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-surface-inverse">
            <TrackedVideoEmbed src={SHEETS_DEMO_EMBED} title="FGAC Google Sheets demo" />
          </div>
        </div>
      </div>
    );
  }

  const picked = state.picked;
  const substituting = state.step === "substitute";
  const grantTargets = state.step === "substitute"
    ? state.picked.map(s => s.name || s.id).join(", ")
    : (state.title || sheetLabel);

  return (
    <form action={approveAction} className="flex flex-col gap-4" data-testid="sheets-flow-confirm">
      <input type="hidden" name="token" value={token} />
      {picked && <input type="hidden" name="picked" value={JSON.stringify(picked)} />}

      {substituting && (
        <div className="rounded-md border border-warning-foreground/30 bg-warning px-4 py-3 text-sm text-warning-foreground [overflow-wrap:anywhere]" data-testid="sheets-flow-substitution">
          You picked <strong>{grantTargets}</strong>, but the agent asked for a
          different sheet ID (<code className="font-mono text-xs">{spreadsheetId}</code>)
          that Google says you don&apos;t have. Most likely the agent had the wrong
          ID. Approving grants access to <strong>what you picked</strong> — and
          nothing for the ID the agent sent; the agent will find the right
          sheet in its permissions.
        </div>
      )}
      {!substituting && (
        <div className="rounded-md border border-border bg-secondary/30 px-4 py-3 text-sm text-foreground [overflow-wrap:anywhere]">
          Granting access to <strong>{grantTargets}</strong>
          {state.title && resourceName === null ? " (verified with Google)" : ""}.
        </div>
      )}

      {levelChoice && (
        <fieldset className="flex flex-col gap-2 text-sm text-foreground">
          <label className="flex items-center gap-2">
            <input type="radio" name="permission" value="read_only" defaultChecked />
            Read only
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="permission" value="read_write" />
            Read &amp; write
          </label>
        </fieldset>
      )}

      <button
        type="submit"
        className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        {substituting ? "Grant access to what I picked" : "Approve this grant"}
      </button>
      {picked && !substituting && (
        <button
          type="button"
          onClick={() => triggerAddSheets(spreadsheetId)}
          className="text-xs text-subtle underline hover:text-foreground self-start"
        >
          Pick again
        </button>
      )}
      {substituting && (
        <button
          type="button"
          onClick={() => triggerAddSheets(spreadsheetId)}
          disabled={pickerLoading}
          className="text-xs text-subtle underline hover:text-foreground self-start disabled:opacity-50"
        >
          That&apos;s not right — pick a different sheet
        </button>
      )}
      {pickerErrorBox}
    </form>
  );
}
