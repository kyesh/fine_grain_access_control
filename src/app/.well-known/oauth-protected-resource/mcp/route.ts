/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * This endpoint tells MCP clients where to authenticate.
 * When a client hits /mcp and gets a 401, it follows the WWW-Authenticate
 * header to this endpoint, which points it to Clerk's authorization server.
 *
 * SPIKE: Validates that MCP clients can discover our auth requirements.
 */
import {
  protectedResourceHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next';

const handler = protectedResourceHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

export const GET = handler;
export const OPTIONS = corsHandler;
