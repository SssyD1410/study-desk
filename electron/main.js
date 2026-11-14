'use strict';
const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../server');

let win = null, splash = null, local = null, cfgFile = null;
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { return {}; } };
const writeCfg = c => fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2));

async function localUrl() {
  if (!local) local = await startServer({ dataDir: app.getPath('userData'), host: '127.0.0.1', port: 47321, localOnly: true });
  return `http://127.0.0.1:${local.port}/`;
}
async function targetUrl() { const c = readCfg(); return c.serverUrl || localUrl(); }

// Opening at login only applies to the installed app (a dev build would register the Electron binary).
const loginSupported = () => app.isPackaged && !testRun && (process.platform === 'win32' || process.platform === 'darwin');
function loginState() { return { supported: loginSupported(), on: loginSupported() ? app.getLoginItemSettings().openAtLogin : !!readCfg().openAtLogin }; }
function setLogin(on) {
  const c = readCfg(); c.openAtLogin = !!on; writeCfg(c);
  if (loginSupported()) app.setLoginItemSettings({ openAtLogin: !!on });
  return loginState();
}

function showSplash() {
  splash = new BrowserWindow({
    width: 340, height: 300, frame: false, resizable: false, movable: true, show: false, center: true,
    transparent: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#f6f7f5',
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash && splash.show());
  splash.on('closed', () => { splash = null; });
}

// Size and place the pop-out timer for the chosen style.
function timerWindow(mode) {
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const base = { alwaysOnTop: true, minimizable: false, maximizable: false, fullscreenable: false, autoHideMenuBar: true, title: 'Study Desk timer', backgroundColor: '#161c19' };
  if (mode === 'top' || mode === 'bottom') {
    return { ...base, frame: false, resizable: false, skipTaskbar: true, width: wa.width, height: 52, x: wa.x, y: mode === 'top' ? wa.y : wa.y + wa.height - 52 };
  }
  if (mode === 'corner') {
    return { ...base, frame: false, resizable: false, skipTaskbar: true, width: 250, height: 116, x: wa.x + wa.width - 266, y: wa.y + wa.height - 132 };
  }
  return { ...base, width: 300, height: 200, x: wa.x + wa.width - 324, y: wa.y + 24 };
}

async function createWindow() {
  const started = Date.now();
  win = new BrowserWindow({
    width: 1040, height: 840, minWidth: 380, minHeight: 520, show: false,
    title: 'Study Desk', backgroundColor: '#f6f7f5', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'icons', 'android-chrome-512x512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName.startsWith('studydesk_timer')) {
      return { action: 'allow', overrideBrowserWindowOptions: timerWindow(frameName.slice('studydesk_timer_'.length)) };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', child => {
    child.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') child.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
  // Swap the splash for the app once it has drawn (the splash stays up at least a moment).
  win.once('ready-to-show', () => {
    setTimeout(() => {
      if (!win) return;
      win.show(); win.focus();
      if (splash) splash.close();
    }, Math.max(0, 900 - (Date.now() - started)));
  });
  win.on('closed', () => { win = null; });
  setTimeout(() => { if (win && !win.isVisible()) win.show(); if (splash) splash.close(); }, 10000);
  await win.loadURL(await targetUrl());
}

// For development and testing: keep data (and the open-at-login choice) in a separate folder.
if (process.env.STUDYDESK_USER_DATA) app.setPath('userData', process.env.STUDYDESK_USER_DATA);
const testRun = !!process.env.STUDYDESK_USER_DATA;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
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
  ipcMain.handle('login:get', () => loginState());
  ipcMain.handle('login:set', (e, on) => setLogin(on));

  app.whenReady().then(() => {
    cfgFile = path.join(app.getPath('userData'), 'config.json');
    // First launch: open at login by default (can be turned off in Settings).
    if (readCfg().openAtLogin === undefined) setLogin(true);
    showSplash();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { if (local) { local.close(); local = null; } });
}
