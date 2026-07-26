'use client';

import { useState } from 'react';
import { buttonSecondary, buttonPrimary } from '@/components/ui';

/**
 * Instructional only — there is deliberately no invite/request flow. Delegation
 * can only be granted by the mailbox owner from their own FGAC account, so the
 * best this button can do is tell you what to ask them to do.
 */
export function AddDelegatedAccountButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className={buttonSecondary} onClick={() => setOpen(true)}>
        + Add account
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-account-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-popover shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 pt-5 pb-3">
              <h2 id="add-account-title" className="text-base font-bold text-popover-foreground">
                Add a delegated account
              </h2>
            </div>

            <div className="px-6 pb-5 space-y-3 text-[13px] text-muted-foreground">
              <p>
                Access has to be granted by the mailbox owner — you can&apos;t request it
                from here.
              </p>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>Ask them to sign up at <span className="font-semibold text-foreground">fgac.ai</span> with the Google account you need.</li>
                <li>
                  Have them open <span className="font-semibold text-foreground">Accounts</span> and
                  use <span className="font-semibold text-foreground">Delegate access</span> to add your email.
                </li>
              </ol>
              <p>
                Once they do, the mailbox appears in this list automatically — no action
                needed on your side.
              </p>
            </div>

            <div className="flex justify-end gap-2 rounded-b-lg border-t border-border bg-muted px-6 py-3.5">
              <button className={buttonPrimary} onClick={() => setOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
