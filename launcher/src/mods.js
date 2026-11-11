// Mod browser backend: search Modrinth and CurseForge, install a mod (plus the mods it
// requires) into the Quasar game folder, list what is installed, and remove mods.
// Only Node built-ins are used. Requests run in the main process, so the API key never
// reaches the page.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const MC_VERSION = '1.21.1';
const USER_AGENT = 'quasar-client/launcher/1.0.0 (Minecraft launcher)';
const MODRINTH = 'https://api.modrinth.com/v2';
const CURSEFORGE = 'https://api.curseforge.com/v1';
const CF_GAME_MINECRAFT = 432;
const CF_CLASS_MODS = 6;
const CF_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const CF_LOADER_NAME = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
const CF_SORT = { downloads: 6, follows: 2, updated: 3, newest: 11 };
const CF_REQUIRED = 3;
const LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'];
const KNOWN_LOADERS = new Set([...LOADERS, 'liteloader', 'modloader', 'rift', 'babric', 'legacy-fabric', 'nilloader', 'ornithe', 'bta-babric', 'java-agent']);
// The game always runs on Fabric, so only Fabric builds can be installed.
const INSTALL_LOADER = 'fabric';

// Used when the category list cannot be fetched.
const MODRINTH_CATEGORIES_FALLBACK = [
  'adventure', 'cursed', 'decoration', 'economy', 'equipment', 'food', 'game-mechanics',
  'library', 'magic', 'management', 'minigame', 'mobs', 'optimization', 'social',
  'storage', 'technology', 'transportation', 'utility', 'worldgen',
];

// ---------------------------------------------------------------- http

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers } });
  if (res.status === 403 && url.startsWith(CURSEFORGE)) {
    throw new Error('CurseForge refused the request. Check the API key in Settings.');
  }
  if (res.status === 429) throw new Error('Too many requests right now. Wait a minute and try again.');
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}.`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  await fsp.rename(tmp, dest);
}

const q = (v) => encodeURIComponent(JSON.stringify(v));
const cfHeaders = (key) => ({ 'x-api-key': key });

function requireKey(key) {
  if (!key) {
    const err = new Error('Add your CurseForge API key in Settings to search CurseForge.');
    err.code = 'NO_KEY';
    throw err;
  }
}

// ---------------------------------------------------------------- categories

async function categories(source, cfKey) {
  if (source === 'curseforge') {
    requireKey(cfKey);
    const { data } = await getJson(
      `${CURSEFORGE}/categories?gameId=${CF_GAME_MINECRAFT}&classId=${CF_CLASS_MODS}`, cfHeaders(cfKey));
    return data
      .filter((c) => !c.isClass && c.parentCategoryId === CF_CLASS_MODS)
      .map((c) => ({ id: String(c.id), name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  let names = MODRINTH_CATEGORIES_FALLBACK;
  try {
    const tags = await getJson(`${MODRINTH}/tag/category`);
    const fetched = tags.filter((t) => t.project_type === 'mod' && t.header === 'categories').map((t) => t.name);
    if (fetched.length) names = fetched;
  } catch { /* fall back to the built-in list */ }
  return names.map((n) => ({ id: n, name: prettify(n) })).sort((a, b) => a.name.localeCompare(b.name));
}

function prettify(slug) {
  const s = slug.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------- search

/**
 * @param {object} o  { source, query, category, loader, side, sort, offset, cfKey }
 *   loader: 'any' | fabric | quilt | forge | neoforge
 *   side:   'any' | 'client' | 'server'   (Modrinth only)
 *   sort:   relevance | downloads | follows | updated | newest
 */
async function search(o) {
  return o.source === 'curseforge' ? searchCurseForge(o) : searchModrinth(o);
}

async function searchModrinth({ query = '', category = '', loader = 'fabric', side = 'any', sort = 'relevance', offset = 0 }) {
  const facets = [['project_type:mod'], [`versions:${MC_VERSION}`]];
  if (loader !== 'any') facets.push([`categories:${loader}`]);
  if (category) facets.push([`categories:${category}`]);
  if (side === 'client') facets.push(['client_side!=unsupported']);
  if (side === 'server') facets.push(['server_side!=unsupported']);
  const url = `${MODRINTH}/search?query=${encodeURIComponent(query)}&facets=${q(facets)}`
    + `&index=${sort}&offset=${offset}&limit=20`;
  const res = await getJson(url);
  return {
    total: res.total_hits,
    offset: res.offset + res.hits.length,
    results: res.hits.map((h) => {
      const loaders = h.categories.filter((c) => KNOWN_LOADERS.has(c));
      return {
        source: 'modrinth',
        id: h.project_id,
        title: h.title,
        author: h.author,
        description: h.description,
        icon: h.icon_url || null,
        downloads: h.downloads,
        updated: h.date_modified,
        categories: (h.display_categories || h.categories).filter((c) => !KNOWN_LOADERS.has(c)).map(prettify),
        loaders,
        clientSide: h.client_side,
        serverSide: h.server_side,
        url: `https://modrinth.com/mod/${h.slug || h.project_id}`,
      };
    }),
  };
}

