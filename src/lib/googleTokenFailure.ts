/**
 * Classification and agent-facing guidance for "Clerk could not hand us a
 * Google access token" — the failure class behind `google_token_fetch_failed`.
 *
 * Pure (no Clerk, no DB, no PostHog) so the MCP route's wording and retry
 * policy are unit-testable: scripts/test-google-token-failure.ts.
 *
 * Why the split between TRANSIENT and DETERMINISTIC matters (measured in
 * production, 30 days to 2026-09-04): every MCP-path token failure in that
 * window was `clerk_error`, and the one account that produced one per day
 * was HEALTHY — its agent fires two calls on the same delegated mailbox
 * within ~100 ms on its first touch of the day, one of them fails at Clerk
 * in ~80-120 ms, the other succeeds, and every later call on that mailbox
 * succeeds. A "reconnect your account" refusal there would be a daily false
 * alarm aimed at a user whose grant is fine. So: unknown Clerk errors are
 * retried once server-side and, if they still fail, get hedged
 * retry-then-reconnect guidance as a ❌ failure; only the states that cannot
 * clear on their own (no grant stored at all, Clerk cannot refresh) get the
 * 🚫 stop-and-reconnect refusal.
 */

export type GoogleTokenFailureReason =
  /** Clerk did not answer within CLERK_TOKEN_TIMEOUT_MS. */
  | 'timeout'
  /** Clerk answered with a refresh failure (422 cannot-refresh: the stored
   * grant has no usable refresh token). Deterministic until reconnect. */
  | 'refresh_failed'
  /** Any other Clerk error — the only class seen in production so far, and
   * transient every time it was inspected. */
  | 'clerk_error'
  /** Clerk answered cleanly but holds no Google token for the user: no
   * Google external account, or one with no stored grant. */
  | 'no_token'
  /** Clerk has no user with the id FGAC stored for the mailbox owner
   * (404 resource_not_found): the owner's FGAC account was deleted, or the
   * row was created against a different Clerk instance. Deterministic, and
   * a reconnect link cannot repair a missing account — the owner must sign
   * in again. Seen 2026-09-04 on a preview (production data + dev Clerk). */
  | 'owner_not_found'
  /** The target address is an access-row entry whose delegation is no longer
   * active (or whose owner row is gone) and is not the key owner's own
   * mailbox either. Nothing to reconnect — the owner must re-delegate. */
  | 'delegation_inactive';

export interface ClassifiedClerkTokenError {
  reason: Extract<GoogleTokenFailureReason, 'timeout' | 'refresh_failed' | 'clerk_error' | 'owner_not_found'>;
  /** Worth one immediate server-side retry. Timeouts already burned the
   * budget; refresh failures are deterministic. */
  retryable: boolean;
  /** Clerk's HTTP status and first error code, when the thrown value is a
   * ClerkAPIResponseError. Enum-like, no customer data — safe on events. */
  clerkStatus?: number;
  clerkCode?: string;
}

/**
 * Map a rejection from `clerkClient().users.getUserOauthAccessToken` to a
 * reason. The regexes mirror the classification that has stamped
 * `google_token_fetch_failed.reason` since 2026-08-20, so the series stays
 * comparable across the change.
 */
export function classifyClerkTokenError(err: unknown): ClassifiedClerkTokenError {
  const message = err instanceof Error ? err.message : String(err);
  const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  const e = err as { status?: unknown; errors?: Array<{ code?: unknown }> } | null;
  const clerkStatus = typeof e?.status === 'number' ? e.status : undefined;
  const firstCode = Array.isArray(e?.errors) ? e.errors[0]?.code : undefined;
  const clerkCode = typeof firstCode === 'string' ? firstCode : undefined;

  if (isTimeout) return { reason: 'timeout', retryable: false, clerkStatus, clerkCode };
  if (clerkStatus === 404 || clerkCode === 'resource_not_found') {
    return { reason: 'owner_not_found', retryable: false, clerkStatus, clerkCode };
  }
  if (/refresh/i.test(message) || (clerkCode !== undefined && /refresh/i.test(clerkCode))) {
    return { reason: 'refresh_failed', retryable: false, clerkStatus, clerkCode };
  }
  return { reason: 'clerk_error', retryable: true, clerkStatus, clerkCode };
}

/** Reasons that cannot clear on their own: the tool refuses (🚫) instead of
 * failing (❌), because retrying is pointless and the fix is a known user
 * action. `delegation_inactive` is deterministic too but is not a token
 * problem — it gets its own text. */
export function isDeterministicTokenFailure(reason: GoogleTokenFailureReason): boolean {
  return reason === 'no_token' || reason === 'refresh_failed' || reason === 'owner_not_found';
}

/** Subset of the deterministic reasons that a reconnect actually repairs —
 * what list_accounts mints a reconnect link for. A missing owner account
 * has nothing to reconnect. */
