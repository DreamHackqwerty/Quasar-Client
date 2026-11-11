// Installs and starts Minecraft directly: version files, libraries, assets and a Java runtime
// from Mojang, Fabric Loader's libraries from Fabric, then the java command line.
// Game files are shared with the official launcher's folder (versions, libraries, assets),
// so nothing is downloaded twice. Every download is checked against its SHA-1 when one is given.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const USER_AGENT = 'quasar-client/launcher/1.0.0';
const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_MANIFEST = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const ASSET_BASE = 'https://resources.download.minecraft.net';

const OS_NAME = { darwin: 'osx', win32: 'windows', linux: 'linux' }[process.platform];
const RULE_ARCH = process.arch === 'ia32' ? 'x86' : process.arch;

// ---------------------------------------------------------------- helpers

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
  return res.json();
}

async function sha1File(file) {
  const hash = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/** Downloads `url` to `dest` unless a file of the right size is already there. */
async function fetchFile({ url, dest, sha1, size }) {
  if (await exists(dest)) {
    const st = await fsp.stat(dest);
    if (!size || st.size === size) return false;
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  if (sha1) {
    const got = await sha1File(tmp);
    if (got !== sha1) {
      await fsp.unlink(tmp).catch(() => {});
      throw new Error(`Checksum mismatch for ${path.basename(dest)}. Try again.`);
    }
  }
  await fsp.rename(tmp, dest);
  return true;
}

/** Runs `jobs` with limited concurrency, calling onDone after each. */
async function runAll(jobs, limit, onDone) {
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      await fetchFile(job);
      onDone(++done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

/** Mojang's rule format: the last matching rule decides; no rules means allowed. */
function allowed(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let result = false;
  for (const rule of rules) {
    let match = true;
    if (rule.os) {
      if (rule.os.name && rule.os.name !== OS_NAME) match = false;
      if (rule.os.arch && rule.os.arch !== RULE_ARCH) match = false;
      if (rule.os.version) {
        try { if (!new RegExp(rule.os.version).test(os.release())) match = false; } catch { match = false; }
      }
    }
    if (rule.features) {
      for (const [k, v] of Object.entries(rule.features)) if (Boolean(features[k]) !== v) match = false;
    }
    if (match) result = rule.action === 'allow';
  }
  return result;
}

/** "group:artifact:version[:classifier]" -> relative maven path. */
function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`;
  return path.posix.join(...group.split('.'), artifact, version, file);
}

/** Library identity without the version, so Fabric's copy replaces vanilla's. */
function libraryKey(name) {
  const [group, artifact, , classifier] = name.split(':');
  return `${group}:${artifact}${classifier ? `:${classifier}` : ''}`;
}

// ---------------------------------------------------------------- version data

async function loadVersions(mcDir, mcVersion, fabricId, log) {
  const vanillaPath = path.join(mcDir, 'versions', mcVersion, `${mcVersion}.json`);
  let vanilla;
  if (await exists(vanillaPath)) {
    vanilla = JSON.parse(await fsp.readFile(vanillaPath, 'utf8'));
  } else {
    log(`Downloading Minecraft ${mcVersion} details`);
    const manifest = await getJson(VERSION_MANIFEST);
    const entry = manifest.versions.find((v) => v.id === mcVersion);
    if (!entry) throw new Error(`Minecraft ${mcVersion} is not in Mojang's version list.`);
    vanilla = await getJson(entry.url);
    await fsp.mkdir(path.dirname(vanillaPath), { recursive: true });
    await fsp.writeFile(vanillaPath, JSON.stringify(vanilla));
  }
  const fabricPath = path.join(mcDir, 'versions', fabricId, `${fabricId}.json`);
  if (!(await exists(fabricPath))) throw new Error('Fabric Loader is not installed yet.');
  const fabric = JSON.parse(await fsp.readFile(fabricPath, 'utf8'));
  return { vanilla, fabric };
}

/** Every library jar to download and put on the classpath, Fabric's taking priority. */
function collectLibraries(mcDir, vanilla, fabric) {
  const byKey = new Map();
  for (const lib of vanilla.libraries || []) {
    if (!allowed(lib.rules)) continue;
    const art = lib.downloads?.artifact;
    if (!art) continue; // old-style natives-only entries are not used by 1.21.1
    byKey.set(libraryKey(lib.name), {
      url: art.url, sha1: art.sha1, size: art.size, dest: path.join(mcDir, 'libraries', art.path),
    });
  }
  for (const lib of fabric.libraries || []) {
    const rel = mavenPath(lib.name);
    const base = (lib.url || 'https://maven.fabricmc.net/').replace(/\/?$/, '/');
    byKey.set(libraryKey(lib.name), {
      url: base + rel, sha1: lib.sha1, size: lib.size, dest: path.join(mcDir, 'libraries', rel),
    });
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------- java

function javaPlatform() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'windows-arm64' : process.arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  return process.arch === 'ia32' ? 'linux-i386' : 'linux';
}

function javaExecutable(home) {
  if (process.platform === 'darwin') return path.join(home, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(home, 'bin', process.platform === 'win32' ? 'javaw.exe' : 'java');
}

async function ensureJava(runtimeDir, component, log, progress) {
  const home = path.join(runtimeDir, component, javaPlatform());
  const exe = javaExecutable(home);
  const marker = path.join(home, '.quasar-complete');
  if (await exists(marker) && await exists(exe)) return exe;

  log(`Downloading Java (${component})`);
  const all = await getJson(JAVA_MANIFEST);
  const entry = all[javaPlatform()]?.[component]?.[0];
  if (!entry) throw new Error(`Mojang has no ${component} Java for this computer.`);
  const { files } = await getJson(entry.manifest.url);

  const jobs = [];
  const links = [];
  const executables = [];
  for (const [rel, f] of Object.entries(files)) {
    const dest = path.join(home, rel);
    if (f.type === 'directory') await fsp.mkdir(dest, { recursive: true });
    else if (f.type === 'link') links.push({ dest, target: f.target });
    else if (f.type === 'file') {
      jobs.push({ url: f.downloads.raw.url, sha1: f.downloads.raw.sha1, size: f.downloads.raw.size, dest });
      if (f.executable) executables.push(dest);
    }
  }
  await runAll(jobs, 16, (d, t) => progress(d / t));
  if (process.platform !== 'win32') {
    for (const file of executables) await fsp.chmod(file, 0o755);
    for (const { dest, target } of links) {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rm(dest, { force: true });
      await fsp.symlink(target, dest);
    }
  }
  await fsp.writeFile(marker, entry.version?.name || component);
  return exe;
}

// ---------------------------------------------------------------- arguments

function substitute(arg, vars) {
  return arg.replace(/\$\{([^}]+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

/** Flattens Mojang's argument lists, dropping anything behind rules that do not apply. */
function flattenArgs(list, vars) {
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') {
      out.push(substitute(item, vars));
    } else if (allowed(item.rules)) {
      const values = Array.isArray(item.value) ? item.value : [item.value];
      for (const v of values) out.push(substitute(v, vars));
    }
  }
  return out;
}

function buildCommand({ vanilla, fabric, libraries, clientJar, nativesDir, mcDir, gameDir, session, ramGb, versionId }) {
  const classpath = [...libraries.map((l) => l.dest), clientJar].join(path.delimiter);
  const vars = {
    natives_directory: nativesDir,
    launcher_name: 'quasar-client',
    launcher_version: '1.0.0',
    classpath,
    classpath_separator: path.delimiter,
    library_directory: path.join(mcDir, 'libraries'),
    version_name: versionId,
    game_directory: gameDir,
    assets_root: path.join(mcDir, 'assets'),
    assets_index_name: vanilla.assetIndex.id,
    auth_player_name: session.name,
    auth_uuid: session.uuid,
    auth_access_token: session.accessToken,
    auth_xuid: session.xuid || '0',
    clientid: session.clientId || '',
    user_type: 'msa',
    version_type: 'release',
    user_properties: '{}',
  };
  const jvm = [
    `-Xmx${ramGb}G`,
    `-Xms${Math.min(2, ramGb)}G`,
    '-XX:+UseG1GC',
    ...flattenArgs(vanilla.arguments?.jvm, vars),
    ...flattenArgs(fabric.arguments?.jvm, vars),
  ];
  if (vanilla.logging?.client) {
    const cfg = path.join(mcDir, 'assets', 'log_configs', vanilla.logging.client.file.id);
    jvm.push(vanilla.logging.client.argument.replace('${path}', cfg));
  }
  const game = [
    ...flattenArgs(vanilla.arguments?.game, vars),
    ...flattenArgs(fabric.arguments?.game, vars),
  ];
  return { mainClass: fabric.mainClass, args: [...jvm, fabric.mainClass, ...game] };
}

// ---------------------------------------------------------------- install + launch

async function install({ mcDir, runtimeDir, mcVersion, fabricId, log, progress }) {
  const { vanilla, fabric } = await loadVersions(mcDir, mcVersion, fabricId, log);

  const clientJar = path.join(mcDir, 'versions', mcVersion, `${mcVersion}.jar`);
  const libraries = collectLibraries(mcDir, vanilla, fabric);
  const core = [
    { url: vanilla.downloads.client.url, sha1: vanilla.downloads.client.sha1, size: vanilla.downloads.client.size, dest: clientJar },
    ...libraries,
  ];
  if (vanilla.logging?.client) {
    const f = vanilla.logging.client.file;
    core.push({ url: f.url, sha1: f.sha1, size: f.size, dest: path.join(mcDir, 'assets', 'log_configs', f.id) });
  }
  log(`Checking game files (${core.length})`);
  await runAll(core, 8, (d, t) => progress('files', d / t));

  const indexPath = path.join(mcDir, 'assets', 'indexes', `${vanilla.assetIndex.id}.json`);
  await fetchFile({ url: vanilla.assetIndex.url, sha1: vanilla.assetIndex.sha1, size: vanilla.assetIndex.size, dest: indexPath });
  const { objects } = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
  const assets = Object.values(objects).map(({ hash, size }) => ({
    url: `${ASSET_BASE}/${hash.slice(0, 2)}/${hash}`,
    sha1: hash,
    size,
    dest: path.join(mcDir, 'assets', 'objects', hash.slice(0, 2), hash),
  }));
  log(`Checking sounds and textures (${assets.length})`);
  await runAll(assets, 24, (d, t) => progress('assets', d / t));

  const component = vanilla.javaVersion?.component || 'java-runtime-delta';
  const java = await ensureJava(runtimeDir, component, log, (p) => progress('java', p));

  return { vanilla, fabric, libraries, clientJar, java };
}

/**
 * Starts the game. Returns the child process. The access token is passed only on the
 * command line of the game process and never written to the log.
 */
async function launch({ install: inst, mcDir, gameDir, session, ramGb, versionId, detach, log }) {
  const nativesDir = path.join(gameDir, 'natives');
  await fsp.mkdir(nativesDir, { recursive: true });
  const { args } = buildCommand({
    vanilla: inst.vanilla, fabric: inst.fabric, libraries: inst.libraries, clientJar: inst.clientJar,
    nativesDir, mcDir, gameDir, session, ramGb, versionId,
  });
  log(`Starting Minecraft as ${session.name}`);
  const child = spawn(inst.java, args, {
    cwd: gameDir,
    detached: detach,
    stdio: detach ? 'ignore' : ['ignore', 'pipe', 'pipe'],
  });
  if (detach) {
    child.unref();
  } else {
    // Buffer whole lines before redacting, so a token split across two chunks is still hidden.
    const forwarder = () => {
      let pending = '';
      const emit = (line) => { if (line) log(`[Minecraft] ${line.replaceAll(session.accessToken, '<hidden>')}`); };
      return {
        data: (chunk) => {
          pending += chunk.toString();
          const lines = pending.split(/\r?\n/);
          pending = lines.pop();
          lines.forEach(emit);
        },
        end: () => { emit(pending); pending = ''; },
      };
    };
    for (const stream of [child.stdout, child.stderr]) {
      const f = forwarder();
      stream.on('data', f.data);
      stream.on('end', f.end);
    }
  }
  return child;
}

module.exports = { install, launch, buildCommand, collectLibraries, allowed, mavenPath, flattenArgs };
