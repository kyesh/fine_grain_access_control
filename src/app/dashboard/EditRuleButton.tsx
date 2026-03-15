"use client";

import { useState, useEffect, useTransition } from "react";
import { updateRule } from "./actions";

interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

interface EditableRule {
  id: string;
  ruleName: string;
  service: string;
  actionType: string;
  regexPattern: string;
  targetEmail: string | null;
  assignedKeyIds: string[];
}

interface ProxyKeyInfo {
  id: string;
  label: string;
}

export function EditRuleButton({
  rule,
  accessibleEmails = [],
  activeKeys = [],
}: {
  rule: EditableRule;
  accessibleEmails?: string[];
  activeKeys?: ProxyKeyInfo[];
}) {
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedActionType, setSelectedActionType] = useState(rule.actionType);
  const [gmailLabels, setGmailLabels] = useState<GmailLabel[]>([]);
  const [isLoadingLabels, setIsLoadingLabels] = useState(false);

  useEffect(() => {
    if (isOpen && gmailLabels.length === 0) {
      setIsLoadingLabels(true);
      fetch('/api/gmail/labels')
        .then(res => res.json())
        .then(data => {
          if (data && data.labels) {
            setGmailLabels(data.labels.filter((l: GmailLabel) => l.type === 'user' || l.type === 'system'));
          }
        })
        .catch(err => console.error("Failed to load labels:", err))
        .finally(() => setIsLoadingLabels(false));
    }
  }, [isOpen, gmailLabels.length]);

  async function onSubmit(formData: FormData) {
    startTransition(async () => {
      await updateRule(formData);
      setIsOpen(false);
    });
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="text-blue-600 hover:text-blue-900 text-sm font-medium transition-opacity"
      >
        Edit
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-slate-900 mb-1">
              Edit Rule
            </h3>
            <p className="text-sm text-slate-800 mb-5">
              Update the rule&apos;s settings and key assignments.
            </p>

            <form action={onSubmit} className="flex flex-col gap-5">
              <input type="hidden" name="ruleId" value={rule.id} />

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Rule Name
                </label>
                <input
                  type="text"
                  name="ruleName"
                  required
                  defaultValue={rule.ruleName}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Service
                </label>
                <select
                  name="service"
                  defaultValue={rule.service}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                >
                  <option value="gmail">Gmail</option>
                  <option value="drive">Google Drive (Coming Soon)</option>
                  <option value="calendar">Calendar (Coming Soon)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Action Type
                </label>
                <select
                  name="actionType"
                  value={selectedActionType}
                  onChange={(e) => setSelectedActionType(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                >
                  <option value="read_blacklist">
                    Read Blacklist (Inbound Regex)
                  </option>
                  <option value="send_whitelist">
                    Send Whitelist (Outbound To:)
                  </option>
                  <option value="delete_whitelist">
                    Delete Whitelist (From:)
                  </option>
                  <option value="label_blacklist">
                    Label Blacklist (Block Email via Label)
                  </option>
                  <option value="label_whitelist">
                    Label Whitelist (Allow Only via Required Label)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  {selectedActionType.startsWith('label_') ? 'Select Label' : 'Regex Pattern'}
                </label>
                {selectedActionType.startsWith('label_') ? (
                  <select
                    name="regexPattern"
                    required
                    defaultValue={rule.regexPattern}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                  >
                    <option value="">{isLoadingLabels ? "Loading labels..." : "Choose a Gmail Label..."}</option>
                    {gmailLabels.map(label => (
                       <option key={label.id} value={label.id}>{label.name} ({label.type})</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    name="regexPattern"
                    required
                    defaultValue={rule.regexPattern}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Apply to Email
                </label>
                <select
                  name="targetEmail"
                  defaultValue={rule.targetEmail || ""}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                >
                  <option value="">All accessible emails</option>
                  {accessibleEmails.map((email) => (
                    <option key={email} value={email}>
                      {email}
                    </option>
                  ))}
                </select>
              </div>

              {activeKeys.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Assign to Specific Keys
                  </label>
                  <div className="flex flex-col gap-2">
                    {activeKeys.map((k) => (
                      <label
                        key={k.id}
                        className="flex items-center gap-2 text-sm text-slate-800"
                      >
                        <input
                          type="checkbox"
                          name="keyIds"
                          value={k.id}
                          defaultChecked={rule.assignedKeyIds.includes(k.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        {k.label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Leave all unchecked for a global rule that applies to every
                    key.
                  </p>
                </div>
              )}

              <div className="mt-4 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md disabled:opacity-50 shadow-sm transition-colors"
                >
                  {isPending ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