export function reconnectRepairs(reason: GoogleTokenFailureReason): boolean {
  return reason === 'no_token' || reason === 'refresh_failed';
}

export interface TokenFailureGuidanceInput {
  /** The mailbox the call targeted — the account whose grant is involved. */
  targetEmail: string;
  /** The FGAC user whose proxy key made the call. */
  keyOwnerEmail: string;
  reason: GoogleTokenFailureReason;
  /** `reconnectLink(targetEmail)` — already bound to the target via `for=`. */
  reconnectUrl: string;
  /** Whether a server-side retry already ran (and failed) for this call. */
  retried: boolean;
}

export interface TokenFailureGuidance {
  /** Starts with 🚫 (deterministic → outcome `denied_by_policy`) or ❌
   * (transient / delegation → outcome `failed`). */
  text: string;
  /** Present exactly when `text` is a 🚫 refusal. */
  denialCode?: 'google_token_unavailable';
}

/**
 * The person who can run the reconnect is the mailbox OWNER. For a delegated
 * mailbox that is not the key owner, and the link refuses to run for anyone
 * else (the Accounts page blocks auto-reconnect and warns when `for=` is not
 * the signed-in user — 2026-08-30 incident), so the agent must be told to
 * relay it rather than to "click here".
 */
function reconnectInstruction(input: TokenFailureGuidanceInput): string {
  const delegated = input.targetEmail.toLowerCase() !== input.keyOwnerEmail.toLowerCase();
  if (!delegated) {
    return `👉 Send the user this one-click link — it opens Google's consent screen directly: ${input.reconnectUrl}`;
  }
  return `'${input.targetEmail}' is a delegated mailbox, so only its owner can repair it — the key owner ('${input.keyOwnerEmail}') cannot fix it from their own dashboard, and the link below refuses to run for any other account. ` +
    `👉 Ask the user to forward this one-click link to the owner of '${input.targetEmail}', who must open it while signed in to FGAC as that account: ${input.reconnectUrl}`;
}

function safeOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}

export function tokenFailureGuidance(input: TokenFailureGuidanceInput): TokenFailureGuidance {
  const { targetEmail, reason } = input;
  const reconnect = reconnectInstruction(input);

  if (reason === 'delegation_inactive') {
    return {
      text: `❌ '${targetEmail}' is listed on this key, but its delegation to '${input.keyOwnerEmail}' is no longer active, so there is no Google token to use. ` +
        `STOP — retrying will not help. The owner of '${targetEmail}' must re-delegate the mailbox from "Delegations You've Granted" on their own Accounts page; it then works here again without any change to the key.`,
    };
  }

  if (reason === 'owner_not_found') {
    const origin = safeOrigin(input.reconnectUrl);
    const delegated = targetEmail.toLowerCase() !== input.keyOwnerEmail.toLowerCase();
    return {
      denialCode: 'google_token_unavailable',
      text: `🚫 Not available yet: FGAC's auth provider has no record of the user who owns '${targetEmail}' — the FGAC account behind that mailbox was deleted or never finished signing up. ` +
        `STOP — retrying will NOT help, and a reconnect link cannot repair a missing account. ` +
        (delegated
          ? `The owner of '${targetEmail}' must sign in to FGAC again at ${origin} (that recreates their account), then re-delegate the mailbox to '${input.keyOwnerEmail}' from "Delegations You've Granted" on their Accounts page.`
          : `The user must sign in to FGAC again at ${origin} and reconnect Google from the Accounts page.`),
    };
  }

  if (isDeterministicTokenFailure(reason)) {
    const why = reason === 'no_token'
      ? `FGAC's auth provider holds no Google grant for '${targetEmail}' — the Google account was never connected, or the connection was removed`
      : `FGAC's auth provider can no longer refresh the Google grant for '${targetEmail}' (the stored grant has no usable refresh token — this happens when Google revokes access or the account was connected without offline access)`;
    return {
      denialCode: 'google_token_unavailable',
      text: `🚫 Not available yet: ${why}. ` +
        `STOP — every call on this account will fail until it is reconnected; retrying will NOT help. ` +
        `${reconnect} — then retry once after they confirm.`,
    };
  }

  // Transient: timeout, or an unknown Clerk error that survived one retry.
  const what = reason === 'timeout'
    ? `FGAC's auth provider did not return a Google token for '${targetEmail}' in time`
    : `FGAC's auth provider returned an error instead of a Google token for '${targetEmail}'${input.retried ? ' (retried once)' : ''}`;
  return {
    text: `❌ ${what}. This is usually temporary — the same account typically succeeds on the next attempt. ` +
      `Retry ONCE after a few seconds. If the retry fails the same way, the account's Google grant needs reconnecting: ${reconnect} — then retry once after they confirm.`,
  };
}
