const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (method, ...args) => ipcRenderer.invoke('api', method, ...args),
  onDownloads: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on('downloads', listener);
    return () => ipcRenderer.removeListener('downloads', listener);
  },
});
