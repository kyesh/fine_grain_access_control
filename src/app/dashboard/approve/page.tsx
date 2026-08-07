import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyApprovalToken, describeApproval } from "@/lib/approvalLinks";
import { approveMagicLink } from "../actions";

/* ─── Magic-link approval page (connector-growth Phase C) ────────────────
   Reached from a signed, single-use link embedded in an agent's denial (or
   minted by the request_access tool). Shows exactly one grant and applies it
   only on explicit confirmation by the owning, signed-in user. The dashboard
   route group is Clerk-protected, so a signed-out visitor signs in first. */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-lg px-6">
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
  searchParams: Promise<{ token?: string; result?: string; message?: string }>;
}) {
  const params = await searchParams;

  if (params.result === "ok") {
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
  if (!verified.ok) {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold text-foreground">
          {verified.reason === "expired" ? "Link expired" : "Invalid link"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {verified.reason === "expired"
            ? "Approval links last 15 minutes. Ask the agent to request access again."
            : "This link is not valid. If an agent gave it to you, ask it to request access again."}
        </p>
      </Card>
    );
  }

  const p = verified.payload;

  async function approve(formData: FormData) {
    "use server";
    const rw = formData.get("permission") === "read_write";
    const result = await approveMagicLink(formData.get("token") as string, rw);
    if (result.ok) {
      redirect(`/dashboard/approve?result=ok&message=${encodeURIComponent(result.description)}`);
    }
    redirect(`/dashboard/approve?result=error&message=${encodeURIComponent(result.reason)}`);
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-bold text-foreground">Approve agent permission?</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        An AI agent connected to your account is asking for exactly this grant:
      </p>
      <div className="mb-5 rounded-md border border-warning-foreground/30 bg-warning px-4 py-3 text-sm font-medium text-warning-foreground">
        {describeApproval(p)}
      </div>
      <form action={approve} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        {p.action === "sheets_expose" && (
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
          Approve this grant
        </button>
        <p className="text-xs text-subtle">
          Single-use link · expires 15 minutes after it was created · grants
          only what is shown above, scoped to the requesting agent&apos;s profile.
        </p>
      </form>
    </Card>
  );
}
