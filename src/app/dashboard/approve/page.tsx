import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { verifyApprovalToken, describeApproval, approvalLinkMinutes, peekApprovalToken } from "@/lib/approvalLinks";
import { captureServerEvent } from "@/lib/posthogServer";
import { approveMagicLink, approvalLinkStatus } from "../actions";
import { ApproveSubmitButton } from "./ApproveSubmitButton";
import { SheetsApprovalFlow } from "./SheetsApprovalFlow";
import { ApprovedSettling } from "./ApprovedSettling";

/* ─── Magic-link approval page (connector-growth Phase C) ────────────────
   Reached from a signed, single-use link embedded in an agent's denial (or
   minted by the request_access tool). Shows exactly one grant and applies it
   only on explicit confirmation by the owning, signed-in user. The dashboard
   route group is Clerk-protected, so a signed-out visitor signs in first.

   Sheets grants run picker-first (SheetsApprovalFlow): the page verifies the
   Google-side drive.file grant on load, and when it's missing the user picks
   the sheet in Google's Picker BEFORE anything is approved — the pick is
   what registers Google access and confirms the file's identity. Approving a
   raw, unverifiable id is how users ended up with rules for sheets Google
   couldn't serve. */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-lg px-6 pb-16">
      <div className="rounded-lg border border-border bg-card p-8">{children}</div>
      <p className="mt-4 text-center text-xs text-subtle">
        <Link href="/dashboard" className="underline hover:text-foreground">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}

