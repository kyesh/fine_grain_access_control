'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Copy-to-clipboard affordance for the setup guide's URL pill and command
 * block. The setup page is otherwise a server component — this is the only
 * interactive bit, so it stays small and self-contained.
 */
export function CopyButton({
  value,
  label,
  className = '',
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      title="Copy to clipboard"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard permission denied — the text is on screen to select.
        }
      }}
      className={`shrink-0 cursor-pointer ${className}`}
    >
      {copied ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <Copy className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
