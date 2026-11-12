const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  installed: () => ipcRenderer.invoke('apps:installed'),
  launch: (id) => ipcRenderer.invoke('app:launch', id),
  external: (url) => ipcRenderer.invoke('open:external', url),
  tabOpen: (id, url) => ipcRenderer.invoke('tab:open', id, url),
  tabShow: (id) => ipcRenderer.invoke('tab:show', id),
  tabHome: () => ipcRenderer.invoke('tab:home'),
  tabClose: (id) => ipcRenderer.invoke('tab:close', id),
  tabReload: () => ipcRenderer.invoke('tab:reload'),
  onTab: (cb) => ipcRenderer.on('tab:event', (_e, d) => cb(d)),
  min: () => ipcRenderer.invoke('win:min'),
  max: () => ipcRenderer.invoke('win:max'),
  close: () => ipcRenderer.invoke('win:close')
});
