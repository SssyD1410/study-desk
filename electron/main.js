'use strict';
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../server');

let win = null, local = null, cfgFile = null;
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { return {}; } };
const writeCfg = c => fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2));

async function localUrl() {
  if (!local) local = await startServer({ dataDir: app.getPath('userData'), host: '127.0.0.1', port: 47321, localOnly: true });
  return `http://127.0.0.1:${local.port}/`;
}
async function targetUrl() { const c = readCfg(); return c.serverUrl || localUrl(); }

async function createWindow() {
  win = new BrowserWindow({
    width: 1000, height: 820, minWidth: 380, minHeight: 520,
    title: 'Study Desk', backgroundColor: '#f6f7f5', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'icons', 'android-chrome-512x512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === 'studydesk_timer') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 300, height: 200, alwaysOnTop: true, minimizable: false, maximizable: false, fullscreenable: false, autoHideMenuBar: true, title: 'Study Desk timer', backgroundColor: '#161c19' } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    try { if (new URL(url).origin === new URL(win.webContents.getURL()).origin) return; } catch (x) {}
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  // A remote server that cannot be reached falls back to this computer.
  win.webContents.on('did-fail-load', async (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    const c = readCfg();
    if (!c.serverUrl) return;
    const bad = c.serverUrl; delete c.serverUrl; writeCfg(c);
    win.loadURL(`${await localUrl()}?serverError=${encodeURIComponent(bad)}`);
  });
  win.on('closed', () => { win = null; });
  await win.loadURL(await targetUrl());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.setAppUserModelId('com.studydesk.app');

  ipcMain.handle('server:get', () => readCfg().serverUrl || null);
  ipcMain.handle('server:set', async (e, url) => {
    const c = readCfg();
    if (url) {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error('Use an http:// or https:// address.');
      c.serverUrl = u.origin + '/';
    } else delete c.serverUrl;
    writeCfg(c);
    if (win) await win.loadURL(await targetUrl());
  });

  app.whenReady().then(() => {
    cfgFile = path.join(app.getPath('userData'), 'config.json');
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { if (local) { local.close(); local = null; } });
}
