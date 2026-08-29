/**
 * RFC 9728 path-insertion probe location for profile-addressed MCP URLs.
 *
 * The canonical well-known path for resource /api/mcp/<slug> is
 * /.well-known/oauth-protected-resource/api/mcp/<slug> — clients that ignore
 * the explicit WWW-Authenticate resource_metadata pointer probe here first.
 * Same document as /.well-known/oauth-protected-resource/mcp/<slug> (the
 * location our 401s advertise, matching the historical /mcp convention).
 */
export { GET, OPTIONS } from '../../../mcp/[slug]/route';
