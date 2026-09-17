// ─── Set-Build Materials List ────────────────────────────────────────────────
// A tiny, zero-dependency Node server for a show's build/props shopping list.
// Two tiers, exactly like the audition app:
//
//   • Anyone with the link can SEE the list and ADD to it. Nothing else.
//   • Editing, removing and undoing live behind an access key on a separate page.
//
// No framework, no database service, nothing to `npm install`. Runs on any Node 18+.
//
//   PUBLIC PAGE   GET  /                       the list + "add an item" form
//   MANAGE PAGE   GET  /manage                 key-gated editing (alias /staff, /admin)
//
//   PUBLIC API    GET    /api/list             the list + pick-lists (no key)
//                 GET    /api/list.csv         the list as a spreadsheet (no key)
//                 POST   /api/items            add an item (no key, rate limited)
//
//   STAFF API     GET    /api/staff/list       list + the undo bin
//                 PATCH  /api/staff/items/:id  edit an item (send only what changed)
//                 DELETE /api/staff/items/:id  remove an item (kept in the undo bin)
//                 POST   /api/staff/restore    undo a removal
//                 POST   /api/staff/settings   edit the list's title / notes
//                 POST   /api/staff/key        rotate the access key

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT        = process.env.PORT || 3000;
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE   = path.join(DATA_DIR, 'materials.json');
const PUBLIC_DIR  = path.join(__dirname, 'public');
const DEFAULT_KEY = process.env.MATERIALS_KEY || 'AFGM-build';

// Optional off-box mirror. If set, every change is also pushed to a key-gated blob
// endpoint elsewhere, and a machine that boots with an empty disk restores from it.
// Unset = the app is entirely self-contained (plain local file storage).
const BACKUP_URL = process.env.BACKUP_URL || '';
const BACKUP_KEY = process.env.BACKUP_KEY || '';

// ── The list's vocabulary ────────────────────────────────────────────────────
const CATEGORIES = ['Lumber', 'Hardware', 'Paint & Finish', 'Tools & Equipment',
  'Props & Dressing', 'Fabric & Soft Goods', 'Electrical', 'Other'];
const STATUSES = ['Needed', 'Have it', 'Purchased'];
const UNASSIGNED = 'Unassigned';
// Common set pieces for this show — autocomplete suggestions only. Anyone can type a
// new one, and the pick-list always includes whatever is actually in use.
const AREA_HINTS = ['Jessup\'s desk', 'Judge\'s box', 'Balcony', 'Courtroom', 'Barracks',
  'Kaffee\'s office', 'Platform / deck', 'Stairs', 'Backdrop', 'General structure'];

// The starting list. Only ever used for a store that has never existed.
function seedItems() {
  const now = new Date().toISOString();
  const rows = [
    ['Paint sprayer', 1, 'each', 'Tools & Equipment', '', ''],
    ['Paint supplies (rollers, brushes, trays, drop cloths, tape)', 1, 'set', 'Paint & Finish', '', ''],
    ['Paint', 5, 'gallons', 'Paint & Finish', 'Colors TBD', ''],
    ['4x4x10 post', 5, 'each', 'Lumber', '', ''],
    ['4x4x8 post', 2, 'each', 'Lumber', '', ''],
    ['2x4x12 lumber', 12, 'each', 'Lumber', '', ''],
    ['1x4x10 lumber', 10, 'each', 'Lumber', '', ''],
    ['Luan plywood sheet', 10, 'sheets', 'Lumber', '', ''],
    ['Stair stringer — 1.5 in. x 11.25 in. W x 3 ft. L', 4, 'each', 'Lumber', 'Ace item 5037383', 'https://www.acehardware.com/p/5037383'],
    ['Stair stringer — 1.5 in. x 11.25 in. W x 4 ft. L', 2, 'each', 'Lumber', 'Ace item 5037383 (4 ft. length)', 'https://www.acehardware.com/p/5037383'],
    ['Stair tread — 36 in. L x 11.25 in. W x 1.0625 in.', 9, 'each', 'Lumber', '', ''],
    ['3 in. deck screws — hex or torx head', 1, 'box', 'Hardware', '', ''],
    ['8 in. lag bolts', 1, 'box', 'Hardware', '', ''],
    ['Chain — 2 ft.', 2, 'each', 'Hardware', '', ''],
  ];
  return rows.map(([name, qty, unit, category, notes, link]) => ({
    id: crypto.randomUUID(), name, qty, unit, area: UNASSIGNED, category,
    notes: notes || null, link: link || null, est_cost: null, status: 'Needed',
    added_by: null, created_at: now, updated_at: now,
  }));
}

