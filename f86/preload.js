const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('open-file'),
  saveText: (text, defaultName) => ipcRenderer.invoke('save-text', text, defaultName)
});
