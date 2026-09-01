"use client";

import { useState, useTransition } from "react";
import { createDelegation } from "./actions";

export function DelegateAccessButton() {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        // Refusals come back as values, not throws — production replaces a
        // thrown server-action message with an opaque digest, which is what
        // this form showed users until 2026-09-01.
        const result = await createDelegation(formData);
        if (result.ok) {
          setShowForm(false);
        } else {
          setError(result.error);
        }
      } catch {
        setError("Something went wrong creating the delegation. Please try again.");
      }
    });
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
        </svg>
        Delegate Access
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={handleSubmit} className="flex items-center gap-2">
        <input
          type="email"
          name="delegateEmail"
          placeholder="user@gmail.com"
          required
          autoFocus
          className="rounded-sm border border-input bg-card px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center rounded-sm bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Granting…" : "Grant"}
        </button>
        <button
          type="button"
          onClick={() => { setShowForm(false); setError(null); }}
          className="text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </form>
      {error && (
        <p role="alert" className="max-w-xs text-right text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
