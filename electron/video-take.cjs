// ESB Studio — a voiceover take that is written while it is being recorded (Phase 4 fix round). The renderer sends the
// recorder's pieces (MediaRecorder timeslice, every second or two) and main appends them to a ".part" file in the takes
// folder, so a crash or a power cut keeps what was recorded. When the take ends, main reads the file back and stores it
// through the same validated path as a whole take (video-media.cjs audioTakeKind + storeGenerated); a part file left over
// from a crash is recovered the same way at the next start. The renderer never names a path: it holds an opaque id.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MAX_CHUNK = 16 * 1024 * 1024
const PART = /^\.rec-([0-9a-f]{16})\.part$/

function createTakeRecorder({ dir, audioTakeKind, maxBytes }) {
  let cur = null // { id, file, bytes }
  const fileOf = (id) => path.join(dir, `.rec-${id}.part`)
  const drop = (file) => { try { fs.unlinkSync(file) } catch { /* gone */ } }
  return {
    /** Start a recording; an unfinished earlier one is left on disk for recovery. */
    begin() {
      fs.mkdirSync(dir, { recursive: true })
      const id = crypto.randomBytes(8).toString('hex')
      cur = { id, file: fileOf(id), bytes: 0 }
      fs.writeFileSync(cur.file, Buffer.alloc(0))
      return id
    },
    /** Append one piece. The first piece must be a recognisable audio file header. */
    append(id, bytes) {
      if (!cur || cur.id !== id) throw new Error('No such recording')
      if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_CHUNK) throw new Error('Bad recording piece')
      if (cur.bytes + bytes.length > maxBytes) throw new Error('The recording is too big')
      if (cur.bytes === 0 && !audioTakeKind(bytes)) throw new Error('Not a WebM, Ogg, WAV or M4A recording')
      fs.appendFileSync(cur.file, bytes)
      cur.bytes += bytes.length
      return cur.bytes
    },
    /** The finished recording's bytes and kind; the part file is removed. Null when nothing was written. */
    finish(id) {
      if (!cur || cur.id !== id) throw new Error('No such recording')
      const { file, bytes } = cur
      cur = null
      if (!bytes) { drop(file); return null }
      const data = new Uint8Array(fs.readFileSync(file))
      drop(file)
      const kind = audioTakeKind(data)
      return kind ? { data, kind } : null
    },
    discard(id) {
      if (cur && cur.id === id) { drop(cur.file); cur = null }
    },
    /** Part files from a crashed session (never the current one): their bytes and kind, each removed as it is read. */
    recover() {
      const out = []
      let names = []
      try { names = fs.readdirSync(dir) } catch { return out }
      for (const n of names) {
        const m = PART.exec(n)
        if (!m || (cur && cur.id === m[1])) continue
        const file = path.join(dir, n)
        try {
          const st = fs.statSync(file)
          if (st.isFile() && st.size > 0 && st.size <= maxBytes) {
            const data = new Uint8Array(fs.readFileSync(file))
            const kind = audioTakeKind(data)
            if (kind) out.push({ data, kind, mtimeMs: st.mtimeMs })
          }
        } catch { /* unreadable */ }
        drop(file)
      }
      return out
    },
  }
}

module.exports = { createTakeRecorder, MAX_CHUNK }
