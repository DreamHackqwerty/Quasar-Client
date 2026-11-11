// Everything the Play button does: install Fabric, Fabric API and the Quasar mod into a
// dedicated game folder, write the module config, add a "Quasar Client" profile to the
// official Minecraft Launcher and open it. Only Node built-ins are used.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const MC_VERSION = '1.21.1';
const LOADER_VERSION = '0.16.14';
const VERSION_ID = `fabric-loader-${LOADER_VERSION}-${MC_VERSION}`;
const PROFILE_KEY = 'quasar-client';
const USER_AGENT = 'QuasarLauncher/1.0.0 (github.com/quasar-client)';

// Must match the module names in the mod's Java code (Module constructor names).
const MODULES = [
  { name: 'Watermark', category: 'HUD', default: true, description: 'Shows the Quasar name in the top-left corner.' },
  { name: 'Module List', category: 'HUD', default: true, description: 'Lists the features that are on, in the top-right corner.' },
  { name: 'FPS', category: 'HUD', default: true, description: 'Shows your frames per second.' },
  { name: 'Coordinates', category: 'HUD', default: true, description: 'Your XYZ position and the direction you face.' },
  { name: 'Keystrokes', category: 'HUD', default: true, description: 'WASD, mouse buttons with clicks per second, and jump.' },
  { name: 'Armor HUD', category: 'HUD', default: true, description: 'Your armor and its durability beside the hotbar.' },
  { name: 'Zoom', category: 'Render', default: true, description: 'Hold C to zoom in 4x with a smooth camera.' },
  { name: 'Fullbright', category: 'Render', default: false, description: 'Lights up dark areas like caves.' },
  { name: 'Toggle Sprint', category: 'Movement', default: false, description: 'Sprint whenever you walk forward.' },
];

// The smallest valid (empty) zip file. The Fabric installer writes a placeholder jar like this.
const EMPTY_JAR = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);

function defaultMinecraftDir() {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft');
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft');
    default:
      return path.join(os.homedir(), '.minecraft');
  }
}

function gameDir(settings) {
  return path.join(settings.minecraftDir, 'quasar');
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
  return res.json();
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (total && onProgress) onProgress(received / total);
  });
  await pipeline(body, fs.createWriteStream(tmp));
  await fsp.rename(tmp, dest);
}

// ---------------------------------------------------------------- module config

async function readModules(settings) {
  const file = path.join(gameDir(settings), 'config', 'quasar-client.json');
  let saved = {};
  try {
    saved = JSON.parse(await fsp.readFile(file, 'utf8')).modules || {};
  } catch { /* first run: use defaults */ }
  return MODULES.map((m) => ({ ...m, enabled: typeof saved[m.name] === 'boolean' ? saved[m.name] : m.default }));
}

async function writeModules(settings, states) {
  const file = path.join(gameDir(settings), 'config', 'quasar-client.json');
  const modules = {};
  for (const m of MODULES) modules[m.name] = typeof states[m.name] === 'boolean' ? states[m.name] : m.default;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify({ modules }, null, 2));
}

// ---------------------------------------------------------------- mod jar

function repoRoot() {
  // launcher/src -> repo root. Only meaningful when running from source, not a packaged app.
  return path.resolve(__dirname, '..', '..');
}

async function findModJar(settings) {
  if (settings.modJar && (await exists(settings.modJar))) return settings.modJar;
  const libs = path.join(repoRoot(), 'build', 'libs');
  if (!(await exists(libs))) return null;
  const jars = (await fsp.readdir(libs)).filter(
    (f) => f.startsWith('quasar-client-') && f.endsWith('.jar') && !f.includes('-sources') && !f.includes('-dev'));
  if (jars.length === 0) return null;
  const stats = await Promise.all(jars.map(async (f) => ({ f, t: (await fsp.stat(path.join(libs, f))).mtimeMs })));
  stats.sort((a, b) => b.t - a.t);
  return path.join(libs, stats[0].f);
}

