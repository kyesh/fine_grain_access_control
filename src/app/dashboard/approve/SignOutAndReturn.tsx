'use client';

import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';

/**
 * Sign-out control for the wrong-account approval card. Signs out and lands
 * back on the SAME approve URL: the dashboard route group is Clerk-protected,
 * so the next visitor is asked to sign in first and then returns to the live
 * link — no copy/paste, no dead end.
 */
export function SignOutAndReturn({ returnTo }: { returnTo: string }) {
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);

  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await signOut({ redirectUrl: returnTo });
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="mt-4 inline-block rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out to switch accounts'}
    </button>
  );
}
