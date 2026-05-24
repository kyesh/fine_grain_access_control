'use client';

import { useState, useEffect, useCallback } from 'react';

interface Connection {
  id: string;
  clientId: string;
  clientName: string | null;
  nickname: string | null;
  status: 'pending' | 'approved' | 'blocked';
  proxyKeyId: string | null;
  createdAt: string;
  approvedAt: string | null;
  lastUsedAt: string | null;
}

interface ProxyKey {
  id: string;
  label: string;
  revokedAt: string | null;
}

function timeAgo(date: string | null): string {
  if (!date) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function ConnectionsPanel() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [availableKeys, setAvailableKeys] = useState<ProxyKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingNickname, setEditingNickname] = useState<string | null>(null);
  const [nicknameValue, setNicknameValue] = useState('');

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/connections');
      const data = await res.json();
      setConnections(data.connections || []);
      setAvailableKeys((data.availableKeys || []).filter((k: ProxyKey) => !k.revokedAt));
    } catch (e) {
      console.error('Failed to fetch connections:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const handleAction = async (connectionId: string, action: string, extra?: Record<string, string>) => {
    setActionLoading(connectionId);
    try {
      await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, action, ...extra }),
      });
      await fetchConnections();
    } finally {
      setActionLoading(null);
      setEditingNickname(null);
    }
  };

  const pending = connections.filter(c => c.status === 'pending');
  const approved = connections.filter(c => c.status === 'approved');
  const blocked = connections.filter(c => c.status === 'blocked');

  if (loading) {
    return (
      <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200">
        <div className="px-4 py-5 sm:p-6">
          <div className="animate-pulse flex space-x-4">
            <div className="flex-1 space-y-3 py-1">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-medium leading-6 text-gray-900">Agent Connections</h2>
            <p className="mt-1 text-sm text-gray-500">
              Manage connections from MCP agents and apps. Approve to grant access, or block to deny.
            </p>
          </div>
          <button
            onClick={fetchConnections}
            className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
          >
            ↻ Refresh
          </button>
        </div>

        {connections.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
            <p className="text-sm text-gray-600">
              No agent connections yet. When an MCP agent connects, it will appear here for approval.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── Pending Connections ── */}
            {pending.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-1">
                  ⏳ Pending Approval ({pending.length})
                </h3>
                <div className="space-y-2">
                  {pending.map(conn => (
                    <PendingCard
                      key={conn.id}
                      conn={conn}
                      keys={availableKeys}
                      loading={actionLoading === conn.id}
                      onApprove={(keyId, nick) =>
                        handleAction(conn.id, 'approve', { proxyKeyId: keyId, nickname: nick })
                      }
                      onBlock={() => handleAction(conn.id, 'block')}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Approved Connections ── */}
            {approved.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1">
                  ✅ Approved ({approved.length})
                </h3>
                <div className="space-y-2">
                  {approved.map(conn => {
                    const boundKey = availableKeys.find(k => k.id === conn.proxyKeyId);
                    return (
                      <div key={conn.id} className="border border-green-200 bg-green-50/50 rounded-lg px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            {editingNickname === conn.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={nicknameValue}
                                  onChange={e => setNicknameValue(e.target.value)}
                                  className="text-sm font-medium border border-gray-300 rounded px-2 py-1 w-48"
                                  autoFocus
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleAction(conn.id, 'update_nickname', { nickname: nicknameValue });
                                    if (e.key === 'Escape') setEditingNickname(null);
                                  }}
                                />
                                <button
                                  onClick={() => handleAction(conn.id, 'update_nickname', { nickname: nicknameValue })}
                                  className="text-xs text-green-600 hover:text-green-800"
                                >Save</button>
                              </div>
                            ) : (
                              <div
                                className="cursor-pointer group"
                                onClick={() => { setEditingNickname(conn.id); setNicknameValue(conn.nickname || ''); }}
                              >
                                <span className="text-sm font-medium text-gray-900">
                                  {conn.nickname || conn.clientName || conn.clientId}
                                </span>
                                <span className="text-xs text-gray-400 ml-1 opacity-0 group-hover:opacity-100">✏️</span>
                              </div>
                            )}
                            {conn.nickname && conn.clientName && conn.clientName !== conn.nickname && (
                              <p className="text-xs text-gray-500 mt-0.5">{conn.clientName}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                              🔑 {boundKey?.label || 'Unknown key'}
                            </span>
                            <span title="Last used">🕐 {timeAgo(conn.lastUsedAt)}</span>
                            <button
                              onClick={() => handleAction(conn.id, 'block')}
                              disabled={actionLoading === conn.id}
                              className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded border border-red-200 hover:bg-red-50"
                            >
                              Block
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Blocked Connections ── */}
            {blocked.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1">
                  🚫 Blocked ({blocked.length})
                </h3>
                <div className="space-y-2">
                  {blocked.map(conn => (
                    <div key={conn.id} className="border border-gray-200 bg-gray-50 rounded-lg px-4 py-3 opacity-60">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium text-gray-600 line-through">
                            {conn.nickname || conn.clientName || conn.clientId}
                          </span>
                          {conn.clientName && (
                            <p className="text-xs text-gray-400 mt-0.5">{conn.clientName}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleAction(conn.id, 'approve', { proxyKeyId: availableKeys[0]?.id || '' })}
                          disabled={actionLoading === conn.id || availableKeys.length === 0}
                          className="text-xs text-green-600 hover:text-green-800 px-2 py-1 rounded border border-green-200 hover:bg-green-50"
                        >
                          Unblock
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pending Card Component ───────────────────────────────────────────────

function PendingCard({
  conn,
  keys,
  loading,
  onApprove,
  onBlock,
}: {
  conn: Connection;
  keys: ProxyKey[];
  loading: boolean;
  onApprove: (keyId: string, nickname: string) => void;
  onBlock: () => void;
}) {
  const [selectedKeyId, setSelectedKeyId] = useState(keys[0]?.id || '');
  const [nickname, setNickname] = useState(conn.clientName || '');

  return (
    <div className="border-2 border-amber-300 bg-amber-50 rounded-lg px-4 py-4 animate-pulse-subtle">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {conn.clientName || conn.clientId}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Connected {timeAgo(conn.createdAt)} · Client ID: <code className="text-xs bg-gray-100 px-1 rounded">{conn.clientId.slice(0, 12)}…</code>
          </p>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-600">Nickname:</label>
            <input
              type="text"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="e.g., My Work Agent"
              className="text-sm border border-gray-300 rounded px-2 py-1 w-44"
            />

            <label className="text-xs text-gray-600 ml-2">Profile:</label>
            <select
              value={selectedKeyId}
              onChange={e => setSelectedKeyId(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1"
            >
              {keys.length === 0 && <option value="">No keys available</option>}
              {keys.map(k => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => onApprove(selectedKeyId, nickname)}
            disabled={loading || !selectedKeyId}
            className="inline-flex items-center px-3 py-1.5 border border-green-300 text-sm font-medium rounded-md text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50"
          >
            {loading ? '…' : '✓ Approve'}
          </button>
          <button
            onClick={onBlock}
            disabled={loading}
            className="inline-flex items-center px-3 py-1.5 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
          >
            ✗ Block
          </button>
        </div>
      </div>
    </div>
  );
}
