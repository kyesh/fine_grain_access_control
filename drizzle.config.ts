import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config({ path: ".env.local" });

const getGitBranch = () => {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
};

const gitBranch = getGitBranch();
const isMainBranch = gitBranch === 'main';

// Determine the URL to use. Fallbacks exist, but we will guard them heavily.
const dbUrl = process.env.neon__POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";

if (!isMainBranch && dbUrl.includes('.neon.tech')) {
  if (!process.env.neon__POSTGRES_URL) {
    console.log(`\n🌿 Branch '${gitBranch}' isolated connection missing. Auto-provisioning via neonctl...`);
    try {
      execSync('npm run db:branch', { stdio: 'inherit' });
      // Reload environment to capture the newly injected neon__POSTGRES_URL
      dotenv.config({ path: ".env.local", override: true });
      if (!process.env.neon__POSTGRES_URL) {
        throw new Error("neon__POSTGRES_URL still missing after db:branch execution");
      }
    } catch (e: unknown) {
      console.error(`\n🚨 DRIZZLE SAFETY ABORT: Auto-provisioning failed. Could not secure isolated Neon branch.`);
      process.exit(1);
    }
  }
}

const finalDbUrl = process.env.neon__POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: finalDbUrl,
  },
  verbose: true,
  strict: true,
});
