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
      className="text-sm text-red-600 hover:text-red-800 font-medium disabled:opacity-50 transition-colors"
    >
      {isPending ? "Revoking..." : "Revoke"}
    </button>
  );
}
