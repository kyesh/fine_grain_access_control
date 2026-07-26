"use client";

import { useTransition } from "react";
import { revokeDelegation } from "./actions";

export function RevokeDelegationButton({ delegationId }: { delegationId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => {
        if (confirm("Revoke this delegation? The delegate will immediately lose access to your email.")) {
          startTransition(() => revokeDelegation(delegationId));
        }
      }}
      disabled={isPending}
      className="text-[11px] font-semibold text-destructive hover:opacity-80 disabled:opacity-50 transition-opacity"
    >
      {isPending ? "Revoking..." : "Revoke"}
    </button>
  );
}
