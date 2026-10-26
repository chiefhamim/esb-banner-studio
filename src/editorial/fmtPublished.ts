// "Sun, 25 Oct 2026 17:28:49 GMT" (the feed's date) as something a person reads: "2 h ago", "Yesterday, 5:28 PM", "21 Oct".
export function fmtPublished(raw: string | undefined, now = Date.now()): string {
  const t = raw ? Date.parse(raw) : NaN
  if (!Number.isFinite(t)) return 'Published'
  const mins = Math.round((now - t) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const d = new Date(t), today = new Date(now)
  const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (mins < 60 * 12) return `${Math.floor(mins / 60)} h ago`
  const dayDiff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000)
  if (dayDiff === 0) return `Today, ${clock}`
  if (dayDiff === 1) return `Yesterday, ${clock}`
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}