async function canBuildFromSource() {
  return exists(path.join(repoRoot(), 'build.gradle'));
}

function buildMod(log) {
  return new Promise((resolve, reject) => {
    const root = repoRoot();
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'gradlew.bat' : './gradlew';
    log(`Building the mod: ${cmd} build (first build downloads Minecraft and can take a few minutes)`);
    const child = spawn(cmd, ['build', '--console=plain'], { cwd: root, shell: isWin });
    const forward = (data) => data.toString().split(/\r?\n/).filter(Boolean).forEach((l) => log('  ' + l));
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (e) => reject(new Error(`Could not start Gradle: ${e.message}. Is JDK 21 installed?`)));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Gradle build failed (exit code ${code})`))));
  });
}

// ---------------------------------------------------------------- install steps

async function installFabricLoader(mcDir, log) {
  const dir = path.join(mcDir, 'versions', VERSION_ID);
  const jsonPath = path.join(dir, `${VERSION_ID}.json`);
  if (await exists(jsonPath)) {
    log(`Fabric Loader ${LOADER_VERSION} already installed`);
  } else {
    log(`Installing Fabric Loader ${LOADER_VERSION} for ${MC_VERSION}`);
    const profile = await fetchJson(
      `https://meta.fabricmc.net/v2/versions/loader/${MC_VERSION}/${LOADER_VERSION}/profile/json`);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(jsonPath, JSON.stringify(profile, null, 2));
  }
  const jarPath = path.join(dir, `${VERSION_ID}.jar`);
  if (!(await exists(jarPath))) await fsp.writeFile(jarPath, EMPTY_JAR);
}

async function installFabricApi(modsDir, log, onProgress) {
  await fsp.mkdir(modsDir, { recursive: true });
  const existing = (await fsp.readdir(modsDir)).find((f) => f.startsWith('fabric-api-') && f.endsWith('.jar'));
  if (existing) {
    log(`Fabric API already installed (${existing})`);
    return;
  }
  log('Looking up the latest Fabric API for ' + MC_VERSION);
  const query = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(`["${MC_VERSION}"]`)}`;
  const versions = await fetchJson(`https://api.modrinth.com/v2/project/fabric-api/version?${query}`);
  if (!versions.length) throw new Error('No Fabric API release found for ' + MC_VERSION);
  const file = versions[0].files.find((f) => f.primary) || versions[0].files[0];
  log(`Downloading ${file.filename}`);
  await download(file.url, path.join(modsDir, file.filename), onProgress);
}

async function installQuasarMod(jar, modsDir, log) {
  for (const f of await fsp.readdir(modsDir)) {
    if (f.startsWith('quasar-client') && f.endsWith('.jar')) await fsp.unlink(path.join(modsDir, f));
  }
  await fsp.copyFile(jar, path.join(modsDir, path.basename(jar)));
  log(`Installed ${path.basename(jar)}`);
}

async function writeLauncherProfile(mcDir, gDir, ramGb, log) {
  const names = ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json'];
  let targets = [];
  for (const n of names) if (await exists(path.join(mcDir, n))) targets.push(path.join(mcDir, n));
  if (targets.length === 0) targets = [path.join(mcDir, names[0])];

  const now = new Date().toISOString();
  for (const file of targets) {
    let data = { profiles: {} };
    if (await exists(file)) {
      try {
        data = JSON.parse(await fsp.readFile(file, 'utf8'));
      } catch {
        log(`Skipping ${path.basename(file)}: it is not valid JSON`);
        continue;
      }
    }
    data.profiles = data.profiles || {};
    const old = data.profiles[PROFILE_KEY] || {};
    data.profiles[PROFILE_KEY] = {
      ...old,
      name: 'Quasar Client',
      type: 'custom',
      created: old.created || now,
      lastUsed: now, // most recently used profile is pre-selected in the launcher
      icon: 'Furnace',
      lastVersionId: VERSION_ID,
      gameDir: gDir,
      javaArgs: `-Xmx${ramGb}G -Xms${Math.min(2, ramGb)}G -XX:+UseG1GC`,
    };
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(data, null, 2));
    log(`Updated "Quasar Client" profile in ${path.basename(file)}`);
  }
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
    child.unref();
  });
}

