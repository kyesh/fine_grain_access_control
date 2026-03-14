"use client";

import { useTransition } from "react";
import { syncConnectedEmails } from "./actions";

export function SyncEmailsButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => syncConnectedEmails())}
      disabled={isPending}
      className="bg-white border border-gray-300 text-sm font-medium px-3 py-1.5 rounded-md hover:bg-gray-50 text-gray-700 disabled:opacity-50 transition-colors"
    >
      {isPending ? "Syncing..." : "Sync from Clerk"}
    </button>
  );
}
