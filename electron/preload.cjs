const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (method, ...args) => ipcRenderer.invoke('api', method, ...args),
  onDownloads: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on('downloads', listener);
    return () => ipcRenderer.removeListener('downloads', listener);
  },
  onUpdateProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('update-progress', listener);
    return () => ipcRenderer.removeListener('update-progress', listener);
  },
  onInvite: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('invite', listener);
    return () => ipcRenderer.removeListener('invite', listener);
  },
  onMediaControl: (cb) => {
    const listener = (_e, action) => cb(action);
    ipcRenderer.on('media-control', listener);
    return () => ipcRenderer.removeListener('media-control', listener);
  },
});