async function searchCurseForge({ query = '', category = '', loader = 'fabric', sort = 'relevance', offset = 0, cfKey }) {
  requireKey(cfKey);
  const params = new URLSearchParams({
    gameId: String(CF_GAME_MINECRAFT),
    classId: String(CF_CLASS_MODS),
    gameVersion: MC_VERSION,
    searchFilter: query,
    index: String(offset),
    pageSize: '20',
  });
  if (loader !== 'any') params.set('modLoaderType', String(CF_LOADER[loader]));
  if (category) params.set('categoryId', category);
  if (CF_SORT[sort]) {
    params.set('sortField', String(CF_SORT[sort]));
    params.set('sortOrder', 'desc');
  }
  const res = await getJson(`${CURSEFORGE}/mods/search?${params}`, cfHeaders(cfKey));
  return {
    total: res.pagination.totalCount,
    offset: res.pagination.index + res.data.length,
    results: res.data.map((m) => {
      const loaders = [...new Set((m.latestFilesIndexes || [])
        .filter((f) => f.gameVersion === MC_VERSION && CF_LOADER_NAME[f.modLoader])
        .map((f) => CF_LOADER_NAME[f.modLoader]))];
      return {
        source: 'curseforge',
        id: String(m.id),
        title: m.name,
        author: m.authors?.[0]?.name || 'Unknown',
        description: m.summary,
        icon: m.logo?.thumbnailUrl || null,
        downloads: m.downloadCount,
        updated: m.dateModified,
        categories: (m.categories || []).map((c) => c.name),
        loaders,
        clientSide: null,
        serverSide: null,
        url: m.links?.websiteUrl || `https://www.curseforge.com/minecraft/mc-mods/${m.slug}`,
      };
    }),
  };
}

// ---------------------------------------------------------------- installed

const MANIFEST = (gameDir) => path.join(gameDir, 'config', 'quasar-launcher-mods.json');

async function readManifest(gameDir) {
  try {
    return JSON.parse(await fsp.readFile(MANIFEST(gameDir), 'utf8'));
  } catch {
    return { mods: [] };
  }
}

async function writeManifest(gameDir, manifest) {
  await fsp.mkdir(path.dirname(MANIFEST(gameDir)), { recursive: true });
  await fsp.writeFile(MANIFEST(gameDir), JSON.stringify(manifest, null, 2));
}

