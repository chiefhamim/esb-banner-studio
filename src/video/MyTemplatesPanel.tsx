// "My templates": keep the structure of the video that is open (no media, no words, no figures) and start new videos from it.
import { useState } from 'react'
import { useVideoStore } from './videoStore'
import { deleteUserTemplate, loadUserTemplates, projectFromTemplate, saveUserTemplate, templateFrom, type UserTemplate } from './userTemplates'

export function MyTemplatesPanel() {
  const project = useVideoStore((s) => s.project)
  const loadProject = useVideoStore((s) => s.loadProject)
  const [list, setList] = useState<UserTemplate[]>(() => loadUserTemplates())
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)

  const hasContent = project.clips.length > 0

  const save = () => {
    setError(''); setNotice('')
    const r = saveUserTemplate(templateFrom(project, name || project.name))
    if (!r.ok) { setError(r.why ?? 'Could not save the template.'); return }
    setList(loadUserTemplates()); setName('')
    setNotice('Saved. Its media, words, figures and markers were left out; the layout, timing, looks and sound levels were kept.')
  }

  const use = (t: UserTemplate) => {
    loadProject(projectFromTemplate(t), { path: null, dirty: true })
    setConfirm(null)
    setNotice(`Started “${t.name}”. Drop footage into its slots and type its captions and titles; the export stays blocked until they are filled.`)
  }

  const remove = (id: string) => { deleteUserTemplate(id); setList(loadUserTemplates()) }

  return (
    <section className="vw-sec" aria-label="My templates">
      <div className="vw-sec-head"><h4 className="vw-sec-title">My templates</h4></div>
      <div className="vw-save-row">
        <input type="text" value={name} maxLength={60} placeholder="Template name" aria-label="Template name" onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn xs" onClick={save} disabled={!hasContent}>Save as template</button>
      </div>
      {!hasContent && <p className="vw-hint">Build or open a video first; its layout becomes the template.</p>}
      {error && <p className="vw-hint vw-error" role="alert">{error}</p>}
      {notice && <p className="vw-hint" role="status">{notice}</p>}
      {list.length === 0 ? <p className="vw-hint">No templates of your own yet.</p> : (
        <ul className="vw-cut-list vw-short-list">
          {list.map((t) => (
            <li key={t.id}>
              <div className="vw-tpl-row">
                <b>{t.name}</b>
                <span className="vw-hint">{t.shell.aspect} · {Math.round(t.shell.duration)} s · {t.shell.clips.length} clips</span>
              </div>
              {confirm === t.id ? (
                <div className="vw-transcript-actions">
                  <span className="vw-hint">This replaces the open video.</span>
                  <button type="button" className="btn xs" onClick={() => setConfirm(null)}>Keep it</button>
                  <button type="button" className="btn xs primary" onClick={() => use(t)}>Replace</button>
                </div>
              ) : (
                <div className="vw-transcript-actions">
                  <button type="button" className="btn xs" onClick={() => (hasContent ? setConfirm(t.id) : use(t))}>Use</button>
                  <button type="button" className="btn xs" onClick={() => remove(t.id)}>Delete</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
