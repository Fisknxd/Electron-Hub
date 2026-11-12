const { app, BrowserWindow, WebContentsView, ipcMain, shell, session } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

const PART = 'persist:proton';
const TOP = 52; // header height while an app is open
const HOSTS = {
  'mail.proton.me': 'mail', 'calendar.proton.me': 'calendar', 'pass.proton.me': 'pass',
  'drive.proton.me': 'drive', 'docs.proton.me': 'docs', 'meet.proton.me': 'meet',
  'lumo.proton.me': 'lumo', 'wallet.proton.me': 'wallet'
};
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const isProton = (h) => /(^|\.)(proton\.me|protonmail\.com|protonvpn\.com)$/.test(h);

let main;
const views = new Map();
let current = null;

const send = (d) => { if (main && !main.isDestroyed()) main.webContents.send('tab:event', d); };

function applyBounds() {
  if (!main || main.isDestroyed()) return;
  const [w, h] = main.getContentSize();
  for (const v of views.values()) v.setBounds({ x: 0, y: TOP, width: w, height: Math.max(0, h - TOP) });
}
function show(id) {
  const t = views.get(id);
  if (!t) return;
  for (const v of views.values()) v.setVisible(v === t);
  current = id;
  applyBounds();
  t.webContents.focus();
  send({ type: 'active', id });
}
function home() {
  for (const v of views.values()) v.setVisible(false);
  current = null;
  send({ type: 'active', id: null });
  if (main) main.webContents.focus();
}
function closeTab(id) {
  const v = views.get(id);
  if (!v) return;
  main.contentView.removeChildView(v);
  v.webContents.close();
  views.delete(id);
  send({ type: 'closed', id });
  if (current === id) {
    const rest = [...views.keys()];
    rest.length ? show(rest[rest.length - 1]) : home();
  }
}
function route(fromId, url) {
  const h = hostOf(url);
  if (!isProton(h)) { shell.openExternal(url); return; }
  const target = HOSTS[h];
  if (target && target !== fromId) openTab(target, url, true);
  else views.get(fromId)?.webContents.loadURL(url);
}
function openTab(id, url, routed = false) {
  let v = views.get(id);
  if (!v) {
    v = new WebContentsView({ webPreferences: { partition: PART, contextIsolation: true, sandbox: true } });
    const wc = v.webContents;
    wc.setWindowOpenHandler(({ url: u }) => { route(id, u); return { action: 'deny' }; });
    wc.on('will-navigate', (e, u) => {
      const h = hostOf(u);
      if (!isProton(h)) { e.preventDefault(); shell.openExternal(u); return; }
      const t = HOSTS[h];
      if (t && t !== id) { e.preventDefault(); openTab(t, u, true); }
    });
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
      if (!isMain || code === -3 || failedUrl.startsWith('data:')) return;
      const safe = failedUrl.replace(/[<>"']/g, '');
      const page = '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0a1a;color:#fff;font-family:Segoe UI,sans-serif;text-align:center">' +
        '<div><h2 style="margin:0 0 10px">This page did not load</h2><p style="color:#a99fd6;margin:0 0 22px">' + desc + '</p>' +
        '<a href="' + safe + '" style="background:#7a5cff;color:#fff;padding:11px 22px;border-radius:10px;text-decoration:none">Try again</a></div></body>';
      wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    });
    wc.on('did-start-loading', () => send({ type: 'loading', id, on: true }));
    wc.on('did-stop-loading', () => send({ type: 'loading', id, on: false }));
    wc.on('before-input-event', (e, i) => {
      if (i.type !== 'keyDown') return;
      if (i.control && i.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(id); }
      else if (i.alt && i.key === 'Home') { e.preventDefault(); home(); }
    });
    views.set(id, v);
    main.contentView.addChildView(v);
    wc.loadURL(url);
    send({ type: 'opened', id });
  } else if (routed) {
    v.webContents.loadURL(url);
  }
  show(id);
}
function createWindow() {
  main = new BrowserWindow({
    width: 1206, height: 772, minWidth: 900, minHeight: 640,
    title: 'Proton Hub', frame: false, backgroundColor: '#0d0a1a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  main.setMenu(null);
  main.loadFile(path.join(__dirname, 'index.html'));
  ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((ev) => main.on(ev, applyBounds));
}

function setupSession() {
  const ses = session.fromPartition(PART);
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|proton-hub|Proton Hub)\/\S+/gi, ''));
  const ok = ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'];
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(isProton(hostOf(details.requestingUrl || wc.getURL())) && ok.includes(perm)));
  ses.setPermissionCheckHandler((wc, perm, origin) => isProton(hostOf(origin || '')) && ok.includes(perm));
}

function startApps() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'],
      { windowsHide: true, maxBuffer: 1024 * 1024 * 8 }, (err, out) => {
        if (err || !out) return resolve([]);
        try { const j = JSON.parse(out); resolve(Array.isArray(j) ? j : [j]); }
        catch { resolve([]); }
      });
  });
}

ipcMain.handle('apps:installed', () => startApps());
ipcMain.handle('app:launch', (_e, appId) => { execFile('explorer.exe', ['shell:AppsFolder\\' + appId], { windowsHide: true }, () => {}); return true; });
ipcMain.handle('open:external', (_e, url) => shell.openExternal(url));
ipcMain.handle('tab:open', (_e, id, url) => openTab(id, url));
ipcMain.handle('tab:show', (_e, id) => show(id));
ipcMain.handle('tab:home', () => home());
ipcMain.handle('tab:close', (_e, id) => closeTab(id));
ipcMain.handle('tab:reload', () => { const v = views.get(current); if (v) v.webContents.reload(); });
ipcMain.handle('win:min', () => main && main.minimize());
ipcMain.handle('win:max', () => { if (!main) return; main.isMaximized() ? main.unmaximize() : main.maximize(); });
ipcMain.handle('win:close', () => main && main.close());

app.whenReady().then(() => { setupSession(); createWindow(); });
app.on('window-all-closed', () => app.quit());
