import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { describeApproval, peekApprovalParams, APPROVAL_PARAMS, type ApprovalSearchParams } from "@/lib/approvalLinks";
import { markApprovalRequestOpened } from "@/lib/approvalRequests";
import { captureServerEvent } from "@/lib/posthogServer";
import { approveMagicLink, resolveApprovalLink } from "../actions";
import { ApproveSubmitButton } from "./ApproveSubmitButton";
import { FileApprovalFlow } from "./FileApprovalFlow";
import { ApprovedSettling } from "./ApprovedSettling";

/* ─── Magic-link approval page (connector-growth Phase C) ────────────────
   Reached from a signed deep link embedded in an agent's denial (or minted
   by the request_access tool). Shows exactly one grant and applies it only
   on explicit confirmation by the owning, signed-in user. The dashboard
   route group is Clerk-protected, so a signed-out visitor signs in first.

   Links are DETERMINISTIC and PERMANENT (2026-08-25): the same request
   always produces the same URL, so a retrying agent re-emits one link
   instead of minting a new one per attempt. There is no expiry and no
   single-use — both only ever produced dead ends, and neither protected
   anything the Clerk session + live proxy-key ownership check does not.
   Replay safety is grant-level: an already-active grant writes nothing.

   Sheets/docs grants run picker-first (FileApprovalFlow): the page verifies
   the Google-side drive.file grant on load, and when it's missing the user
   picks the file in Google's Picker BEFORE anything is approved — the pick
   is what registers Google access and confirms the file's identity. */

/** Coarse client classification for the open event.
 *
 * `approval_link_opened` is captured server-side, so it carries no browser
 * user agent and every open looked identical in analytics. Measured against
 * client-side pageviews, ~23% of approve-page loads were an AI agent rather
 * than a person — which meant "opened" systematically overstated human
 * reach. Stamping the request's own UA here makes that split visible without
 * a second client-side event. */
const AGENT_UA = /claude|anthropic|electron|node-fetch|python-requests|axios|curl|wget|bot\b|crawler|spider|headless/i;

async function clientClassification(): Promise<{ agent_driven: boolean; user_agent: string }> {
  try {
    const ua = (await headers()).get("user-agent") ?? "";
    return { agent_driven: AGENT_UA.test(ua), user_agent: ua.slice(0, 160) };
  } catch {
    return { agent_driven: false, user_agent: "" };
  }
}

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

/** Rebuild the link's own query string, so every redirect can return to the
 *  LIVE approve URL rather than a parameter-less dead end. */
function linkQuery(params: ApprovalSearchParams): string {
  const q = new URLSearchParams();
  if (params.a) q.set(APPROVAL_PARAMS.action, params.a);
  if (params.k) q.set(APPROVAL_PARAMS.key, params.k);
  if (params.r) q.set(APPROVAL_PARAMS.target, params.r);
  if (params.s) q.set(APPROVAL_PARAMS.signature, params.s);
  return q.toString();
}

