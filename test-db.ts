import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const sql = neon(process.env.neon__POSTGRES_URL!);
async function run() {
  const result = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'proxy_keys'`;
  console.log(result);
}
run();
