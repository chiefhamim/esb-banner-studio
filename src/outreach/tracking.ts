/**
 * Mailtrack-Style Engagement Telemetry & Open/Click Tracking Engine
 * Injects 1x1 transparent tracking pixels and link-click wrappers into outgoing HTML emails.
 */

export function generateTrackingId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'trk_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36)
}

/**
 * Injects a 1x1 transparent tracking pixel before </body> or at the end of the HTML.
 */
export function injectTrackingPixel(html: string, trackingId: string, endpoint: string): string {
  if (!endpoint || !trackingId) return html
  const base = endpoint.replace(/\/+$/, '')
  const pixelUrl = `${base}/open/${trackingId}.gif`
  const pixelTag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;border:0;" />`

  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixelTag}\n</body>`)
  }
  return `${html}\n${pixelTag}`
}

/**
 * Wraps external links for click tracking telemetry.
 */
export function wrapTrackingLinks(html: string, trackingId: string, endpoint: string): string {
  if (!endpoint || !trackingId) return html
  const base = endpoint.replace(/\/+$/, '')

  return html.replace(/href=["'](https?:\/\/[^"']+)["']/gi, (match, url) => {
    // Avoid double wrapping or wrapping unsubscribe links
    if (url.includes('/click/') || url.includes('unsubscribe')) return match
    const wrapped = `${base}/click/${trackingId}?u=${encodeURIComponent(url)}`
    return `href="${wrapped}"`
  })
}

/**
 * Anti-Noise Filter: Identifies and suppresses instant proxy pre-fetches or sender self-opens.
 * If an open occurs within 5 seconds of SMTP transmission, it's flagged as an automated scanner.
 */
export function isScannerPreFetch(sentAtIso: string, openedAtIso: string): boolean {
  try {
    const sent = new Date(sentAtIso).getTime()
    const opened = new Date(openedAtIso).getTime()
    return Math.abs(opened - sent) < 5000 // < 5 seconds
  } catch {
    return false
  }
}