export default async function ApprovePage({
  searchParams,
}: {
  searchParams: Promise<{
    a?: string; k?: string; r?: string; s?: string;
    result?: string; message?: string; sid?: string; did?: string; notice?: string;
  }>;
}) {
  const params = await searchParams;
  const link: ApprovalSearchParams = { a: params.a, k: params.k, r: params.r, s: params.s };

  if (params.result === "ok") {
    // Per-file (sheets/docs) approvals settle asynchronously on Google's
    // side — verify the grant is live before claiming the agent can retry
    // (grant-race fix).
    if (params.sid || params.did) {
      return (
        <Card>
          <ApprovedSettling
            kind={params.sid ? "sheet" : "doc"}
            fileId={(params.sid || params.did)!}
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
    const q = linkQuery(link);
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-foreground">Approval failed</h1>
        <p className="text-sm text-muted-foreground">{params.message || "The link could not be processed."}</p>
        {q && (
          <Link
            href={`/dashboard/approve?${q}`}
            className="mt-4 inline-block rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Try again with this link
          </Link>
        )}
      </Card>
    );
  }

  if (!link.a || !link.s) {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-foreground">Missing link</h1>
        <p className="text-sm text-muted-foreground">This page needs an approval link to do anything.</p>
      </Card>
    );
  }

  const resolved = await resolveApprovalLink(link);

  // Link-funnel instrumentation. request_id is DETERMINISTIC, so repeated
  // opens of the same request join to one row — retries no longer look like
  // fresh unopened demand, which is what made this funnel read as 31% when
  // it converts near 58%.
  const { userId: clerkUserId } = await auth();
  const client = await clientClassification();
  captureServerEvent(clerkUserId ?? "anonymous-approve", "approval_link_opened", {
    status: resolved.status,
    request_id: resolved.status === "invalid" ? undefined : resolved.payload.requestId,
    action: resolved.status === "invalid" ? peekApprovalParams(link).action : resolved.payload.action,
    ...client,
  });
  if (resolved.status !== "invalid") {
    await markApprovalRequestOpened(resolved.payload.requestId);
  }

  if (resolved.status === "invalid") {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-foreground">Invalid link</h1>
        <p className="text-sm text-muted-foreground">
          This link is not valid for your account. If an agent gave it to you,
          check that you are signed in as the account the agent is connected
          to — approval links only work for their own owner. Otherwise ask the
          agent to request access again.
        </p>
      </Card>
    );
  }

  const p = resolved.payload;

  if (resolved.status === "already_granted") {
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

  async function approve(formData: FormData) {
    "use server";
    const rw = formData.get("permission") === "read_write";
    const submitted: ApprovalSearchParams = {
      a: (formData.get("a") as string) || undefined,
      k: (formData.get("k") as string) || undefined,
      r: (formData.get("r") as string) || undefined,
      s: (formData.get("s") as string) || undefined,
    };
    let picked: { id: string; name?: string }[] | undefined;
    const rawPicked = formData.get("picked");
    if (typeof rawPicked === "string" && rawPicked) {
      try {
        const parsed: unknown = JSON.parse(rawPicked);
        if (Array.isArray(parsed)) picked = parsed as { id: string; name?: string }[];
      } catch { /* malformed picked payload → treated as no pick info */ }
    }
    const q = linkQuery(submitted);
    const result = await approveMagicLink(submitted, rw, picked);
    if (result.ok) {
      if (result.needsSheetsGrant) {
        // Fallback only (verification was inconclusive at page load): the
        // rule exists but Google can't reach the sheet — finish in recovery.
        const s = new URLSearchParams({ sid: result.needsSheetsGrant.spreadsheetId, from: "approval" });
        if (result.needsSheetsGrant.resourceName) s.set("name", result.needsSheetsGrant.resourceName);
        redirect(`/dashboard/sheets-setup?${s.toString()}`);
      }
      if (result.needsDocsGrant) {
        const s = new URLSearchParams({ did: result.needsDocsGrant.documentId, from: "approval" });
        if (result.needsDocsGrant.resourceName) s.set("name", result.needsDocsGrant.resourceName);
        redirect(`/dashboard/docs-setup?${s.toString()}`);
      }
      const settle = result.grantedSpreadsheetId
        ? `&sid=${encodeURIComponent(result.grantedSpreadsheetId)}`
        : result.grantedDocumentId
          ? `&did=${encodeURIComponent(result.grantedDocumentId)}`
          : "";
      redirect(`/dashboard/approve?result=ok&message=${encodeURIComponent(result.description)}${settle}`);
    }
    if (result.retryable) {
      // Nothing was written — return to the LIVE approve page (link intact)
      // with an inline notice, never to a parameter-less error card.
      redirect(`/dashboard/approve?${q}&notice=${encodeURIComponent(result.reason)}`);
    }
    // Even terminal-looking failures carry the link so the error card can
    // offer "Try again" — re-opening re-verifies and renders the true state.
    redirect(`/dashboard/approve?result=error&message=${encodeURIComponent(result.reason)}&${q}`);
  }

  const isSheets = (p.action === "sheets_expose" || p.action === "sheets_write") && p.spreadsheetId;
  const isDocs = (p.action === "docs_expose" || p.action === "docs_write") && p.documentId;

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
      {isSheets || isDocs ? (
        <FileApprovalFlow
          link={link}
          kind={isSheets ? "sheet" : "doc"}
          fileId={(isSheets ? p.spreadsheetId : p.documentId)!}
          resourceName={p.resourceName || null}
          level={p.action.endsWith("_write") ? "write" : "expose"}
          approveAction={approve}
        />
      ) : (
        <form action={approve} className="flex flex-col gap-4">
          <input type="hidden" name="a" value={link.a} />
          <input type="hidden" name="k" value={link.k ?? ""} />
          <input type="hidden" name="r" value={link.r ?? ""} />
          <input type="hidden" name="s" value={link.s} />
          <ApproveSubmitButton />
        </form>
      )}
      <p className="mt-4 text-xs text-subtle">
        This link grants only what is shown above, scoped to the requesting
        agent&apos;s profile. It stays valid until you approve — you can review
        or remove the grant any time from your dashboard rules.
      </p>
    </Card>
  );
}
