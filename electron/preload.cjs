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
  // The quick menu (electron/quickMenu.js): the main window hears when it opens and what was pressed;
  // the menu hears what's playing and when to slide in or out.
  onQuick: (event, cb) => {
    if (!['quick-active', 'quick-command', 'quick-state', 'quick-open', 'quick-close'].includes(event)) return () => {};
    const listener = (_e, ...args) => cb(...args);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  onMediaControl: (cb) => {
    const listener = (_e, action) => cb(action);
    ipcRenderer.on('media-control', listener);
    return () => ipcRenderer.removeListener('media-control', listener);
  },
});
