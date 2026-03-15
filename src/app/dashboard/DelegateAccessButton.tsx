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
        await createDelegation(formData);
        setShowForm(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create delegation");
      }
    });
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="inline-flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-indigo-700 transition-colors shadow-sm"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
        </svg>
        Delegate Access
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="flex items-center gap-2">
      <input
        type="email"
        name="delegateEmail"
        placeholder="user@gmail.com"
        required
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      />
      <button
        type="submit"
        disabled={isPending}
        className="bg-indigo-600 text-white text-sm font-medium px-3 py-1.5 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Granting..." : "Grant"}
      </button>
      <button
        type="button"
        onClick={() => { setShowForm(false); setError(null); }}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        Cancel
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
