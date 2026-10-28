// ESB Studio — File System Path Scoping & Allow-listing (S2)
const path = require('node:path')

class FsScope {
  constructor() {
    this.allowedRoots = new Set()
    this.allowedFiles = new Set()
  }

  normalize(p) {
    if (!p) return ''
    // Accept Windows-style backslash paths even when running on a POSIX host
    // (e.g. Linux CI/cloud sessions testing this Windows-packaged app).
    const slashed = String(p).replace(/\\/g, '/')
    return path.resolve(path.normalize(slashed)).toLowerCase()
  }

  /**
   * Allow-list a directory or file.
   */
  allow(p) {
    if (!p) return
    const norm = this.normalize(p)
    this.allowedRoots.add(norm)
  }

  /**
   * Allow-list a specific file.
   */
  allowFile(p) {
    if (!p) return
    const norm = this.normalize(p)
    // the exact file only. This used to allow its whole folder as well, so saving one banner to the Desktop or the
    // home folder opened every subfolder of it to save-image, save-project, read-project and start-drag.
    this.allowedFiles.add(norm)
  }

  /**
   * Check if a path is permitted for read or write operations.
   */
  isAllowed(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return false
    const norm = this.normalize(targetPath)

    if (this.allowedFiles.has(norm)) return true

    for (const root of this.allowedRoots) {
      if (norm === root) return true
      if (norm.startsWith(root + path.sep)) return true
    }
    return false
  }

  /**
   * Assert that a target path is allowed, throwing an error if forged or disallowed.
   */
  assertAllowed(targetPath, operation = 'access') {
    if (!this.isAllowed(targetPath)) {
      const err = new Error(`FS Scope: ${operation} denied for unapproved path: ${targetPath}`)
      err.code = 'EACCES'
      throw err
    }
  }
}

module.exports = {
  FsScope,
}