async function openOfficialLauncher(log) {
  if (process.platform === 'darwin') {
    if (await run('open', ['-a', 'Minecraft'])) return true;
    if (await run('open', ['-a', 'Minecraft Launcher'])) return true;
  } else if (process.platform === 'win32') {
    const exes = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    ];
    for (const exe of exes) {
      if (await exists(exe)) {
        spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
        return true;
      }
    }
    // Microsoft Store / Xbox app version. explorer.exe exits with 1 even on success.
    spawn('explorer.exe', ['shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft'],
      { detached: true, stdio: 'ignore' }).unref();
    return true;
  } else {
    const child = spawn('minecraft-launcher', [], { detached: true, stdio: 'ignore' });
    const ok = await new Promise((r) => { child.on('error', () => r(false)); setTimeout(() => r(true), 800); });
    child.unref();
    if (ok) return true;
  }
  log('Could not find the Minecraft Launcher. Open it yourself and pick the "Quasar Client" profile.');
  return false;
}

// ---------------------------------------------------------------- play

/** Steps shared by both ways of playing: Quasar mod, Fabric Loader, Fabric API, feature settings. */
async function prepare(settings, moduleStates, log, progress, scale = 1) {
  const mcDir = settings.minecraftDir;
  const gDir = gameDir(settings);
  const modsDir = path.join(gDir, 'mods');
  const p = (v, s) => progress(v * scale, s);

  p(0.03, 'Checking Quasar mod');
  let jar = await findModJar(settings);
  if (!jar) {
    if (!(await canBuildFromSource())) {
      throw new Error('Quasar mod jar not found. Choose it in Settings → Mod file.');
    }
    p(0.08, 'Building Quasar mod (first time only)');
    await buildMod(log);
    jar = await findModJar(settings);
    if (!jar) throw new Error('The build finished but no jar was found in build/libs.');
  }
  log(`Using mod jar: ${jar}`);

  p(0.35, 'Installing Fabric Loader');
  await installFabricLoader(mcDir, log);

  p(0.45, 'Installing Fabric API');
  await installFabricApi(modsDir, log, (x) => p(0.45 + x * 0.3, 'Downloading Fabric API'));

  p(0.78, 'Installing Quasar Client');
  await installQuasarMod(jar, modsDir, log);

  p(0.85, 'Saving feature settings');
  await writeModules(settings, moduleStates);

}

/** Fallback: add the profile to the official Minecraft Launcher and open it. */
async function play(settings, moduleStates, log, progress) {
  const mcDir = settings.minecraftDir;
  const gDir = gameDir(settings);
  await prepare(settings, moduleStates, log, progress);
  return finishWithLauncher(settings, log, progress);
}

async function finishWithLauncher(settings, log, progress) {
  progress(0.9, 'Creating launcher profile');
  await writeLauncherProfile(settings.minecraftDir, gameDir(settings), settings.ramGb, log);

  progress(0.96, 'Opening Minecraft Launcher');
  const opened = await openOfficialLauncher(log);
  progress(1, opened ? 'Ready. Press Play in the Minecraft Launcher.' : 'Installed. Open the Minecraft Launcher.');
  log('Done. In the Minecraft Launcher, choose the "Quasar Client" profile and press Play.');
  return { opened };
}

module.exports = {
  MC_VERSION, LOADER_VERSION, VERSION_ID, MODULES,
  defaultMinecraftDir, gameDir, readModules, writeModules, findModJar,
  canBuildFromSource, buildMod, installFabricLoader, writeLauncherProfile, prepare, finishWithLauncher, play,
};