function freshStore() {
  return {
    settings: {
      title: 'A Few Good Men — Set Build Materials',
      subtitle: 'Rialto Community Art Center',
      notes: 'Add anything the build needs. Say what it\'s for (Jessup\'s desk, the judge\'s box, the balcony…) so the list can be sorted by set piece on build day.',
      staff_key: DEFAULT_KEY,
    },
    // { id, name, qty, unit, area, category, notes, link, est_cost, status,
    //   added_by, created_at, updated_at }
    items: seedItems(),
    trash: [], // last 25 removals, so an accidental tap is recoverable
  };
}

// ── Storage: one JSON file, atomic writes, serialized so writes never interleave ──
function normalize(d) {
  const base = freshStore();
  const out = {};
  out.settings = Object.assign(base.settings, d && d.settings || {});
  if (!out.settings.staff_key) out.settings.staff_key = DEFAULT_KEY;
  // Present (even as an empty array) → leave it alone, so a list someone deliberately
  // cleared never refills itself. Absent → this store has never existed: seed it.
  out.items = d && Array.isArray(d.items) ? d.items : base.items;
  out.trash = d && Array.isArray(d.trash) ? d.trash : [];
  return out;
}
function load() {
  try { return normalize(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
  catch (e) { return freshStore(); }
}
let store = load();
let hadLocalFile = fs.existsSync(DATA_FILE);
let writes = 0; // any write since boot blocks a late restore from clobbering it

let writeChain = Promise.resolve();
function save() {
  writes++;
  const snapshot = JSON.stringify(store);
  writeChain = writeChain.then(() => new Promise((res) => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, snapshot);
      fs.renameSync(tmp, DATA_FILE); // atomic replace — a crash mid-write can't corrupt it
    } catch (e) { console.error('save error:', e.message); }
    res();
  }));
  pushBackup();
  return writeChain;
}

// ── Optional off-box mirror ──────────────────────────────────────────────────
// The rule that matters: this machine may only overwrite the stored copy once it
// knows what that copy contains. A boot that can't read the mirror pushes nothing,
// because the list it is holding may be nothing but the seeded starter items.
const MIRRORED  = Boolean(BACKUP_URL && BACKUP_KEY);
let restoreDone = !MIRRORED || hadLocalFile; // a disk that survived needs no restore
let mirrorShut  = false;                     // a failed read closes the mirror for this boot
let pushWaiting = false;
let pushTimer   = null;

function pushBackup(now) {
  if (!MIRRORED || mirrorShut) return;
  if (!restoreDone) { pushWaiting = true; return; } // don't race the restore
  if (pushTimer) clearTimeout(pushTimer);
  const send = () => {
    pushTimer = null;
    const body = JSON.stringify(store);
    return fetch(BACKUP_URL, {
      method: 'PUT',
      headers: { 'x-staff-key': BACKUP_KEY, 'Content-Type': 'application/json' },
      body,
    }).catch((e) => console.error('backup push failed:', e.message));
  };
  if (now) return send();
  pushTimer = setTimeout(send, 2000); // debounce a burst of edits into one push
}

async function restoreFromBackup() {
  if (restoreDone) return;
  try {
    const r = await fetch(BACKUP_URL, { headers: { 'x-staff-key': BACKUP_KEY } });
    if (r.status === 404) {
      console.log('mirror is empty — starting fresh'); // first boot, nothing stored yet
    } else if (!r.ok) {
      throw new Error('mirror answered ' + r.status);
    } else {
      const d = await r.json();
      if (!d || !Array.isArray(d.items)) throw new Error('mirror held nothing usable');
      if (writes) {                    // someone already added something on this boot
        console.log('skipped restore — this list was already written to');
      } else {
        store = normalize(d);
        console.log('restored ' + store.items.length + ' items from the mirror');
      }
    }
    restoreDone = true;
    if (!hadLocalFile && !writes) save(); // put the restored copy on the local disk
    if (pushWaiting) { pushWaiting = false; pushBackup(); }
  } catch (e) {
    // Pushing now could replace a perfectly good stored copy with the starter list.
    mirrorShut = true;
    console.error('restore failed, so nothing will be pushed to the mirror this run:', e.message);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const uuid = () => crypto.randomUUID();
function s(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
}
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    // Collected as buffers, not strings: an accented character or an em dash can be
    // split across two chunks, and concatenating the halves as text would mangle it.
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 65536) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── Add rate limit: a whole build crew may share one wifi, so this is generous —
// it exists to stop a runaway loop, not to gate a busy work night. 400 / hour / IP.
const hits = new Map();
function allowAdd(ip) {
  const now = Date.now(), win = 3600000, max = 400;
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  if (arr.length >= max) { hits.set(ip, arr); return false; }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 20000) for (const [k, v] of hits) if (v.every((t) => now - t > win)) hits.delete(k);
  return true;
}

