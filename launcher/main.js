const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const installer = require('./src/installer');
const mods = require('./src/mods');
const auth = require('./src/auth');
const game = require('./src/game');

// Quasar's own Azure app (Application (client) ID). It identifies the launcher to Microsoft;
// it is not a secret. Mojang must approve it before Minecraft sign-in works.
const CLIENT_ID = 'a769b566-3902-4127-8eda-08a0c96c99b4';

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = () => ({
  minecraftDir: installer.defaultMinecraftDir(),
  modJar: '',
  ramGb: 4,
  closeOnLaunch: false,
  cfKeyEnc: '',
  accountEnc: '',
  accountName: '',
});

// Secrets (the CurseForge key, the Microsoft sign-in) are written to disk only encrypted with the
// OS keychain. Without a keychain they are kept in memory for this session only. They never reach the page.
const memorySecrets = { cfKey: '', account: null };
const canEncrypt = () => safeStorage.isEncryptionAvailable();
function encrypt(text) {
  return safeStorage.encryptString(text).toString('base64');
}
function decrypt(b64) {
  return safeStorage.decryptString(Buffer.from(b64, 'base64'));
}
function getCfKey() {
  if (!canEncrypt()) return memorySecrets.cfKey;
  if (!settings.cfKeyEnc) return '';
  try { return decrypt(settings.cfKeyEnc); } catch { return ''; }
}
function setCfKey(key) {
  const k = (key || '').trim();
  if (!canEncrypt()) { memorySecrets.cfKey = k; settings.cfKeyEnc = ''; return; }
  settings.cfKeyEnc = k ? encrypt(k) : '';
}
function publicSettings() {
  const { cfKeyEnc, accountEnc, ...rest } = settings;
  const account = readAccount();
  return {
    ...rest,
    accountName: account ? settings.accountName : '',
    hasCfKey: Boolean(getCfKey()),
    signedIn: Boolean(account),
    secretsPersist: canEncrypt(),
  };
}

function readAccount() {
  if (!canEncrypt()) return memorySecrets.account;
  if (!settings.accountEnc) return null;
  try { return JSON.parse(decrypt(settings.accountEnc)); } catch { return null; }
}
function writeAccount(account) {
  if (canEncrypt()) {
    settings.accountEnc = account ? encrypt(JSON.stringify(account)) : '';
  } else {
    memorySecrets.account = account;
    settings.accountEnc = '';
  }
  settings.accountName = account?.session?.name || '';
  saveSettings();
}
const ALLOWED_LINK_HOSTS = ['modrinth.com', 'www.curseforge.com', 'curseforge.com', 'console.curseforge.com', 'docs.curseforge.com',
  'www.microsoft.com', 'microsoft.com', 'login.microsoft.com', 'portal.azure.com', 'help.minecraft.net'];
// aka.ms is a redirect service, so only this one known link to Mojang's access form is allowed.
const ALLOWED_EXACT_URLS = ['https://aka.ms/mce-reviewappid'];
const README = path.resolve(__dirname, '..', 'README.md');
let gameProcess = null;

let win;
let settings;
let busy = false;

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS(), ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) };
  } catch {
    return DEFAULT_SETTINGS();
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
}

function log(line) {
  const stamp = new Date().toTimeString().slice(0, 8);
  win?.webContents.send('log', `[${stamp}] ${line}`);
}

function progress(value, status) {
  win?.webContents.send('progress', value, status);
}

/**
 * Shows Microsoft's own login page in a separate window and waits until Microsoft sends it back
 * to the return address with a code. The window has no access to the launcher, and its cookies
 * are thrown away when it closes.
 */
