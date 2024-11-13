// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  startProcess: (options) => ipcRenderer.send('start-process', options),
  on: (channel, func) => {
    const validChannels = ['ffmpeg-progress', 'ffmpeg-complete', 'ffmpeg-error'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, data) => func(data));
    }
  }
});
