'use strict';
// Smart urn server: stores the memorial, photos, voice notes and messages,
// serves the urn display (/device), the family phone app (/family),
// the owner's settings (/admin) and the desktop simulator (/sim).
// Zero dependencies: needs only Node.js 20+.

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { parseDate, buildCalendar, allDates } = require('./lib/dates');
const { demoContent } = require('./lib/demo');
const qrcode = require('./lib/vendor/qrcode');

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD = 25 * 1024 * 1024;
const SESSION_DAYS = 365;

const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
  'audio/aac': '.aac', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
};
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
};

// ---------- storage ----------

let db;
function emptyDb() {
  return {
    memorial: null,
    auth: null,
    settings: { nightStart: '22:00', nightEnd: '07:00', slideSeconds: 8 },
    dates: [],
    items: [],
  };
}

function loadDb() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  try {
    db = { ...emptyDb(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    db = emptyDb();
  }
}

let saving = Promise.resolve();
function saveDb() {
  const snapshot = JSON.stringify(db, null, 2);
  saving = saving.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fsp.writeFile(tmp, snapshot);
    await fsp.rename(tmp, DB_FILE);
  });
  return saving;
}

const newId = () => crypto.randomBytes(8).toString('hex');

// ---------- auth ----------
// Two shared codes: a family code (view + add memories) and an owner code
// (also edit and delete). Sessions are signed cookies.

const normCode = (c) => String(c || '').trim().toLowerCase();

function hashCode(code, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(normCode(code), salt, 32).toString('hex') };
}

function codeMatches(code, stored) {
  if (!stored || !code) return false;
  const h = Buffer.from(hashCode(code, stored.salt).hash, 'hex');
  return crypto.timingSafeEqual(h, Buffer.from(stored.hash, 'hex'));
}

function sign(value) {
  return crypto.createHmac('sha256', db.auth.secret).update(value).digest('base64url');
}

function makeSession(role) {
  const value = `${role}.${Date.now() + SESSION_DAYS * 86400000}`;
  return `${value}.${sign(value)}`;
}

function readCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isLocal(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}

// 'owner' | 'family' | 'device' | null
function roleOf(req) {
  if (db.auth) {
    const token = readCookies(req).urn_session || '';
    const [role, expires, sig] = token.split('.');
    if (sig && +expires > Date.now()) {
      const expected = sign(`${role}.${expires}`);
      if (expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return role;
    }
  }
  // The urn's own screen runs on the same machine and only needs to read.
  return isLocal(req) ? 'device' : null;
}

const canView = (role) => role === 'owner' || role === 'family' || role === 'device';
const canAdd = (role) => role === 'owner' || role === 'family';

// Simple brute-force guard on code guesses.
const failures = new Map();
function tooManyFailures(req) {
  const ip = req.socket.remoteAddress;
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 10 * 60000) return false;
  return f.count >= 10;
}
function noteFailure(req) {
  const ip = req.socket.remoteAddress;
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 10 * 60000) failures.set(ip, { since: Date.now(), count: 1 });
  else f.count++;
}

// ---------- live updates (Server-Sent Events) ----------

const listeners = new Set();
function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) res.write(line);
}
setInterval(() => { for (const res of listeners) res.write(': ping\n\n'); }, 25000).unref();

// ---------- http helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = +req.headers['content-length'] || 0;
    if (declared > limit) return reject(new HttpError(413, 'That file is too large (25 MB max).'));
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'That file is too large (25 MB max).')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 256 * 1024);
  try { return buf.length ? JSON.parse(buf) : {}; } catch { throw new HttpError(400, 'Invalid JSON'); }
}

async function readForm(req) {
  const buf = await readBody(req, MAX_UPLOAD + 64 * 1024);
  try {
    return await new Response(buf, { headers: { 'content-type': req.headers['content-type'] || '' } }).formData();
  } catch {
    throw new HttpError(400, 'Could not read the upload.');
  }
}

const clean = (s, max = 500) => String(s ?? '').trim().slice(0, max);

// Serves a file with Range support (Safari will not play audio without it).
async function serveFile(req, res, file, type, cache = 'no-cache') {
  let stat;
  try { stat = await fsp.stat(file); } catch { return send(res, 404, 'Not found'); }
  if (!stat.isFile()) return send(res, 404, 'Not found');
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? +range[1] : stat.size - +range[2];
    let end = range[1] && range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
    if (start < 0) start = 0;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// Addresses phones on the home Wi-Fi can use, best guess first. Virtual
// adapters (WSL, Docker, VirtualBox, VPNs) are skipped because phones can't
// reach them. PUBLIC_URL overrides everything, e.g. for a hosted version.
const VIRTUAL = /vethernet|virtualbox|vmware|docker|wsl|hyper-v|^br-|^veth|^tun|^tap|^utun|tailscale|zerotier/i;

function lanUrls(page = 'family') {
  if (process.env.PUBLIC_URL) return [`${process.env.PUBLIC_URL.replace(/\/+$/, '')}/${page}`];
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) found.push(a.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  found.sort((a, b) => rank(a) - rank(b));
  return found.map((ip) => `http://${ip}:${PORT}/${page}`);
}

// QR code (SVG) pointing at the family page, or the owner page while not set up.
function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), q = 4;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- views of the data ----------

