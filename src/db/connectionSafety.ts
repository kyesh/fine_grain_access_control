/**
 * Which database is this process allowed to talk to?
 *
 * The rule is deliberately about the RESOLVED HOST, not about which variable
 * happened to be set. The previous guard only refused production when no branch
 * URL existed at all — but `POSTGRES_URL` in a pulled .env.local points at the
 * production pooler, and it sits in the same fallback chain as the branch URL.
 * Lose `neon__POSTGRES_URL` for any reason and the app would quietly run against
 * production with no warning printed.
 */

/** Neon endpoint id of the production (default) branch. */
export const PRODUCTION_DB_HOST_PREFIX = 'ep-young-rain-adze6m3c';

export function hostOf(connectionString: string): string {
  return connectionString.split('@')[1]?.split('/')[0] ?? '';
}

export function isProductionHost(connectionString: string): boolean {
  return hostOf(connectionString).startsWith(PRODUCTION_DB_HOST_PREFIX);
}

export interface ResolveOptions {
  /** process.env.NODE_ENV === 'production' */
  isProductionRuntime: boolean;
  /** Next.js production build step — no real queries run. */
  isBuildTime: boolean;
  env: Record<string, string | undefined>;
}

export interface Resolution {
  connectionString: string;
  /** Human-readable description for logs and the env:check doctor. */
  describe: string;
  fatal?: string;
}

/**
 * In production runtime: use whatever Vercel/Neon injected.
 *
 * Everywhere else: ONLY `neon__POSTGRES_URL` (written by `npm run db:branch`)
 * is acceptable, and it must not resolve to the production host. There is no
 * fallback chain in development — a missing branch URL is an error, never a
 * reason to reach for the next variable.
 */
export function resolveConnection(opts: ResolveOptions): Resolution {
  const { isProductionRuntime, isBuildTime, env } = opts;

  if (isProductionRuntime || isBuildTime) {
    const url = env.neon__POSTGRES_URL || env.POSTGRES_URL || env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || '';
    return { connectionString: url, describe: isBuildTime ? 'build-time (no queries)' : `production runtime → ${hostOf(url) || 'unset'}` };
  }

  const branchUrl = env.neon__POSTGRES_URL;

  if (!branchUrl) {
    return {
      connectionString: '',
      describe: 'no branch URL',
      fatal:
        'No neon__POSTGRES_URL. Run `npm run db:branch` to provision an isolated Neon branch.\n' +
        'Development deliberately does NOT fall back to POSTGRES_URL or DATABASE_URL — both\n' +
        'point at production in a pulled .env.local.',
    };
  }

  if (isProductionHost(branchUrl)) {
    return {
      connectionString: '',
      describe: `PRODUCTION host (${hostOf(branchUrl)})`,
      fatal:
        `neon__POSTGRES_URL points at the PRODUCTION database (${hostOf(branchUrl)}).\n` +
        'Refusing to connect outside a production runtime. Re-run `npm run db:branch`.',
    };
  }

  return { connectionString: branchUrl, describe: `branch → ${hostOf(branchUrl)}` };
}
