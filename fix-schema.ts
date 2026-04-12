import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const sql = neon(process.env.neon__POSTGRES_URL!);
async function run() {
  try {
    await sql`ALTER TABLE "proxy_keys" ADD COLUMN IF NOT EXISTS "public_key" text`;
    console.log("Success adding public_key!");
  } catch (e) {
    console.error(e);
  }
}
run();