// Read an item's fields off a request body. `base` supplies the current values on an
// edit, so a PATCH can send only what changed. Everything is coerced, never trusted.
function readItem(b, base) {
  const cur = base || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const out = {};
  out.name = has('name') ? s(b.name, 160) : cur.name;
  out.unit = has('unit') ? s(b.unit, 40) : (cur.unit || '');
  out.area = has('area') ? (s(b.area, 80) || UNASSIGNED) : (cur.area || UNASSIGNED);
  out.notes = has('notes') ? (s(b.notes, 800) || null) : (cur.notes || null);
  out.added_by = has('added_by') ? (s(b.added_by, 80) || null) : (cur.added_by || null);

  if (has('category')) {
    const c = s(b.category, 40);
    out.category = CATEGORIES.includes(c) ? c : 'Other';
  } else out.category = cur.category || 'Other';

  if (has('status')) {
    const st = s(b.status, 20);
    out.status = STATUSES.includes(st) ? st : 'Needed';
  } else out.status = cur.status || 'Needed';

  if (has('qty')) {
    const n = Number(b.qty);
    out.qty = Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100) / 100, 100000) : 1;
  } else out.qty = cur.qty == null ? 1 : cur.qty;

  if (has('est_cost')) {
    const n = Number(b.est_cost);
    out.est_cost = b.est_cost === '' || b.est_cost == null || !Number.isFinite(n) || n < 0
      ? null : Math.min(Math.round(n * 100) / 100, 1000000);
  } else out.est_cost = cur.est_cost == null ? null : cur.est_cost;

  if (has('link')) {
    const raw = s(b.link, 500);
    // Only http(s) links — never javascript:/data: URLs, which the page renders as anchors.
    out.link = /^https?:\/\/\S+$/i.test(raw) ? raw : null;
  } else out.link = cur.link || null;

  return out;
}

// Areas offered as autocomplete: the suggestions plus every area actually in use.
function areaList() {
  const seen = new Set(AREA_HINTS);
  for (const m of store.items) if (m.area && m.area !== UNASSIGNED) seen.add(m.area);
  return [...seen].sort((a, b) => a.localeCompare(b));
}
function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
function picks() {
  return { categories: CATEGORIES, statuses: STATUSES, areas: areaList(), unassigned: UNASSIGNED };
}