/** Every jar in the mods folder, with what the launcher knows about it. */
async function listInstalled(gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  let files = [];
  try {
    files = (await fsp.readdir(modsDir)).filter((f) => f.endsWith('.jar'));
  } catch { /* no mods folder yet */ }
  const manifest = await readManifest(gameDir);
  return files.map((file) => {
    const known = manifest.mods.find((m) => m.file === file);
    const required = file.startsWith('quasar-client') ? 'Quasar Client'
      : file.startsWith('fabric-api-') ? 'Fabric API' : null;
    return {
      file,
      title: known?.title || required || file.replace(/\.jar$/, ''),
      icon: known?.icon || null,
      source: known?.source || null,
      id: known?.id || null,
      url: known?.url || null,
      requiredBy: required ? 'Quasar' : known?.requiredBy || null,
      removable: !required,
    };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

async function removeMod(gameDir, file) {
  if (file.includes('/') || file.includes('\\') || !file.endsWith('.jar')) throw new Error('Not a mod file.');
  if (file.startsWith('quasar-client') || file.startsWith('fabric-api-')) {
    throw new Error(`${file} is needed by Quasar and can't be removed.`);
  }
  await fsp.unlink(path.join(gameDir, 'mods', file));
  const manifest = await readManifest(gameDir);
  manifest.mods = manifest.mods.filter((m) => m.file !== file);
  await writeManifest(gameDir, manifest);
}

// ---------------------------------------------------------------- install

/**
 * Installs the newest Fabric build for 1.21.1, then every mod it requires.
 * Returns the titles that were installed.
 */
async function install({ source, id, gameDir, cfKey, log = () => {} }) {
  const modsDir = path.join(gameDir, 'mods');
  await fsp.mkdir(modsDir, { recursive: true });
  const manifest = await readManifest(gameDir);
  const installed = [];
  const seen = new Set();

  async function one(src, projectId, requiredBy) {
    const key = `${src}:${projectId}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (manifest.mods.some((m) => m.source === src && m.id === projectId)) return;

    const plan = src === 'curseforge'
      ? await planCurseForge(projectId, cfKey)
      : await planModrinth(projectId);

    // Quasar ships Fabric API itself.
    if (/^fabric-api$/i.test(plan.slug || '') || /^Fabric API$/i.test(plan.title)) return;

    const existing = (await fsp.readdir(modsDir)).find((f) => f === plan.filename);
    if (!existing) {
      log(`Downloading ${plan.filename}`);
      await download(plan.downloadUrl, path.join(modsDir, plan.filename));
    }
    manifest.mods = manifest.mods.filter((m) => m.file !== plan.filename);
    manifest.mods.push({
      file: plan.filename, source: src, id: projectId, title: plan.title,
      icon: plan.icon, url: plan.url, requiredBy: requiredBy || null,
    });
    installed.push(plan.title);

    for (const dep of plan.dependencies) await one(src, dep, plan.title);
  }

  await one(source, id, null);
  await writeManifest(gameDir, manifest);
  return installed;
}

async function planModrinth(projectId) {
  const [project, versions] = await Promise.all([
    getJson(`${MODRINTH}/project/${projectId}`),
    getJson(`${MODRINTH}/project/${projectId}/version?loaders=${q([INSTALL_LOADER])}&game_versions=${q([MC_VERSION])}`),
  ]);
  if (!versions.length) throw new Error(`${project.title} has no Fabric build for Minecraft ${MC_VERSION}.`);
  const version = versions.find((v) => v.version_type === 'release') || versions[0];
  const file = version.files.find((f) => f.primary) || version.files[0];
  return {
    title: project.title,
    slug: project.slug,
    icon: project.icon_url || null,
    url: `https://modrinth.com/mod/${project.slug}`,
    filename: file.filename,
    downloadUrl: file.url,
    dependencies: (version.dependencies || [])
      .filter((d) => d.dependency_type === 'required' && d.project_id)
      .map((d) => d.project_id),
  };
}

async function planCurseForge(modId, cfKey) {
  requireKey(cfKey);
  const params = new URLSearchParams({ gameVersion: MC_VERSION, modLoaderType: String(CF_LOADER[INSTALL_LOADER]), pageSize: '20' });
  const [{ data: mod }, { data: files }] = await Promise.all([
    getJson(`${CURSEFORGE}/mods/${modId}`, cfHeaders(cfKey)),
    getJson(`${CURSEFORGE}/mods/${modId}/files?${params}`, cfHeaders(cfKey)),
  ]);
  if (!files.length) throw new Error(`${mod.name} has no Fabric build for Minecraft ${MC_VERSION}.`);
  const file = files.find((f) => f.releaseType === 1) || files[0];
  if (!file.downloadUrl) {
    throw new Error(`The author of ${mod.name} doesn't allow downloads outside CurseForge. Get it from its CurseForge page.`);
  }
  return {
    title: mod.name,
    slug: mod.slug,
    icon: mod.logo?.thumbnailUrl || null,
    url: mod.links?.websiteUrl || null,
    filename: file.fileName,
    downloadUrl: file.downloadUrl,
    dependencies: (file.dependencies || []).filter((d) => d.relationType === CF_REQUIRED).map((d) => String(d.modId)),
  };
}

module.exports = { LOADERS, INSTALL_LOADER, categories, search, install, listInstalled, removeMod };
