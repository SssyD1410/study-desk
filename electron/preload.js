'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Desktop-only features for the page: server choice and starting at login.
contextBridge.exposeInMainWorld('desktop', {
  getServer: () => ipcRenderer.invoke('server:get'),
  setServer: url => ipcRenderer.invoke('server:set', url),
  getLogin: () => ipcRenderer.invoke('login:get'),
  setLogin: on => ipcRenderer.invoke('login:set', on),
});
