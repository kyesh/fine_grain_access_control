"use client";

import { useState, useEffect, useCallback } from 'react';
import { useGooglePicker, PickedSheet } from './useGooglePicker';

interface SheetsRule {
  id: string;
  ruleName: string;
  targetResourceId: string;
  resourceName: string | null;
  actionType: string;
  assignedKeyIds: string[];
}

interface ProxyKeyInfo {
  id: string;
  label: string;
}

export function ExposedSheetsManager({ activeKeys = [] }: { activeKeys?: ProxyKeyInfo[] }) {
  const [sheetsRules, setSheetsRules] = useState<SheetsRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fetchSheetsRules = useCallback(async () => {
    try {
      const res = await fetch('/api/rules/grant-sheets-access');
      const data = await res.json();
      if (data.sheetsRules) {
        setSheetsRules(data.sheetsRules);
      }
    } catch (err) {
      console.error('Failed to load sheets rules:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSheetsRules();
  }, [fetchSheetsRules]);

  const handleSheetsPicked = async (pickedSheets: PickedSheet[]) => {
    setStatusMessage('Saving exposed sheets to FGAC...');
    for (const sheet of pickedSheets) {
      await fetch('/api/rules/grant-sheets-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetResourceId: sheet.id,
          resourceName: sheet.name,
          actionType: 'sheet_read', // Default to Read Only
        })
      });
    }
    await fetchSheetsRules();
    setStatusMessage(`Successfully added ${pickedSheets.length} sheet(s)!`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const { triggerAddSheets, isLoading: isPickerLoading } = useGooglePicker(handleSheetsPicked);

  const handlePermissionChange = async (targetResourceId: string, resourceName: string | null, newActionType: string) => {
    try {
      await fetch('/api/rules/grant-sheets-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetResourceId,
          resourceName: resourceName || `Spreadsheet (${targetResourceId.slice(0, 6)})`,
          actionType: newActionType
        })
      });
      await fetchSheetsRules();
    } catch (err) {
      console.error('Failed to update permission:', err);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await fetch(`/api/rules/grant-sheets-access?ruleId=${ruleId}`, {
        method: 'DELETE'
      });
      await fetchSheetsRules();
    } catch (err) {
      console.error('Failed to remove sheet rule:', err);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
            </svg>
            <h3 className="text-lg font-bold text-slate-900">Google Sheets Access Rules</h3>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Grant agents intentional access to specific Google Sheets via per-file (<code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 text-xs">drive.file</code>) permission.
          </p>
        </div>
        <button
          onClick={() => triggerAddSheets()}
          disabled={isPickerLoading}
          className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm px-4 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50 flex-shrink-0"
        >
          {isPickerLoading ? (
            <span>Connecting...</span>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              <span>Add Google Sheet +</span>
            </>
          )}
        </button>
      </div>

      {statusMessage && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          {statusMessage}
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-slate-400 text-sm">Loading sheets access rules...</div>
      ) : sheetsRules.length === 0 ? (
        <div className="py-8 border-2 border-dashed border-slate-200 rounded-lg text-center p-6 bg-slate-50/50">
          <svg className="w-10 h-10 text-slate-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium text-slate-700">No Google Sheets exposed yet</p>
          <p className="text-xs text-slate-500 mt-1 mb-3">
            Click &quot;Add Google Sheet +&quot; to pick spreadsheets using Google Picker and define Read or Read/Write permissions.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold text-xs uppercase tracking-wider bg-slate-50">
                <th className="py-3 px-4">Document Title</th>
                <th className="py-3 px-4">Spreadsheet ID</th>
                <th className="py-3 px-4">FGAC Permission</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sheetsRules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-medium text-slate-900 flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
                    </svg>
                    <span>{rule.resourceName || rule.ruleName}</span>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">
                    {rule.targetResourceId ? (
                      <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200" title={rule.targetResourceId}>
                        {rule.targetResourceId.length > 16 ? `${rule.targetResourceId.slice(0, 12)}...` : rule.targetResourceId}
                      </span>
                    ) : (
                      <span className="text-slate-400">N/A</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={rule.actionType}
                      onChange={(e) => handlePermissionChange(rule.targetResourceId, rule.resourceName, e.target.value)}
                      className={`text-xs font-semibold px-2.5 py-1.5 rounded-md border focus:outline-none focus:ring-2 ${
                        rule.actionType === 'sheet_read'
                          ? 'bg-blue-50 text-blue-700 border-blue-200 focus:ring-blue-500'
                          : rule.actionType === 'sheet_read_write'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 focus:ring-emerald-500'
                          : 'bg-rose-50 text-rose-700 border-rose-200 focus:ring-rose-500'
                      }`}
                    >
                      <option value="sheet_read">Read Only (GET)</option>
                      <option value="sheet_read_write">Read & Write (GET + POST/PUT)</option>
                      <option value="sheet_block">Blocked (Deny All)</option>
                    </select>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="text-xs text-rose-600 hover:text-rose-800 font-medium px-2 py-1 hover:bg-rose-50 rounded transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