function publicItem(it) {
  return {
    id: it.id, kind: it.kind, from: it.from, caption: it.caption, text: it.text,
    url: it.file ? `/media/${it.file}` : null, createdAt: it.createdAt, duration: it.duration || null,
  };
}

function memorialView(role) {
  const m = db.memorial;
  return {
    setup: Boolean(m),
    role,
    familyUrls: lanUrls(),
    memorial: m && canView(role) ? { ...m, coverUrl: coverUrl() } : m ? { name: m.name } : null,
    settings: canView(role) ? db.settings : null,
  };
}

function coverUrl() {
  const cover = db.items.find((i) => i.id === db.memorial?.coverId && i.kind === 'photo')
    || db.items.find((i) => i.kind === 'photo');
  return cover ? `/media/${cover.file}` : null;
}

function feed(todayStr) {
  return {
    memorial: { ...db.memorial, coverUrl: coverUrl() },
    settings: db.settings,
    calendar: buildCalendar(db.memorial, db.dates, todayStr),
    items: db.items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicItem),
  };
}

// ---------- routes ----------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

const PAGES = { '/': 'family.html', '/family': 'family.html', '/device': 'device.html', '/admin': 'admin.html', '/sim': 'sim.html' };

route('GET', /^\/api\/memorial$/, (req, res) => send(res, 200, memorialView(roleOf(req))));

route('POST', /^\/api\/setup$/, async (req, res) => {
  if (db.memorial) throw new HttpError(409, 'This urn is already set up.');
  const body = await readJson(req);
  const name = clean(body.name, 120);
  if (!name) throw new HttpError(400, 'Please enter a name.');
  if (normCode(body.familyCode).length < 4) throw new HttpError(400, 'The family code needs at least 4 characters.');
  if (normCode(body.ownerCode).length < 6) throw new HttpError(400, 'The owner code needs at least 6 characters.');
  if (normCode(body.familyCode) === normCode(body.ownerCode)) throw new HttpError(400, 'Use a different owner code from the family code.');
  db.memorial = {
    name, nickname: clean(body.nickname, 60),
    born: parseDate(body.born) ? body.born : '', died: parseDate(body.died) ? body.died : '',
    tribute: clean(body.tribute, 600), coverId: null,
  };
  db.auth = { secret: crypto.randomBytes(32).toString('hex'), family: hashCode(body.familyCode), owner: hashCode(body.ownerCode) };
  await saveDb();
  broadcast({ type: 'update' });
  send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('owner') });
});