export default async function ApprovePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; result?: string; message?: string; sid?: string; notice?: string }>;
}) {
  const params = await searchParams;

  if (params.result === "ok") {
    // Sheets approvals settle asynchronously on Google's side — verify the
    // grant is live before claiming the agent can retry (grant-race fix).
    if (params.sid) {
      return (
        <Card>
          <ApprovedSettling
            spreadsheetId={params.sid}
            message={params.message || "The permission has been granted."}
          />
        </Card>
      );
    }
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-success-foreground">✓ Approved</h1>
        <p className="text-sm text-muted-foreground">
          {params.message || "The permission has been granted."} The agent can
          retry its request now. You can review or remove this grant any time
          from your dashboard rules.
        </p>
      </Card>
    );
  }
  if (params.result === "error") {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-foreground">Approval failed</h1>
        <p className="text-sm text-muted-foreground">{params.message || "The link could not be processed."}</p>
        {params.token && (
          <Link
            href={`/dashboard/approve?token=${encodeURIComponent(params.token)}`}
            className="mt-4 inline-block rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Try again with this link
          </Link>
        )}
      </Card>
    );
  }

  const token = params.token;
  if (!token) {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-foreground">Missing link</h1>
        <p className="text-sm text-muted-foreground">This page needs an approval link to do anything.</p>
      </Card>
    );
  }

  const verified = await verifyApprovalToken(token);
  // Truth-at-load: a used link renders its real state up front instead of
  // letting the user click Approve into an "already used" surprise.
  const linkState = verified.ok ? await approvalLinkStatus(token) : "invalid";

  // Link-funnel instrumentation: joins minted → opened → approved by link_id
  // (the token jti). The 2026-08 launch cohort's biggest approval leak was
  // links never opened at all — this event is what makes that measurable.
  const { userId: clerkUserId } = await auth();
  const peek = verified.ok
    ? { jti: verified.payload.jti, action: verified.payload.action }
    : peekApprovalToken(token);
  captureServerEvent(clerkUserId ?? "anonymous-approve", "approval_link_opened", {
    status: verified.ok ? linkState : verified.reason,
    link_id: peek.jti,
    action: peek.action,
  });

  if (!verified.ok) {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-foreground">
          {verified.reason === "expired" ? "Link expired" : "Invalid link"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {verified.reason === "expired"
            ? "This approval link has expired (links last 15–30 minutes). Ask the agent to request access again."
            : "This link is not valid. If an agent gave it to you, ask it to request access again."}
        </p>
      </Card>
    );
  }

  const p = verified.payload;
  const linkMinutes = approvalLinkMinutes(p.action);

  if (linkState === "already_granted") {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-success-foreground">✓ Already approved</h1>
        <p className="text-sm text-muted-foreground">
          {describeApproval(p)} — this permission is already active, so there is
          nothing more to do here. The agent can retry its request now. You can
          review or remove the grant any time from your dashboard rules.
        </p>
      </Card>
    );
  }
  if (linkState === "used_inactive") {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-foreground">Link already used</h1>
        <p className="text-sm text-muted-foreground">
          This link was used, and the permission it described is not active
          anymore — it may have been revoked, or granted under a different
          sheet picked in Google. Nothing was changed just now. If the agent
          still needs access, ask it to request access again for a fresh link.
        </p>
      </Card>
    );
  }

  async function approve(formData: FormData) {
    "use server";
    const rw = formData.get("permission") === "read_write";
    let picked: { id: string; name?: string }[] | undefined;
    const rawPicked = formData.get("picked");
    if (typeof rawPicked === "string" && rawPicked) {
      try {
        const parsed: unknown = JSON.parse(rawPicked);
        if (Array.isArray(parsed)) picked = parsed as { id: string; name?: string }[];
      } catch { /* malformed picked payload → treated as no pick info */ }
    }
    const result = await approveMagicLink(formData.get("token") as string, rw, picked);
    if (result.ok) {
      if (result.needsSheetsGrant) {
        // Fallback only (verification was inconclusive at page load): the
        // rule exists but Google can't reach the sheet — finish in recovery.
        const q = new URLSearchParams({ sid: result.needsSheetsGrant.spreadsheetId, from: "approval" });
        if (result.needsSheetsGrant.resourceName) q.set("name", result.needsSheetsGrant.resourceName);
        redirect(`/dashboard/sheets-setup?${q.toString()}`);
      }
      const settle = result.grantedSpreadsheetId
        ? `&sid=${encodeURIComponent(result.grantedSpreadsheetId)}`
        : "";
      redirect(`/dashboard/approve?result=ok&message=${encodeURIComponent(result.description)}${settle}`);
    }
    if (result.retryable) {
      // The link was not consumed — return to the LIVE approve page (token
      // intact) with an inline notice, never to the token-less error card.
      redirect(`/dashboard/approve?token=${encodeURIComponent(formData.get("token") as string)}&notice=${encodeURIComponent(result.reason)}`);
    }
    // Even terminal-looking failures carry the token so the error card can
    // offer "Try again" — re-opening re-verifies and renders the true state
    // (fresh / already approved / used / expired), so it is always safe.
    redirect(`/dashboard/approve?result=error&message=${encodeURIComponent(result.reason)}&token=${encodeURIComponent(formData.get("token") as string)}`);
  }

  const isSheets = (p.action === "sheets_expose" || p.action === "sheets_write") && p.spreadsheetId;

  return (
    <Card>
      <h1 className="mb-1 text-xl font-bold text-foreground">Approve agent permission?</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        An AI agent connected to your account is asking for exactly this grant:
      </p>
      <div className="mb-5 rounded-md border border-warning-foreground/30 bg-warning px-4 py-3 text-sm font-medium text-warning-foreground [overflow-wrap:anywhere]">
        {describeApproval(p)}
      </div>
      {params.notice && (
        <div className="mb-5 rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="approve-notice">
          {params.notice}
        </div>
      )}
      {isSheets ? (
        <SheetsApprovalFlow
          token={token}
          spreadsheetId={p.spreadsheetId!}
          resourceName={p.resourceName || null}
          action={p.action as "sheets_expose" | "sheets_write"}
          approveAction={approve}
        />
      ) : (
        <form action={approve} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <ApproveSubmitButton />
        </form>
      )}
      <p className="mt-4 text-xs text-subtle">
        Single-use link · expires {linkMinutes} minutes after it was created · grants
        only what is shown above, scoped to the requesting agent&apos;s profile.
      </p>
    </Card>
  );
}
