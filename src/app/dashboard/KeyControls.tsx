"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Copy, Check } from "lucide-react";
import { createProxyKey, revokeProxyKey, rollProxyKey } from "./actions";

interface AccessibleEmail {
  email: string;
  type: 'own' | 'delegated';
  delegationId?: string;
}

interface ProxyKey {
  id: string;
  key: string;
  label: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  emailAccess: string[]; // email addresses this key can access
}

function SecretKeyDisplay({
  apiKey,
  className = "text-sm text-slate-700",
  iconSize = 14,
}: {
  apiKey: string;
  className?: string;
  iconSize?: number;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const maskedKey = "sk_proxy_" + "•".repeat(24);

  return (
    <div className={`inline-flex items-center gap-2 font-mono bg-slate-50 px-2 py-1 rounded mt-1.5 ${className}`}>
      <span>{isVisible ? apiKey : maskedKey}</span>
      <button
        onClick={() => setIsVisible(!isVisible)}
        className="text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
        title={isVisible ? "Hide Key" : "Reveal Key"}
      >
        {isVisible ? <EyeOff size={iconSize} /> : <Eye size={iconSize} />}
      </button>
      <button
        onClick={handleCopy}
        className="text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
        title="Copy to clipboard"
      >
        {copied ? <Check size={iconSize} className="text-green-500" /> : <Copy size={iconSize} />}
      </button>
    </div>
  );
}

export function KeyControls({
  accessibleEmails,
  existingKeys,
}: {
  accessibleEmails: AccessibleEmail[];
  existingKeys: ProxyKey[];
}) {
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);

  async function onSubmit(formData: FormData) {
    startTransition(async () => {
      await createProxyKey(formData);
      setIsModalOpen(false);
    });
  }

  const activeKeys = existingKeys.filter(k => !k.revokedAt);
  const revokedKeys = existingKeys.filter(k => k.revokedAt);

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900">API Keys</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 text-white hover:bg-blue-500 px-4 py-2 text-sm font-medium rounded-md transition-all shadow-sm"
        >
          Create New Key
        </button>
      </div>

      {activeKeys.length === 0 && (
        <p className="text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded-md p-4">
          No active API keys. Create one to give your agents access.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {activeKeys.map((k) => (
          <div
            key={k.id}
            className="bg-white border border-gray-200 rounded-lg shadow-sm p-4"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-gray-900">{k.label}</p>
                <SecretKeyDisplay apiKey={k.key} />
                <div className="mt-2 flex flex-wrap gap-1">
                  {k.emailAccess.length > 0 ? (
                    k.emailAccess.map((email) => {
                      const emailInfo = accessibleEmails.find(
                        (ae) => ae.email.toLowerCase() === email.toLowerCase()
                      );
                      return (
                        <span
                          key={email}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            emailInfo?.type === 'delegated'
                              ? 'bg-indigo-50 text-indigo-700 ring-indigo-600/20'
                              : 'bg-green-50 text-green-700 ring-green-600/20'
                          }`}
                        >
                          {email}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-xs text-red-600">No email access granted</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    startTransition(() => rollProxyKey(k.id))
                  }
                  disabled={isPending}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                >
                  Roll
                </button>
                <button
                  onClick={() =>
                    startTransition(() => revokeProxyKey(k.id))
                  }
                  disabled={isPending}
                  className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {revokedKeys.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm text-gray-800 cursor-pointer hover:text-gray-900">
            Show {revokedKeys.length} revoked key{revokedKeys.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {revokedKeys.map((k) => (
              <div
                key={k.id}
                className="bg-gray-50 border border-gray-200 rounded-lg p-3 opacity-60"
              >
                <p className="font-medium text-gray-700 line-through">{k.label}</p>
                <SecretKeyDisplay apiKey={k.key} className="text-xs text-gray-500 bg-transparent !px-0 !py-0" iconSize={12} />
                <p className="text-xs text-red-600 mt-1">
                  Revoked {k.revokedAt ? new Date(k.revokedAt).toLocaleDateString() : ""}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Create Key Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-xl font-bold text-slate-900 mb-1">
              Create API Key
            </h3>
            <p className="text-sm text-slate-800 mb-5">
              Label this key and select which email accounts it can access.
            </p>

            <form action={onSubmit} className="flex flex-col gap-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Key Label
                </label>
                <input
                  type="text"
                  name="label"
                  required
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                  placeholder="e.g. Claude Personal Assistant"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Email Access
                </label>
                {accessibleEmails.length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded">
                    No accessible emails. Connect your Google account first.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {accessibleEmails.map((ae) => (
                      <label
                        key={ae.email}
                        className="flex items-center gap-2 text-sm text-slate-800"
                      >
                        <input
                          type="checkbox"
                          name="emails"
                          value={ae.email}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        {ae.email}
                        {ae.type === 'delegated' && (
                          <span className="text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                            Delegated
                          </span>
                        )}
                        {ae.type === 'own' && (
                          <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                            You
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-2 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || accessibleEmails.length === 0}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md disabled:opacity-50 shadow-sm transition-colors"
                >
                  {isPending ? "Creating..." : "Create Key"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
