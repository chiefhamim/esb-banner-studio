const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('esb', {
  readClipboard: () => ipcRenderer.invoke('esb:read-clipboard'),
  saveImage: (name, bytes, dir) => ipcRenderer.invoke('esb:save-image', name, bytes, dir),
  saveVideo: (name, bytes) => ipcRenderer.invoke('esb:save-video', name, bytes),
  pickFolder: () => ipcRenderer.invoke('esb:pick-folder'),
  reveal: (p) => ipcRenderer.invoke('esb:reveal', p),
  saveProject: (name, text, existing) => ipcRenderer.invoke('esb:save-project', name, text, existing),
  openProject: () => ipcRenderer.invoke('esb:open-project'),
  readProject: (p) => ipcRenderer.invoke('esb:read-project', p),
  fetchUrl: (url, options) => ipcRenderer.invoke('esb:fetch-url', url, options),
  fetchImageData: (url, options) => ipcRenderer.invoke('esb:fetch-image-data', url, options),
  prepareDragFile: (name, bytes) => ipcRenderer.invoke('esb:prepare-drag-file', name, bytes),
  openSiteAs: (cookies, sitePath) => ipcRenderer.invoke('esb:open-site-as', cookies, sitePath),
  siteSignOut: () => ipcRenderer.invoke('esb:site-sign-out'),
  quit: (force) => ipcRenderer.invoke('esb:quit', force),
  siteUpload: (cookies, bytes, mime, name) => ipcRenderer.invoke('esb:site-upload', cookies, bytes, mime, name),
  siteUploadProbe: (cookies) => ipcRenderer.invoke('esb:site-upload-probe', cookies),
  siteRevalidate: (cookies, slugs) => ipcRenderer.invoke('esb:site-revalidate', cookies, slugs),
  startDrag: (filePath) => ipcRenderer.send('esb:start-drag', filePath),
  outreachStatus: () => ipcRenderer.invoke('esb:outreach-status'),
  outreachSave: (settings, password) => ipcRenderer.invoke('esb:outreach-save', settings, password),
  outreachForgetPassword: () => ipcRenderer.invoke('esb:outreach-forget-password'),
  outreachSend: (mail) => ipcRenderer.invoke('esb:outreach-send', mail),
  outreachVerify: (force) => ipcRenderer.invoke('esb:outreach-verify', force),
  outreachInbox: (force) => ipcRenderer.invoke('esb:outreach-inbox', force),
  outreachJobSubmit: (spec) => ipcRenderer.invoke('esb:outreach-job-submit', spec),
  outreachJobControl: (jobId, action, arg) => ipcRenderer.invoke('esb:outreach-job-control', jobId, action, arg),
  outreachPauseAll: (on) => ipcRenderer.invoke('esb:outreach-pause-all', on),
  outreachJobs: () => ipcRenderer.invoke('esb:outreach-jobs'),
  outreachEvents: (q) => ipcRenderer.invoke('esb:outreach-events', q),
  outreachStats: (q) => ipcRenderer.invoke('esb:outreach-stats', q),
  outreachPlan: (q) => ipcRenderer.invoke('esb:outreach-plan', q),
  outreachSettings: () => ipcRenderer.invoke('esb:outreach-settings'),
  outreachSettingsSave: (s) => ipcRenderer.invoke('esb:outreach-settings-save', s),
  outreachCheckAddresses: (domains) => ipcRenderer.invoke('esb:outreach-check-addresses', domains),
  outreachLogEvent: (e) => ipcRenderer.invoke('esb:outreach-log-event', e),
  outreachOptOut: (email, on) => ipcRenderer.invoke('esb:outreach-opt-out', email, on),
  outreachSyncOptOuts: (emails) => ipcRenderer.invoke('esb:outreach-sync-opt-outs', emails),
  outreachReplyTexts: (emails) => ipcRenderer.invoke('esb:outreach-reply-texts', emails),
  outreachDistributeResult: (r) => ipcRenderer.invoke('esb:outreach-distribute-result', r),
  onOutreach: (cb) => {
    const listener = (_e, msg) => {
      if (typeof cb === 'function') cb(msg)
    }
    ipcRenderer.on('esb:outreach-push', listener)
    return () => ipcRenderer.removeListener('esb:outreach-push', listener)
  },
})