function openLoginWindow(request) {
  return new Promise((resolve, reject) => {
    const login = new BrowserWindow({
      parent: win,
      modal: process.platform !== 'darwin',
      width: 480,
      height: 680,
      title: 'Sign in with Microsoft',
      autoHideMenuBar: true,
      webPreferences: { partition: `msauth-${Date.now()}`, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    let finished = false;
    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      fn(value);
      if (!login.isDestroyed()) login.close();
    };
    const check = (event, url) => {
      let code;
      try {
        code = auth.parseRedirect(url, request.state);
      } catch (err) {
        event?.preventDefault?.();
        return finish(reject, err);
      }
      if (code) {
        event?.preventDefault?.();
        finish(resolve, code);
      }
    };
    login.webContents.on('will-redirect', check);
    login.webContents.on('will-navigate', check);
    login.webContents.on('did-navigate', (_e, url) => check(null, url));
    login.webContents.setWindowOpenHandler(({ url }) => {
      // Help and privacy links from Microsoft's page open in the normal browser.
      try { if (new URL(url).protocol === 'https:') shell.openExternal(url); } catch { /* ignore */ }
      return { action: 'deny' };
    });
    login.on('closed', () => finish(reject, new auth.AuthError('Sign-in window closed.', 'CANCELLED')));
    login.loadURL(request.url);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#07060f',
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // The page never navigates or opens windows; links go through the link:open allowlist.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  settings = loadSettings();
  // Without a keychain, never keep secrets on disk (an earlier build may have written them unencrypted).
  if (!canEncrypt() && (settings.cfKeyEnc || settings.accountEnc)) {
    settings.cfKeyEnc = '';
    settings.accountEnc = '';
    settings.accountName = '';
    saveSettings();
  }

  ipcMain.handle('info:get', async () => ({
    mcVersion: installer.MC_VERSION,
    loaderVersion: installer.LOADER_VERSION,
    appVersion: app.getVersion(),
    modJar: await installer.findModJar(settings),
    canBuild: await installer.canBuildFromSource(),
    hasReadme: fs.existsSync(README),
    gameDir: installer.gameDir(settings),
  }));

  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const { cfKey, cfKeyEnc, hasCfKey, accountEnc, accountName, signedIn, secretsPersist, azureClientId, ...rest } = patch;
    settings = { ...settings, ...rest };
    if (cfKey !== undefined) setCfKey(cfKey);
    saveSettings();
    return publicSettings();
  });

  ipcMain.handle('mods:categories', (_e, source) => mods.categories(source, getCfKey()));
  ipcMain.handle('mods:search', async (_e, opts) => {
    try {
      return { ok: true, ...(await mods.search({ ...opts, cfKey: getCfKey() })) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null };
    }
  });
  ipcMain.handle('mods:installed', () => mods.listInstalled(installer.gameDir(settings)));
  ipcMain.handle('mods:install', async (_e, source, id) => {
    try {
      const titles = await mods.install({ source, id, gameDir: installer.gameDir(settings), cfKey: getCfKey(), log });
      if (titles.length) log(`Installed ${titles.join(', ')}`);
      return { ok: true, installed: titles };
    } catch (err) {
      log('ERROR: ' + err.message);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('mods:remove', async (_e, file) => {
    try {
      await mods.removeMod(installer.gameDir(settings), file);
      log(`Removed ${file}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('account:signIn', async () => {
    try {
      const clientId = CLIENT_ID;
      const request = auth.createLoginRequest(clientId);
      const code = await openLoginWindow(request);
      const ms = await auth.redeemCode(clientId, code, request.verifier);
      const session = await auth.minecraftFromMicrosoft(ms.msAccess);
      writeAccount({ refreshToken: ms.refreshToken, session: { ...session, clientId } });
      log(`Signed in as ${session.name}`);
      return { ok: true, name: session.name };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null };
    }
  });
  ipcMain.handle('readme:open', async () => {
    if (fs.existsSync(README)) await shell.openPath(README);
  });
  ipcMain.handle('account:signOut', () => {
    writeAccount(null);
    return publicSettings();
  });

  ipcMain.handle('link:open', (_e, url) => {
    try {
      const u = new URL(url);
      const ok = (u.protocol === 'https:' && ALLOWED_LINK_HOSTS.includes(u.hostname)) || ALLOWED_EXACT_URLS.includes(u.toString());
      if (ok) shell.openExternal(u.toString());
    } catch { /* ignore bad links */ }
  });

  ipcMain.handle('modules:get', () => installer.readModules(settings));
  ipcMain.handle('modules:set', async (_e, states) => {
    await installer.writeModules(settings, states);
    return true;
  });

  ipcMain.handle('game:play', async () => {
    if (busy) return { ok: false, error: 'Already working…' };
    if (gameProcess) return { ok: false, error: 'Minecraft is already running.' };
    busy = true;
    try {
      const states = Object.fromEntries((await installer.readModules(settings)).map((m) => [m.name, m.enabled]));
      log(`Preparing Quasar Client for Minecraft ${installer.MC_VERSION}`);
      const account = readAccount();
      let fallbackReason = null;
      if (!account && settings.accountEnc) {
        fallbackReason = 'Your saved sign-in could not be read. Sign in again in Settings.';
        writeAccount(null);
      }

      // Not signed in: the official Minecraft Launcher does the launching.
      if (!account) {
        const result = await installer.play(settings, states, log, progress);
        if (settings.closeOnLaunch && result.opened) setTimeout(() => app.quit(), 1500);
        return { ok: true, mode: 'launcher', fallbackReason, ...result };
      }

      await installer.prepare(settings, states, log, progress, 0.3);
      progress(0.31, 'Signing in');
      let session;
      try {
        const res = await auth.getSession(CLIENT_ID, account);
        session = { ...res.session, clientId: CLIENT_ID };
        writeAccount({ refreshToken: res.refreshToken, session });
      } catch (err) {
        log(`Could not sign in: ${err.message} Opening the Minecraft Launcher instead.`);
        if (err.code === 'REFRESH_FAILED') writeAccount(null);
        const result = await installer.finishWithLauncher(settings, log, progress);
        return { ok: true, mode: 'launcher', fallbackReason: err.message, ...result };
      }

      const phases = { files: [0.33, 0.55, 'Downloading game files'], assets: [0.55, 0.85, 'Downloading sounds and textures'], java: [0.85, 0.97, 'Downloading Java'] };
      const inst = await game.install({
        mcDir: settings.minecraftDir,
        runtimeDir: path.join(app.getPath('userData'), 'runtime'),
        mcVersion: installer.MC_VERSION,
        fabricId: installer.VERSION_ID,
        log,
        progress: (phase, p) => {
          const [from, to, label] = phases[phase];
          progress(from + (to - from) * p, `${label} (${Math.round(p * 100)}%)`);
        },
      });

      progress(0.98, 'Starting Minecraft');
      const detach = settings.closeOnLaunch;
      const child = await game.launch({
        install: inst, mcDir: settings.minecraftDir, gameDir: installer.gameDir(settings),
        session, ramGb: settings.ramGb, versionId: installer.VERSION_ID, detach, log,
      });
      if (detach) {
        gameProcess = child; // blocks a second start until the launcher quits
        let failed = false;
        child.on('error', (e) => {
          failed = true;
          gameProcess = null;
          log(`ERROR: Could not start Java: ${e.message}`);
          progress(0, 'Minecraft could not start. See Console.');
        });
        setTimeout(() => { if (!failed) app.quit(); }, 1500);
      } else {
        gameProcess = child;
        win?.webContents.send('game-state', 'running');
        child.on('exit', (code) => {
          gameProcess = null;
          log(code === 0 ? 'Minecraft closed.' : `ERROR: Minecraft stopped with exit code ${code}. The lines above show why.`);
          win?.webContents.send('game-state', 'stopped');
        });
        child.on('error', (e) => {
          gameProcess = null;
          log(`ERROR: Could not start Java: ${e.message}`);
          win?.webContents.send('game-state', 'stopped');
        });
      }
      progress(1, `Minecraft is running as ${session.name}.`);
      log('Done. Minecraft is starting.');
      return { ok: true, mode: 'direct', name: session.name };
    } catch (err) {
      log('ERROR: ' + err.message);
      progress(0, 'Something went wrong. See Console');
      return { ok: false, error: err.message };
    } finally {
      busy = false;
    }
  });

  ipcMain.handle('mod:build', async () => {
    if (busy) return { ok: false, error: 'Already working…' };
    busy = true;
    try {
      progress(0.1, 'Building Quasar mod');
      await installer.buildMod(log);
      progress(1, 'Build finished');
      log('Build finished.');
      return { ok: true, modJar: await installer.findModJar(settings) };
    } catch (err) {
      log('ERROR: ' + err.message);
      progress(0, 'Build failed. See Console');
      return { ok: false, error: err.message };
    } finally {
      busy = false;
    }
  });

  ipcMain.handle('folder:open', async () => {
    const dir = installer.gameDir(settings);
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });

  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose your Minecraft folder',
      defaultPath: settings.minecraftDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:jar', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose the Quasar Client mod jar',
      filters: [{ name: 'Mod jar', extensions: ['jar'] }],
      properties: ['openFile'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.on('window', (_e, action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    if (action === 'close') win.close();
  });

  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
