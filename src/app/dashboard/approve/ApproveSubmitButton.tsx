"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that disables itself while the server action runs. A fast
 * double-click on the old plain button raced two approvals: the first
 * consumed the link, the second landed on "already used" — an error shown
 * to a user whose approval had just SUCCEEDED (rage-click evidence,
 * 2026-08-17).
 */
export function ApproveSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Approving…" : "Approve this grant"}
    </button>
  );
}
