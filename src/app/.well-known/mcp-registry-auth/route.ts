/**
 * MCP Registry domain-ownership proof (HTTP authentication method).
 *
 * The official MCP Registry (registry.modelcontextprotocol.io) grants the
 * `ai.fgac/*` namespace to whoever can prove control of fgac.ai. The HTTP
 * method fetches https://fgac.ai/.well-known/mcp-registry-auth and expects a
 * plain-text record carrying an Ed25519 PUBLIC key; `mcp-publisher login http`
 * then signs a challenge with the matching private key.
 *
 * The record is public by design — it is the verifier, not the secret. The
 * private half lives ONLY in .secrets/mcp-registry-key.pem (gitignored) and in
 * the MCP_PUBLISHER_PRIVATE_KEY GitHub Actions secret. Re-keying means
 * regenerating the pair and replacing the string below.
 *
 * Docs: https://modelcontextprotocol.io/registry/authentication#http-authentication
 * Publishing runbook: docs/growth-channels.md
 */

export const MCP_REGISTRY_AUTH_RECORD =
  'v=MCPv1; k=ed25519; p=iSgYYybTRDjQvONNBksSXZa0yn1Moi6tnH5gAL/zvME=';

export function GET() {
  return new Response(`${MCP_REGISTRY_AUTH_RECORD}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
