'use client'

import posthog from 'posthog-js'

export const CLAUDE_DIRECTORY_URL = 'https://claude.ai/directory/fgac-ai'

/**
 * Outbound link to the Claude connectors directory listing with funnel
 * instrumentation: clicking captures `directory_link_clicked`. Downstream
 * conversion shows up as `mcp_connection_created` — the directory's Connect
 * flow runs our normal OAuth, so the gap between the two is the drop-off
 * inside claude.ai (not individually observable).
 */
export function DirectoryCta({
  location,
  className,
  children,
}: {
  location: 'announcement_bar' | 'setup_step1' | 'docs_support' | 'dashboard_connect'
  className: string
  children: React.ReactNode
}) {
  return (
    <a
      href={CLAUDE_DIRECTORY_URL}
      target="_blank"
      rel="noopener"
      className={className}
      onClick={() => posthog.capture('directory_link_clicked', { cta_location: location })}
    >
      {children}
    </a>
  )
}
