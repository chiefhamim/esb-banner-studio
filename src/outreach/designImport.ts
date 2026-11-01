// Letter → Designed HTML: read the picked file into the open campaign. One routine for the Letter menu and the letter
// select above the message, so both ask the same question and log the same result. The file picker itself must be
// opened straight from the click (a browser refuses a picker opened later, e.g. after a timeout), so each caller owns
// its own hidden <input type="file"> and hands the chosen file here.

import { importDesign } from './design'
import { OUTREACH_BLUEPRINTS } from './outreachAi'
import { useOutreachStore } from './outreachStore'
import { ask, useOutreachUi } from './outreachUi'

export async function applyDesignFile(file: File | undefined): Promise<void> {
  const s = useOutreachStore.getState()
  const c = s.campaign()
  if (!file || !c) return
  if (file.size > 25 * 1024 * 1024) { s.addLog('error', `${file.name} is over 25 MB`); return }
  try {
    const r = importDesign(file.name, await file.text())
    const b = OUTREACH_BLUEPRINTS.find((x) => x.id === c.blueprint)
    const edited = !!c.body.trim() && (!b || (c.body !== b.defaultBody && c.body !== b.bengaliBody))
    if (!c.design && edited && !(await ask({ title: 'Use the designed letter?', body: 'The page is sent in place of the letter you have written. Its plain-text version replaces the body (shown by mail clients that do not display HTML).', ok: 'Use the design' }))) return
    await s.setDesign(r.design, r.text)
    useOutreachUi.getState().set({ designNotes: r.notes, desk: 'compose', view: 'preview' })
    s.addLog('ok', `Designed letter ${file.name}: ${r.design.images.length} picture${r.design.images.length === 1 ? '' : 's'} carried inside the message`)
  } catch (e) {
    s.addLog('error', (e as Error).message)
  }
}
