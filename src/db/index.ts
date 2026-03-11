import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

// The DATABASE_URL will be pulled from the environment variables safely on Vercel Edge
const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle({ client: sql });
