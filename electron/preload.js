'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Lets the page choose between the built-in local server and a remote Study Desk server.
contextBridge.exposeInMainWorld('desktop', {
  getServer: () => ipcRenderer.invoke('server:get'),
  setServer: url => ipcRenderer.invoke('server:set', url),
});
