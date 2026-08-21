import { NextRequest } from 'next/server';
import { verifyFileAccessGET } from '../fileAccessHandlers';

export const dynamic = 'force-dynamic';

/** GET /api/rules/verify-docs-access?did=… — see fileAccessHandlers.ts. */
export async function GET(request: NextRequest) {
  return verifyFileAccessGET('doc', request);
}
