/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * This endpoint returns Clerk's authorization server configuration —
 * authorize, token, and registration endpoints.
 * MCP clients use this to know where to send the user for login
 * and where to exchange authorization codes for tokens.
 *
 * SPIKE: Validates that Clerk exposes the right endpoints for DCR + PKCE.
 */
import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next';

const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

export const GET = handler;
export const OPTIONS = corsHandler;
