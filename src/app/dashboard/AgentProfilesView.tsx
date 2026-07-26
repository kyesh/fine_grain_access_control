'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardHeader, Badge, EmptyState, buttonPrimary, buttonSecondary, buttonDanger } from '@/components/ui';
import Link from 'next/link';
import { assignRulesToKey, unassignRuleFromKey, revokeProxyKey, setSheetRulePermission } from './actions';
import { EditRuleButton } from './EditRuleButton';
import { DeleteRuleButton } from './DeleteRuleButton';
import { RuleControls } from './RuleControls';
import { KeyControls, SecretKeyDisplay } from './KeyControls';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  key: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  emailAccess: string[];
}

export interface Rule {
  id: string;
  ruleName: string;
  service: string;
  actionType: string;
  regexPattern: string | null;
  targetResourceId: string | null;
  resourceName: string | null;
  targetEmail: string | null;
  assignedKeyIds: string[];
}

interface Connection {
  id: string;
  clientId: string;
  clientName: string | null;
  nickname: string | null;
  status: 'pending' | 'approved' | 'blocked';
  proxyKeyId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface AccessibleEmail {
  email: string;
  type: 'own' | 'delegated';
  delegationId?: string;
  hasCompleteGoogleAccess?: boolean;
}

function timeAgo(date: string | null): string {
  if (!date) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** A rule with no assignments at all applies to every profile. */
const isGlobal = (rule: Rule) => rule.assignedKeyIds.length === 0;

// ─── Root ───────────────────────────────────────────────────────────────────

export function AgentProfilesView({
  profiles,
  rules,
  accessibleEmails,
  mcpEndpoint,
  hasCompleteGoogleAccess,
}: {
  profiles: Profile[];
  rules: Rule[];
  accessibleEmails: AccessibleEmail[];
  mcpEndpoint: string;
  hasCompleteGoogleAccess: boolean;
}) {
  const activeProfiles = useMemo(() => profiles.filter(p => !p.revokedAt), [profiles]);
  const [activeId, setActiveId] = useState<string | null>(activeProfiles[0]?.id ?? null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  // Keep the selected tab valid when profiles are added or revoked.
  useEffect(() => {
    if (activeProfiles.length === 0) {
      setActiveId(null);
    } else if (!activeProfiles.some(p => p.id === activeId)) {
      setActiveId(activeProfiles[0].id);
    }
  }, [activeProfiles, activeId]);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/connections');
      const data = await res.json();
      setConnections(data.connections || []);
    } catch (e) {
      console.error('Failed to fetch connections:', e);
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const active = activeProfiles.find(p => p.id === activeId) ?? null;
  const pending = connections.filter(c => c.status === 'pending');

  const { sheetRules, gmailRules } = useMemo(() => {
    if (!active) return { sheetRules: [], gmailRules: [] };
    const forProfile = rules.filter(r => isGlobal(r) || r.assignedKeyIds.includes(active.id));
    return {
      sheetRules: forProfile.filter(r => r.service === 'sheets'),
      gmailRules: forProfile.filter(r => r.service !== 'sheets'),
    };
  }, [rules, active]);

  const activeKeyList = activeProfiles.map(p => ({ id: p.id, label: p.label }));
  const emailList = accessibleEmails.map(e => e.email);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {pending.length > 0 && (
        <PendingBanner count={pending.length} first={pending[0]} />
      )}

      <ProfileTabs
        profiles={activeProfiles}
        activeId={activeId}
        onSelect={setActiveId}
        accessibleEmails={accessibleEmails}
        profilesForKeyControls={profiles}
      />

      {!active ? (
        <Card className="p-10 text-center">
          <h2 className="text-lg font-bold text-foreground">No agent profiles yet</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            A profile is a scoped identity you hand to one agent. Create one to start
            granting access — until then, every agent is denied by default.
          </p>
          <div className="mt-5 inline-block">
            <KeyControls accessibleEmails={accessibleEmails} existingKeys={[]} />
          </div>
        </Card>
      ) : (
        <>
          <ProfileHeader profile={active} />

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
            <div className="space-y-6 min-w-0">
              <SheetsRulesCard
                profileId={active.id}
                rules={sheetRules}
                allRules={rules}
              />

              <GmailRulesCard
                profileId={active.id}
                rules={gmailRules}
                allRules={rules}
                accessibleEmails={emailList}
                activeKeys={activeKeyList}
              />
            </div>

            <div className="space-y-6 min-w-0">
              <ConnectedAgentsCard
                profileId={active.id}
                profiles={activeProfiles}
                connections={connections}
                loading={connectionsLoading}
                onChanged={fetchConnections}
              />

              <GmailAccessCard
                profile={active}
                accessibleEmails={accessibleEmails}
                hasCompleteGoogleAccess={hasCompleteGoogleAccess}
              />

              <McpConnectCard endpoint={mcpEndpoint} proxyKey={active.key} />
            </div>
          </div>

          {/* Rule creation lives outside the per-service cards because a new rule
              may target either service. */}
          <Card>
            <CardHeader
              title="Create a rule"
              subtitle="Rules are reusable — create once, then apply to any profile."
              action={
                <RuleControls
                  accessibleEmails={emailList}
                  activeKeys={activeKeyList}
                  hasBlacklistRules={rules.some(r => r.actionType === 'read_blacklist')}
                />
              }
            />
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Pending banner ─────────────────────────────────────────────────────────

function PendingBanner({ count, first }: { count: number; first: Connection }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-warning-foreground bg-warning px-5 py-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-warning-foreground">
          {count === 1 ? '1 agent waiting for approval' : `${count} agents waiting for approval`}
        </p>
        <p className="text-xs text-warning-foreground/80 mt-0.5 truncate">
          &ldquo;{first.clientName || first.clientId}&rdquo; connected {timeAgo(first.createdAt).toLowerCase()}.
          Attach it to a profile to grant access.
        </p>
      </div>
      <a href="#connected-agents" className={`${buttonSecondary} shrink-0`}>
        Attach to a profile
      </a>
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

function ProfileTabs({
  profiles,
  activeId,
  onSelect,
  accessibleEmails,
  profilesForKeyControls,
}: {
  profiles: Profile[];
  activeId: string | null;
  onSelect: (id: string) => void;
  accessibleEmails: AccessibleEmail[];
  profilesForKeyControls: Profile[];
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border overflow-x-auto">
      <div role="tablist" className="flex items-center gap-1 min-w-0">
        {profiles.map(p => {
          const isActive = p.id === activeId;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(p.id)}
              className={`whitespace-nowrap px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="ml-auto pl-3 pb-1.5 shrink-0">
        <KeyControls
          variant="button"
          triggerLabel="+ New profile"
          accessibleEmails={accessibleEmails}
          existingKeys={profilesForKeyControls.map(p => ({
            id: p.id,
            key: p.key,
            label: p.label,
            revokedAt: p.revokedAt ? new Date(p.revokedAt) : null,
            expiresAt: null,
            createdAt: new Date(p.createdAt),
            emailAccess: p.emailAccess,
          }))}
        />
      </div>
    </div>
  );
}

// ─── Profile header ─────────────────────────────────────────────────────────

function ProfileHeader({ profile }: { profile: Profile }) {
  const [revoking, setRevoking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary bg-primary-muted text-[13px] font-bold text-primary">
          {profile.label.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground truncate">{profile.label}</h1>
            <Badge tone="success">● Active</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Created {new Date(profile.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {confirming ? (
          <>
            <span className="text-[13px] text-muted-foreground">
              Revoke this key? Agents using it lose access immediately.
            </span>
            <button
              className={buttonDanger}
              disabled={revoking}
              onClick={async () => {
                setRevoking(true);
                try {
                  await revokeProxyKey(profile.id);
                } finally {
                  setRevoking(false);
                  setConfirming(false);
                }
              }}
            >
              {revoking ? 'Revoking…' : 'Confirm revoke'}
            </button>
            <button className={buttonSecondary} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className={buttonDanger} onClick={() => setConfirming(true)}>
            Revoke key
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Google Sheets rules ────────────────────────────────────────────────────

const SHEET_PERMISSIONS = [
  { value: 'sheet_read', label: 'Read Only', tone: 'info' as const },
  { value: 'sheet_read_write', label: 'Read & Write', tone: 'success' as const },
  { value: 'sheet_block', label: 'Blocked', tone: 'error' as const },
];

function SheetsRulesCard({
  profileId,
  rules,
  allRules,
}: {
  profileId: string;
  rules: Rule[];
  allRules: Rule[];
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const applicable = allRules.filter(
    r => r.service === 'sheets' && !isGlobal(r) && !r.assignedKeyIds.includes(profileId),
  );

  return (
    <Card tone="sheets">
      <CardHeader
        title="Google Sheets Rules"
        subtitle="Spreadsheets this profile can reach"
        action={
          <div className="relative">
            <button className={buttonSecondary} onClick={() => setPopoverOpen(v => !v)}>
              + Expose a sheet
            </button>
            {popoverOpen && (
              <ApplyRulePopover
                profileId={profileId}
                candidates={applicable}
                emptyMessage={
                  <>
                    {allRules.some(r => r.service === 'sheets')
                      ? 'Every exposed sheet already applies to this profile. Grant access to another from '
                      : 'No sheets have been exposed to FGAC yet. Grant access to a file from '}
                    <Link href="/dashboard/accounts" className="font-semibold text-primary hover:underline">
                      Accounts
                    </Link>
                    .
                  </>
                }
                onClose={() => setPopoverOpen(false)}
              />
            )}
          </div>
        }
      />
      <div className="px-5 pb-5 space-y-2">
        {rules.length === 0 ? (
          <EmptyState>
            No sheets exposed to this profile.{' '}
            <Link href="/dashboard/accounts" className="font-semibold text-primary hover:underline">
              Grant access to a file
            </Link>{' '}
            to get started.
          </EmptyState>
        ) : (
          rules.map(rule => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {rule.resourceName || rule.ruleName}
                  </span>
                  {isGlobal(rule) && <Badge tone="neutral">Global</Badge>}
                </div>
                {rule.targetResourceId && (
                  <code className="mt-1 block truncate font-mono text-[11px] text-subtle">
                    {rule.targetResourceId}
                  </code>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <SheetPermissionSelect rule={rule} />
                {!isGlobal(rule) && <DetachRuleButton profileId={profileId} rule={rule} />}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

/**
 * Saves on change. The select is recolored to match the permission so the
 * access level of every sheet is legible at a glance without reading labels.
 */
function SheetPermissionSelect({ rule }: { rule: Rule }) {
  const [value, setValue] = useState(rule.actionType);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const tone = SHEET_PERMISSIONS.find(p => p.value === value)?.tone ?? 'neutral';
  const toneClass = {
    info: 'border-info-foreground/30 bg-info text-info-foreground',
    success: 'border-success-foreground/30 bg-success text-success-foreground',
    error: 'border-error-foreground/30 bg-error text-error-foreground',
    neutral: 'border-border bg-muted text-muted-foreground',
  }[tone];

  return (
    <div className="flex items-center gap-2">
      {failed && <span className="text-[11px] text-destructive">Couldn&apos;t save</span>}
      <select
        value={value}
        disabled={busy}
        aria-label={`Permission for ${rule.resourceName || rule.ruleName}`}
        onChange={async e => {
          const next = e.target.value;
          const previous = value;
          setValue(next);          // optimistic
          setFailed(false);
          setBusy(true);
          try {
            await setSheetRulePermission(rule.id, next);
          } catch {
            setValue(previous);    // roll back on failure
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-60 ${toneClass}`}
      >
        {SHEET_PERMISSIONS.map(p => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Gmail rules ────────────────────────────────────────────────────────────

function GmailRulesCard({
  profileId,
  rules,
  allRules,
  accessibleEmails,
  activeKeys,
}: {
  profileId: string;
  rules: Rule[];
  allRules: Rule[];
  accessibleEmails: string[];
  activeKeys: { id: string; label: string }[];
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Only rules that exist but are not yet on this profile can be applied.
  // Global rules are excluded — they already apply everywhere.
  const applicable = allRules.filter(
    r => r.service !== 'sheets' && !isGlobal(r) && !r.assignedKeyIds.includes(profileId),
  );

  return (
    <Card tone="gmail">
      <CardHeader
        title="Gmail Rules"
        subtitle="Rules that govern this profile's access to mail"
        action={
          <div className="relative">
            <button className={buttonSecondary} onClick={() => setPopoverOpen(v => !v)}>
              + Apply a rule
            </button>
            {popoverOpen && (
              <ApplyRulePopover
                profileId={profileId}
                candidates={applicable}
                emptyMessage={
                  allRules.some(r => r.service !== 'sheets')
                    ? 'Every existing Gmail rule already applies to this profile.'
                    : "You haven't created any Gmail rules yet — use “Create a rule” below."
                }
                onClose={() => setPopoverOpen(false)}
              />
            )}
          </div>
        }
      />
      <div className="px-5 pb-5 space-y-2">
        {rules.length === 0 ? (
          <EmptyState>
            No Gmail rules on this profile. With no rules, access is denied by default.
          </EmptyState>
        ) : (
          rules.map(rule => (
            <div
              key={rule.id}
              className="flex items-start justify-between gap-4 rounded-sm border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">{rule.ruleName}</span>
                  <RuleTypeBadge actionType={rule.actionType} />
                  {isGlobal(rule) && <Badge tone="neutral">Global</Badge>}
                </div>
                {rule.regexPattern && (
                  <code className="mt-1.5 block truncate rounded-xs bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {rule.regexPattern}
                  </code>
                )}
                <p className="mt-1 text-[11px] text-subtle">
                  {rule.targetEmail ? `Scoped to ${rule.targetEmail}` : 'All accessible mailboxes'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <EditRuleButton rule={rule} accessibleEmails={accessibleEmails} activeKeys={activeKeys} />
                {!isGlobal(rule) && <DetachRuleButton profileId={profileId} rule={rule} />}
                <DeleteRuleButton id={rule.id} />
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function RuleTypeBadge({ actionType }: { actionType: string }) {
  if (actionType === 'read_blacklist') return <Badge tone="error">Read Blacklist</Badge>;
  if (actionType === 'send_whitelist') return <Badge tone="success">Send Whitelist</Badge>;
  return <Badge tone="neutral">{actionType}</Badge>;
}

/**
 * Detaching the last assignment would silently promote the rule to global —
 * i.e. widen its reach instead of narrowing it. That inversion is surprising
 * enough to warrant an inline confirm.
 */
function DetachRuleButton({ profileId, rule }: { profileId: string; rule: Rule }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const wouldBecomeGlobal = rule.assignedKeyIds.length === 1;

  if (!confirming) {
    return (
      <button
        className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => setConfirming(true)}
      >
        Detach
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {wouldBecomeGlobal && (
        <span className="text-[11px] text-warning-foreground max-w-[180px]">
          This is the last profile using it — detaching makes the rule apply to <em>all</em> profiles.
        </span>
      )}
      <button
        className="text-[11px] font-semibold text-destructive hover:opacity-80 disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await unassignRuleFromKey(profileId, rule.id);
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
      >
        {busy ? '…' : 'Confirm'}
      </button>
      <button
        className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </button>
    </div>
  );
}

function ApplyRulePopover({
  profileId,
  candidates,
  onClose,
  emptyMessage = 'Every existing rule already applies here.',
}: {
  profileId: string;
  candidates: Rule[];
  onClose: () => void;
  emptyMessage?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const filtered = candidates.filter(r =>
    r.ruleName.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div
      ref={ref}
      className="absolute right-0 z-20 mt-2 w-[320px] rounded-lg border border-border bg-popover shadow-lg"
    >
      <div className="border-b border-border px-5 py-3">
        <p className="text-[13px] font-bold text-popover-foreground">Apply an existing rule</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Rules are shared across profiles.
        </p>
      </div>

      <div className="px-5 pt-3 pb-1">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search rules…"
          autoFocus
          className="w-full rounded-sm border border-input bg-card px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      </div>

      <div className="max-h-56 overflow-y-auto px-5 py-2 space-y-1">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-muted-foreground">
            {candidates.length === 0 ? emptyMessage : 'No rules match that search.'}
          </p>
        ) : (
          filtered.map(rule => (
            <label
              key={rule.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-xs px-2 py-1.5 hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selected.includes(rule.id)}
                onChange={e =>
                  setSelected(prev =>
                    e.target.checked ? [...prev, rule.id] : prev.filter(id => id !== rule.id),
                  )
                }
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-popover-foreground">
                {rule.ruleName}
              </span>
              <RuleTypeBadge actionType={rule.actionType} />
            </label>
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-b-lg border-t border-border bg-muted px-5 py-3">
        <span className="text-[11px] text-muted-foreground">
          {selected.length} selected
        </span>
        <div className="flex items-center gap-2">
          <button className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button
            className={buttonPrimary}
            disabled={selected.length === 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await assignRulesToKey(profileId, selected);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Connected agents ───────────────────────────────────────────────────────

function ConnectedAgentsCard({
  profileId,
  profiles,
  connections,
  loading,
  onChanged,
}: {
  profileId: string;
  profiles: Profile[];
  connections: Connection[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = async (connectionId: string, action: string, extra?: Record<string, string>) => {
    setBusyId(connectionId);
    try {
      await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, action, ...extra }),
      });
      await onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const mine = connections.filter(c => c.status === 'approved' && c.proxyKeyId === profileId);
  const pending = connections.filter(c => c.status === 'pending');

  return (
    <Card className="scroll-mt-24" >
      <div id="connected-agents" />
      <CardHeader
        title="Connected Agents"
        subtitle="Authenticated agents using this profile"
      />
      <div className="px-5 pb-5 space-y-2.5">
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-14 animate-pulse rounded-sm bg-muted" />
            <div className="h-14 animate-pulse rounded-sm bg-muted" />
          </div>
        ) : (
          <>
            {mine.length === 0 && pending.length === 0 && (
              <EmptyState>
                No agents attached yet. Connect one with the endpoint below and it will
                appear here for approval.
              </EmptyState>
            )}

            {mine.map(conn => (
              <div key={conn.id} className="rounded-sm border border-border bg-card p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                    {conn.nickname || conn.clientName || conn.clientId}
                  </span>
                  <Badge tone="success">Approved</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-subtle">Last used {timeAgo(conn.lastUsedAt)}</span>
                  <button
                    className="text-[11px] font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
                    disabled={busyId === conn.id}
                    onClick={() => act(conn.id, 'block')}
                  >
                    {busyId === conn.id ? '…' : 'Detach'}
                  </button>
                </div>
              </div>
            ))}

            {pending.map(conn => (
              <PendingAgentCard
                key={conn.id}
                conn={conn}
                profiles={profiles}
                defaultProfileId={profileId}
                busy={busyId === conn.id}
                onApprove={(keyId, nickname) => act(conn.id, 'approve', { proxyKeyId: keyId, nickname })}
                onBlock={() => act(conn.id, 'block')}
              />
            ))}
          </>
        )}
      </div>
    </Card>
  );
}

function PendingAgentCard({
  conn,
  profiles,
  defaultProfileId,
  busy,
  onApprove,
  onBlock,
}: {
  conn: Connection;
  profiles: Profile[];
  defaultProfileId: string;
  busy: boolean;
  onApprove: (keyId: string, nickname: string) => void;
  onBlock: () => void;
}) {
  const [keyId, setKeyId] = useState(defaultProfileId);
  const [nickname, setNickname] = useState(conn.clientName || '');

  return (
    <div className="rounded-sm border border-warning-foreground bg-warning p-3.5 animate-pulse-subtle">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-semibold text-warning-foreground">
          {conn.clientName || conn.clientId}
        </span>
        <Badge tone="warning">Pending</Badge>
      </div>
      <p className="mt-0.5 text-[11px] text-warning-foreground/80">
        Connected {timeAgo(conn.createdAt).toLowerCase()}
      </p>

      <div className="mt-3 space-y-2">
        <input
          type="text"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          placeholder="Nickname (e.g. My Work Agent)"
          className="w-full rounded-xs border border-input bg-card px-2 py-1.5 text-[12px] text-foreground placeholder:text-subtle"
        />
        <select
          value={keyId}
          onChange={e => setKeyId(e.target.value)}
          className="w-full rounded-xs border border-input bg-card px-2 py-1.5 text-[12px] text-foreground"
        >
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          className={`${buttonPrimary} flex-1`}
          disabled={busy || !keyId}
          onClick={() => onApprove(keyId, nickname)}
        >
          {busy ? '…' : 'Attach to this profile'}
        </button>
        <button className={buttonDanger} disabled={busy} onClick={onBlock}>
          Block
        </button>
      </div>
    </div>
  );
}

// ─── Gmail account access ───────────────────────────────────────────────────

function GmailAccessCard({
  profile,
  accessibleEmails,
  hasCompleteGoogleAccess,
}: {
  profile: Profile;
  accessibleEmails: AccessibleEmail[];
  hasCompleteGoogleAccess: boolean;
}) {
  return (
    <Card>
      <CardHeader title="Gmail Account Access" subtitle="Mailboxes this profile can reach" />
      <div className="px-5 pb-5 space-y-2">
        {profile.emailAccess.length === 0 ? (
          <EmptyState>This profile has no mailbox access.</EmptyState>
        ) : (
          profile.emailAccess.map(email => {
            const meta = accessibleEmails.find(e => e.email === email);
            const isOwn = meta?.type === 'own';
            const healthy = !isOwn || hasCompleteGoogleAccess;
            return (
              <div
                key={email}
                className="flex items-center justify-between gap-2 rounded-sm border border-border bg-card px-3 py-2"
              >
                <span className="min-w-0 truncate text-[13px] text-foreground">{email}</span>
                {healthy ? (
                  <Badge tone={isOwn ? 'success' : 'primary'}>{isOwn ? 'You' : 'Delegated'}</Badge>
                ) : (
                  <Badge tone="error">Reconnect</Badge>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

// ─── MCP endpoint ───────────────────────────────────────────────────────────

function McpConnectCard({ endpoint, proxyKey }: { endpoint: string; proxyKey: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Connect a new agent via MCP"
        subtitle="Point any MCP client at this endpoint. It will show up above as pending until you attach it to a profile."
      />
      <div className="px-5 pb-5 space-y-3">
        {/* Endpoint and key sit together because configuring an agent needs
            both; splitting them across cards made people hunt for the key. */}
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">
            Bearer token for this profile
          </p>
          <SecretKeyDisplay apiKey={proxyKey} className="text-[12px] text-foreground w-full" />
        </div>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(endpoint);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex w-full items-center justify-between gap-2 rounded-sm bg-surface-inverse px-3 py-2 text-left"
        >
          <code className="min-w-0 truncate font-mono text-[11px] text-surface-inverse-foreground">
            {endpoint}
          </code>
          <span className="shrink-0 text-[11px] font-semibold text-surface-inverse-foreground">
            {copied ? 'Copied' : 'Copy'}
          </span>
        </button>
      </div>
    </Card>
  );
}
