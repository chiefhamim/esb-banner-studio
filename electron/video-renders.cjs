// The renders this app made (an export that ended well), kept as opaque ids. The renderer names a render only by id; main
// maps it to the file it wrote itself. A path the renderer invents is never published, shown in a folder or deleted.
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX = 200

function createRenderRegistry({ file }) {
  let list = []
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(raw)) list = raw.filter((r) => r && typeof r.id === 'string' && typeof r.path === 'string' && path.isAbsolute(r.path)).slice(0, MAX)
  } catch { /* none yet */ }

  const save = () => {
    try {
      const tmp = file + '.tmp'
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(list))
      fs.renameSync(tmp, file)
    } catch { /* the list is just not remembered */ }
  }

  /** Remember a finished render (called by main only, with the path the export writer ended on). */
  function register(p) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p)) return null
    const known = list.find((r) => r.path === p)
    const st = fs.statSync(p)
    const entry = { id: known?.id ?? crypto.randomBytes(8).toString('hex'), path: p, name: path.basename(p), size: st.size, at: Date.now() }
    list = [entry, ...list.filter((r) => r.path !== p)].slice(0, MAX)
    save()
    return entry.id
  }

  const find = (id) => (typeof id === 'string' ? list.find((r) => r.id === id) : undefined)

  return {
    register,
    /** The file for an id, or null (unknown, or the file is gone). */
    pathOf(id) { const r = find(id); return r && fs.existsSync(r.path) ? r.path : null },
    /** What the renderer may see: id, name, size, time, whether the file is still there. Never the path. */
    list() { return list.map((r) => ({ id: r.id, name: r.name, size: r.size, at: r.at, exists: fs.existsSync(r.path) })) },
    forget(id) { list = list.filter((r) => r.id !== id); save() },
  }
}

module.exports = { createRenderRegistry }