function sessionCookie(role) {
  return `urn_session=${makeSession(role)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

route('POST', /^\/api\/login$/, async (req, res) => {
  if (!db.auth) throw new HttpError(409, 'This urn has not been set up yet.');
  if (tooManyFailures(req)) throw new HttpError(429, 'Too many tries. Please wait 10 minutes.');
  const { code } = await readJson(req);
  const role = codeMatches(code, db.auth.owner) ? 'owner' : codeMatches(code, db.auth.family) ? 'family' : null;
  if (!role) { noteFailure(req); throw new HttpError(401, "That code didn't match. Check with the family member who set up the urn."); }
  send(res, 200, { role }, { 'Set-Cookie': sessionCookie(role) });
});

route('POST', /^\/api\/logout$/, (req, res) => {
  send(res, 200, { ok: true }, { 'Set-Cookie': 'urn_session=; Path=/; Max-Age=0' });
});

route('GET', /^\/api\/feed$/, (req, res, url) => {
  if (!db.memorial) throw new HttpError(409, 'Not set up');
  if (!canView(roleOf(req))) throw new HttpError(401, 'Please enter the family code.');
  const date = url.searchParams.get('date');
  send(res, 200, feed(parseDate(date) ? date : undefined));
});

route('GET', /^\/api\/events$/, (req, res) => {
  if (!canView(roleOf(req))) throw new HttpError(401, 'Please enter the family code.');
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  listeners.add(res);
  req.on('close', () => listeners.delete(res));
});

route('POST', /^\/api\/upload$/, async (req, res) => {
  const role = roleOf(req);
  if (!canAdd(role)) throw new HttpError(401, 'Please enter the family code.');
  const form = await readForm(req);
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No file was attached.');
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) throw new HttpError(415, `That file type (${mime || 'unknown'}) is not supported. Use a photo or an audio recording.`);
  const kind = mime.startsWith('image/') ? 'photo' : 'voice';
  const id = newId();
  const name = `${id}${ext}`;
  await fsp.writeFile(path.join(MEDIA_DIR, name), Buffer.from(await file.arrayBuffer()));
  const item = {
    id, kind, file: name, mime,
    from: clean(form.get('from'), 60), caption: clean(form.get('caption'), 300),
    duration: Math.max(0, Math.min(3600, +form.get('duration') || 0)) || null,
    createdAt: new Date().toISOString(),
  };
  db.items.push(item);
  await saveDb();
  broadcast({ type: 'update', newItem: item.id });
  send(res, 200, publicItem(item));
});

route('POST', /^\/api\/message$/, async (req, res) => {
  if (!canAdd(roleOf(req))) throw new HttpError(401, 'Please enter the family code.');
  const body = await readJson(req);
  const text = clean(body.text, 600);
  if (!text) throw new HttpError(400, 'Please write a message.');
  const item = { id: newId(), kind: 'message', text, from: clean(body.from, 60), caption: '', createdAt: new Date().toISOString() };
  db.items.push(item);
  await saveDb();
  broadcast({ type: 'update', newItem: item.id });
  send(res, 200, publicItem(item));
});

// ----- owner-only -----

function requireOwner(req) {
  if (roleOf(req) !== 'owner') throw new HttpError(403, 'Only the urn owner can do that.');
}

route('PUT', /^\/api\/memorial$/, async (req, res) => {
  requireOwner(req);
  const b = await readJson(req);
  const m = db.memorial;
  if ('name' in b) { const n = clean(b.name, 120); if (n) m.name = n; }
  if ('nickname' in b) m.nickname = clean(b.nickname, 60);
  if ('tribute' in b) m.tribute = clean(b.tribute, 600);
  if ('born' in b) m.born = parseDate(b.born) ? b.born : '';
  if ('died' in b) m.died = parseDate(b.died) ? b.died : '';
  if ('coverId' in b) m.coverId = db.items.some((i) => i.id === b.coverId) ? b.coverId : null;
  if (b.settings) {
    const s = db.settings;
    if (/^\d{2}:\d{2}$/.test(b.settings.nightStart || '')) s.nightStart = b.settings.nightStart;
    if (/^\d{2}:\d{2}$/.test(b.settings.nightEnd || '')) s.nightEnd = b.settings.nightEnd;
    if (+b.settings.slideSeconds >= 3 && +b.settings.slideSeconds <= 120) s.slideSeconds = +b.settings.slideSeconds;
  }
  await saveDb();
  broadcast({ type: 'update' });
  send(res, 200, memorialView('owner'));
});

route('PUT', /^\/api\/codes$/, async (req, res) => {
  requireOwner(req);
  const b = await readJson(req);
  if (b.familyCode) {
    if (normCode(b.familyCode).length < 4) throw new HttpError(400, 'The family code needs at least 4 characters.');
    db.auth.family = hashCode(b.familyCode);
  }
  if (b.ownerCode) {
    if (normCode(b.ownerCode).length < 6) throw new HttpError(400, 'The owner code needs at least 6 characters.');
    db.auth.owner = hashCode(b.ownerCode);
  }
  // Rotating the secret signs everyone out, so old phones need the new code.
  db.auth.secret = crypto.randomBytes(32).toString('hex');
  await saveDb();
  send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('owner') });
});

route('GET', /^\/api\/dates$/, (req, res) => {
  if (!canView(roleOf(req))) throw new HttpError(401, 'Please enter the family code.');
  send(res, 200, { dates: allDates(db.memorial, db.dates) });
});

route('POST', /^\/api\/dates$/, async (req, res) => {
  requireOwner(req);
  const b = await readJson(req);
  const label = clean(b.label, 80);
  if (!label || !parseDate(b.date)) throw new HttpError(400, 'Please give the date a name and a valid date.');
  const type = ['birthday', 'anniversary', 'other'].includes(b.type) ? b.type : 'other';
  db.dates.push({ id: newId(), type, label, date: b.date });
  await saveDb();
  broadcast({ type: 'update' });
  send(res, 200, { dates: allDates(db.memorial, db.dates) });
});

route('DELETE', /^\/api\/dates\/([0-9a-f]+)$/, async (req, res, url, m) => {
  requireOwner(req);
  db.dates = db.dates.filter((d) => d.id !== m[1]);
  await saveDb();
  broadcast({ type: 'update' });
  send(res, 200, { dates: allDates(db.memorial, db.dates) });
});

route('DELETE', /^\/api\/items\/([0-9a-f]+)$/, async (req, res, url, m) => {
  requireOwner(req);
  const item = db.items.find((i) => i.id === m[1]);
  if (!item) throw new HttpError(404, 'Not found');
  db.items = db.items.filter((i) => i !== item);
  if (db.memorial.coverId === item.id) db.memorial.coverId = null;
  await saveDb();
  if (item.file) await fsp.rm(path.join(MEDIA_DIR, item.file), { force: true });
  broadcast({ type: 'update' });
  send(res, 200, { ok: true });
});

// Physical controls on the urn (GPIO button, simulator) send actions here.
route('POST', /^\/api\/device\/action$/, async (req, res) => {
  const role = roleOf(req);
  if (role !== 'device' && role !== 'owner') throw new HttpError(403, 'Only the urn itself can do that.');
  const { action } = await readJson(req);
  if (!['voice', 'next', 'prev', 'wake'].includes(action)) throw new HttpError(400, 'Unknown action');
  broadcast({ type: 'action', action });
  send(res, 200, { ok: true });
});

// Simulator only: fill an empty keepsake with sample content.
route('POST', /^\/api\/demo$/, async (req, res) => {
  if (!isLocal(req)) throw new HttpError(403, 'Demo content can only be loaded on the keepsake itself.');
  if (db.memorial) throw new HttpError(409, 'This keepsake already has a person set up. Delete the data folder to start over.');
  const demo = demoContent();
  db.memorial = { ...demo.memorial, coverId: null };
  db.auth = { secret: crypto.randomBytes(32).toString('hex'), family: hashCode(demo.familyCode), owner: hashCode(demo.ownerCode) };
  db.dates = demo.dates.map((d) => ({ id: newId(), ...d }));
  const now = Date.now();
  for (const [i, it] of demo.items.entries()) {
    const id = newId();
    const item = { id, kind: it.kind, from: it.from, caption: it.caption || '', createdAt: new Date(now - i * 3600000).toISOString() };
    if (it.text) item.text = it.text;
    if (it.file) {
      item.file = id + it.file.ext;
      item.mime = it.file.mime;
      await fsp.writeFile(path.join(MEDIA_DIR, item.file), it.file.buf);
    }
    if (it.duration) item.duration = it.duration;
    if (it.cover) db.memorial.coverId = id;
    db.items.push(item);
  }
  await saveDb();
  broadcast({ type: 'update' });
  send(res, 200, { familyCode: demo.familyCode, ownerCode: demo.ownerCode });
});

route('GET', /^\/qr\.svg$/, (req, res, url) => {
  const page = url.searchParams.get('page') === 'admin' ? 'admin' : 'family';
  const target = lanUrls(page)[0] || `http://localhost:${PORT}/${page}`;
  send(res, 200, qrSvg(target), { 'Content-Type': 'image/svg+xml', 'X-QR-Target': target });
});

