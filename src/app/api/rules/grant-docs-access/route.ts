import { NextRequest } from 'next/server';
import { grantFileAccessGET, grantFileAccessPOST, grantFileAccessDELETE } from '../fileAccessHandlers';

export const dynamic = 'force-dynamic';

/** /api/rules/grant-docs-access — see fileAccessHandlers.ts. */
export async function GET() {
  return grantFileAccessGET('doc');
}

export async function POST(request: NextRequest) {
  return grantFileAccessPOST('doc', request);
}

export async function DELETE(request: NextRequest) {
  return grantFileAccessDELETE('doc', request);
}
