import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkDb() {
  const sql = neon(process.env.neon__POSTGRES_URL || process.env.POSTGRES_URL!);
  const result = await sql`SELECT * FROM waitlist`;
  console.log(JSON.stringify(result, null, 2));
}

checkDb().catch(console.error);
