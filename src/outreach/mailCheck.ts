// ESB Studio — what the Mail pill and the Sender card say about the last SMTP check (esb:outreach-verify).
//
// Main classifies why a check failed (electron/outreach-errors.cjs classifyVerifyError). Only a refused login means
// the app password is wrong; a PC that briefly cannot reach smtp.gmail.com is a network blip, retried on its own, and
// must never read "Login failed" — that wording once made the editor think his password was broken.

/** Why the last mail check failed: the server refused the account, the server could not be reached, the secure
 *  connection failed, or something else. */
export type MailFailKind = 'auth' | 'network' | 'tls' | 'other'

export const mailFailKind = (k: unknown): MailFailKind => (k === 'auth' || k === 'network' || k === 'tls' ? k : 'other')

/** While the mail server is unreachable the check is tried again after 30 s, then 2 min, then every 5 min. */
export const MAIL_RETRY_STEPS = [30_000, 120_000, 300_000] as const
export const mailRetryDelay = (step: number) => MAIL_RETRY_STEPS[Math.min(Math.max(0, step), MAIL_RETRY_STEPS.length - 1)]

export type MailTone = 'on' | 'warn' | 'off'

/** The words for a failed check: the status-bar pill, the Sender card chip, the tooltip, and whether the fix is in the
 *  Sender dialog. `error` is the server's own text (main strips anything that looks like a secret). */
export function mailFailView(kind: MailFailKind, error: string, opts: { host?: string; retryAtText?: string } = {}): {
  text: string; chip: string; tone: MailTone; tip: string; fixInSender: boolean
} {
  const said = error ? `${error} — ` : ''
  switch (kind) {
    case 'auth':
      return { text: 'Wrong app password', chip: 'Wrong app password', tone: 'off', fixInSender: true,
        tip: `${said}the mail server refused the account or app password. Change it in Sender` }
    case 'network':
      return { text: 'Mail server unreachable — retrying', chip: 'Server unreachable — retrying', tone: 'warn', fixInSender: false,
        tip: `${said}this PC could not reach ${opts.host || 'the mail server'} (network). The password is not the problem. ${opts.retryAtText ? `Trying again at ${opts.retryAtText}` : 'Trying again shortly'} — click to try now` }
    case 'tls':
      return { text: 'Secure connection failed', chip: 'Secure connection failed', tone: 'off', fixInSender: false,
        tip: `${said}the secure (TLS) connection to ${opts.host || 'the mail server'} could not be set up. Check the port and security in Sender — click to try again` }
    default:
      return { text: 'Mail check failed', chip: 'Mail check failed', tone: 'off', fixInSender: false,
        tip: `${said}click to try again` }
  }
}