route('GET', /^\/media\/([0-9a-f]+\.[a-z0-9]+)$/, async (req, res, url, m) => {
  if (!canView(roleOf(req))) throw new HttpError(401, 'Please enter the family code.');
  const item = db.items.find((i) => i.file === m[1]);
  if (!item) throw new HttpError(404, 'Not found');
  await serveFile(req, res, path.join(MEDIA_DIR, item.file), item.mime, 'private, max-age=31536000, immutable');
});

route('GET', /^\/static\/([\w.-]+)$/, async (req, res, url, m) => {
  await serveFile(req, res, path.join(PUBLIC_DIR, m[1]), STATIC_TYPES[path.extname(m[1])] || 'application/octet-stream');
});

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (method === 'GET' && PAGES[url.pathname]) {
    return serveFile(req, res, path.join(PUBLIC_DIR, PAGES[url.pathname]), STATIC_TYPES['.html']);
  }
  for (const r of routes) {
    const m = r.pattern.exec(url.pathname);
    if (m && r.method === method) return r.handler(req, res, url, m);
  }
  send(res, 404, { error: 'Not found' });
}

function start() {
  loadDb();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Something went wrong on the urn.' : err.message });
      else res.end();
    });
  });
  server.listen(PORT, () => {
    console.log(`Smart urn running on port ${PORT}`);
    console.log(`  Simulator:   http://localhost:${PORT}/sim`);
    console.log(`  Urn screen:  http://localhost:${PORT}/device`);
    console.log(`  Owner setup: http://localhost:${PORT}/admin`);
    for (const u of lanUrls()) console.log(`  Family app:  ${u}`);
  });
  return server;
}

if (require.main === module) start();
module.exports = { start };