// ── Static page serving ──────────────────────────────────────────────────────
function sendFile(res, file, type) {
  fs.readFile(path.join(PUBLIC_DIR, file), (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

// ── Router ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  try {
    // Pages
    if (method === 'GET' && (p === '/' || p === '/list' || p === '/add')) {
      return sendFile(res, 'public.html', 'text/html; charset=utf-8');
    }
    if (method === 'GET' && (p === '/manage' || p === '/staff' || p === '/admin')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return sendFile(res, 'staff.html', 'text/html; charset=utf-8');
    }
    if (method === 'GET' && p === '/health') return sendJson(res, 200, { ok: true, items: store.items.length });

    // ── PUBLIC API (read the list, add to it — nothing else) ────────────────
    if (method === 'GET' && p === '/api/list') {
      return sendJson(res, 200, Object.assign({
        title: store.settings.title,
        subtitle: store.settings.subtitle,
        notes: store.settings.notes,
        items: store.items,
      }, picks()));
    }

    if (method === 'GET' && p === '/api/list.csv') {
      const cols = ['Item', 'Qty', 'Unit', 'For', 'Category', 'Status', 'Est. cost', 'Link', 'Notes', 'Added by', 'Added'];
      const lines = [cols.join(',')];
      for (const m of store.items) {
        lines.push([m.name, m.qty, m.unit, m.area, m.category, m.status,
          m.est_cost == null ? '' : m.est_cost, m.link, m.notes, m.added_by,
          (m.created_at || '').slice(0, 10)].map(csvCell).join(','));
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="materials-list.csv"',
        'Cache-Control': 'no-store',
      });
      return res.end(lines.join('\n'));
    }

    if (method === 'POST' && p === '/api/items') {
      if (!allowAdd(clientIp(req)))
        return sendJson(res, 429, { error: 'Too many additions from this network right now. Please wait a moment.' });
      if (store.items.length >= 2000)
        return sendJson(res, 409, { error: 'This list is full (2,000 items). Ask the build lead to clear some out.' });
      const b = await readBody(req);
      const f = readItem(b, null);
      f.status = 'Needed'; // public adds always land as "Needed" — status is the build lead's call
      if (!f.name) return sendJson(res, 400, { error: 'Please name the item.' });
      const now = new Date().toISOString();
      const item = Object.assign({ id: uuid() }, f, { created_at: now, updated_at: now });
      store.items.push(item);
      save();
      return sendJson(res, 200, { ok: true, item });
    }

    // ── STAFF API (all require the key) ─────────────────────────────────────
    if (p.startsWith('/api/staff')) {
      const provided = req.headers['x-staff-key'] || url.searchParams.get('key') || '';
      if (!provided || provided !== store.settings.staff_key)
        return sendJson(res, 401, { error: 'Invalid access key.' });

      if (method === 'GET' && p === '/api/staff/list') {
        return sendJson(res, 200, Object.assign({
          title: store.settings.title,
          subtitle: store.settings.subtitle,
          notes: store.settings.notes,
          items: store.items,
          trash: store.trash,
        }, picks()));
      }

      if (method === 'PATCH' && p.startsWith('/api/staff/items/')) {
        const id = decodeURIComponent(p.slice('/api/staff/items/'.length));
        const item = store.items.find((m) => m.id === id);
        if (!item) return sendJson(res, 404, { error: 'That item is no longer on the list.' });
        const f = readItem(await readBody(req), item);
        if (!f.name) return sendJson(res, 400, { error: 'Please name the item.' });
        Object.assign(item, f, { updated_at: new Date().toISOString() });
        save();
        return sendJson(res, 200, { ok: true, item });
      }

      if (method === 'DELETE' && p.startsWith('/api/staff/items/')) {
        const id = decodeURIComponent(p.slice('/api/staff/items/'.length));
        const i = store.items.findIndex((m) => m.id === id);
        if (i === -1) return sendJson(res, 404, { error: 'That item is no longer on the list.' });
        const [gone] = store.items.splice(i, 1);
        store.trash.unshift(gone); // keep the last 25 removals so a mis-tap can be undone
        store.trash = store.trash.slice(0, 25);
        save();
        return sendJson(res, 200, { ok: true, id });
      }

      if (method === 'POST' && p === '/api/staff/restore') {
        const b = await readBody(req);
        const id = s(b.id, 60);
        const i = store.trash.findIndex((m) => m.id === id);
        if (i === -1) return sendJson(res, 404, { error: 'Nothing left to undo for that item.' });
        const [back] = store.trash.splice(i, 1);
        back.updated_at = new Date().toISOString();
        store.items.push(back);
        save();
        return sendJson(res, 200, { ok: true, item: back });
      }

      if (method === 'POST' && p === '/api/staff/settings') {
        const b = await readBody(req);
        if (Object.prototype.hasOwnProperty.call(b, 'title'))
          store.settings.title = s(b.title, 120) || store.settings.title;
        if (Object.prototype.hasOwnProperty.call(b, 'subtitle'))
          store.settings.subtitle = s(b.subtitle, 120);
        if (Object.prototype.hasOwnProperty.call(b, 'notes'))
          store.settings.notes = s(b.notes, 1200);
        save();
        return sendJson(res, 200, { ok: true, settings: store.settings });
      }

      if (method === 'POST' && p === '/api/staff/key') {
        const b = await readBody(req);
        const k = s(b.key, 80);
        if (k.length < 6) return sendJson(res, 400, { error: 'Use at least 6 characters.' });
        store.settings.staff_key = k;
        save();
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: 'Not found' });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    console.error(e);
    sendJson(res, 400, { error: 'Bad request.' });
  }
});

// Free hosting stops an idle machine with SIGTERM — flush the mirror before we go.
process.on('SIGTERM', () => {
  Promise.resolve(pushBackup(true)).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
});

server.listen(PORT, () => {
  console.log('Materials list running on http://localhost:' + PORT);
  console.log('  public list/add : /');
  console.log('  manage (key)    : /manage   key: ' + store.settings.staff_key);
  restoreFromBackup();
});
