'use client'

import { useEffect, useRef } from 'react'
import { usePostHog } from 'posthog-js/react'

/**
 * Descript embed iframe that captures a `video_played` PostHog event the first
 * time the viewer starts playback.
 *
 * Descript embeds implement the player.js (Embedly) protocol and additionally
 * post a bare `descript:embed:played` string on play (verified empirically —
 * see docs/analytics.md). We listen for either, scoped to this iframe via
 * `event.source`, and also register a player.js `play` listener on `ready` as
 * belt-and-braces. Fires once per mount.
 */
export function TrackedVideoEmbed({ src, title }: { src: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const playedRef = useRef(false)
  const posthog = usePostHog()

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return

      let isPlay = event.data === 'descript:embed:played'
      if (!isPlay && typeof event.data === 'string' && event.data.startsWith('{')) {
        try {
          const msg = JSON.parse(event.data) as { context?: string; event?: string }
          if (msg.context !== 'player.js') return
          if (msg.event === 'ready') {
            iframe.contentWindow?.postMessage(
              JSON.stringify({ context: 'player.js', version: '0.0.11', method: 'addEventListener', value: 'play', listener: 'play' }),
              '*',
            )
            return
          }
          isPlay = msg.event === 'play'
        } catch {
          return
        }
      }

      if (isPlay && !playedRef.current) {
        playedRef.current = true
        posthog?.capture('video_played', {
          video_id: new URL(src).pathname.split('/').pop(),
          video_title: title,
          page: window.location.pathname,
        })
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [src, title, posthog])

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      allowFullScreen
      className="absolute inset-0 h-full w-full border-0"
    />
  )
}
