const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('esb', {
  saveImage: (name, bytes, dir) => ipcRenderer.invoke('esb:save-image', name, bytes, dir),
  pickFolder: () => ipcRenderer.invoke('esb:pick-folder'),
  reveal: (p) => ipcRenderer.invoke('esb:reveal', p),
  saveProject: (name, text, existing) => ipcRenderer.invoke('esb:save-project', name, text, existing),
  openProject: () => ipcRenderer.invoke('esb:open-project'),
  readProject: (p) => ipcRenderer.invoke('esb:read-project', p),
  fetchUrl: (url, options) => ipcRenderer.invoke('esb:fetch-url', url, options),
  fetchImageData: (url, options) => ipcRenderer.invoke('esb:fetch-image-data', url, options),
  prepareDragFile: (name, bytes) => ipcRenderer.invoke('esb:prepare-drag-file', name, bytes),
  startDrag: (filePath) => ipcRenderer.send('esb:start-drag', filePath),
})
