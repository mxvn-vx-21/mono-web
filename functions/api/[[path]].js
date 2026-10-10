import postgres from 'postgres';

/* ---------- Schema (also in schema.sql) ---------- */
const SCHEMA = `create table if not exists folders (
  id bigserial primary key,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists folders_name_uq on folders (lower(name));

create table if not exists tasks (
  id bigserial primary key,
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  due_date date,
  due_time integer check (due_time between 0 and 1439),
  priority smallint not null default 1 check (priority between 0 and 2),
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notes (
  id bigserial primary key,
  title text not null default '',
  content jsonb not null default '{"v":1,"blocks":[]}',
  is_pinned boolean not null default false,
  folder_id bigint references folders(id) on delete set null,
  content_format_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_folder_idx on notes (folder_id);

create table if not exists countdowns (
  id bigserial primary key,
  title text not null check (length(btrim(title)) > 0),
  target_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);`;

/* Dates stay 'YYYY-MM-DD' strings and ids stay numbers (no timezone shifts). */
const TYPES = {
  bigint: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) },
  date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x },
};

const TABLES = ['tasks', 'notes', 'folders', 'countdowns'];
const COOKIE = 'mono_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const enc = new TextEncoder();
let schemaReady;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

/* ---------- Validation ---------- */
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min, max, name) => {
  if (!Number.isInteger(v) || v < min || v > max) throw bad(`${name} is invalid`);
  return v;
};
const date = (v, nullable) => {
  if (v == null || v === '') { if (nullable) return null; throw bad('A date is required'); }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad('Invalid date');
  return v;
};

function clean(table, b, partial) {
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const o = {};
  if (table === 'tasks') {
    if (!partial || has('title')) { const v = str(b.title, 300); if (!v) throw bad('Please give your task a title.'); o.title = v; }
    if (has('description')) o.description = str(b.description, 5000);
    if (has('due_date')) o.due_date = date(b.due_date, true);
    if (has('due_time')) o.due_time = b.due_time == null ? null : int(b.due_time, 0, 1439, 'due_time');
    if (o.due_date === null) o.due_time = null;
    if (has('priority')) o.priority = int(b.priority, 0, 2, 'priority');
    if (has('is_completed')) o.is_completed = !!b.is_completed;
  } else if (table === 'notes') {
    if (has('title')) o.title = str(b.title, 300);
    if (has('content')) {
      const arr = b.content && Array.isArray(b.content.blocks) ? b.content.blocks.slice(0, 5000) : null;
      if (!arr) throw bad('Invalid note content');
      o.content = {
        v: 1,
        blocks: arr.map((x) => ({
          t: 'PBNC'.includes(x && x.t) && x.t ? x.t : 'P',
          x: String((x && x.x) ?? '').slice(0, 20000),
          c: !!(x && x.c), b: !!(x && x.b), i: !!(x && x.i),
        })),
      };
      o.content_format_version = 1;
    }
    if (has('is_pinned')) o.is_pinned = !!b.is_pinned;
    if (has('folder_id')) o.folder_id = b.folder_id == null ? null : int(b.folder_id, 1, Number.MAX_SAFE_INTEGER, 'folder_id');
  } else if (table === 'folders') {
    const v = str(b.name, 80);
    if (!v) throw bad('Please enter a name.');
    o.name = v;
  } else if (table === 'countdowns') {
    if (!partial || has('title')) { const v = str(b.title, 300); if (!v) throw bad('Please add a title.'); o.title = v; }
    if (!partial || has('target_date')) o.target_date = date(b.target_date, false);
  }
  if (!Object.keys(o).length) throw bad('Nothing to update');
  return o;
}

/* ---------- Auth (single passcode -> signed, HttpOnly cookie) ---------- */
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function authed(request, env) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, await hmac(env.SESSION_SECRET, exp));
}
const cookie = (value, maxAge) => `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

/* ---------- DB helpers ---------- */
async function create(sql, table, body) {
  const o = clean(table, body, false);
  if (o.content) o.content = sql.json(o.content);
  const [row] = await sql`insert into ${sql(table)} ${sql(o)} returning *`;
  return row;
}
async function update(sql, table, id, body) {
  const o = clean(table, body, true);
  const keys = Object.keys(o);
  // Pinning / moving a note must not bump "last updated".
  if (!(table === 'notes' && keys.every((k) => k === 'is_pinned' || k === 'folder_id'))) o.updated_at = new Date();
  if (o.content) o.content = sql.json(o.content);
  const [row] = await sql`update ${sql(table)} set ${sql(o)} where id = ${id} returning *`;
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

export async function onRequest({ request, env, params, waitUntil }) {
  const url = new URL(request.url);
  const seg = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const method = request.method;
  let sql;
  try {
    if (!env.APP_PASSCODE || !env.SESSION_SECRET) throw new HttpError(503, 'Server not configured: set APP_PASSCODE and SESSION_SECRET.');
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = request.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Bad origin');
    }

    if (seg[0] === 'auth') {
      if (seg[1] === 'session') return json({ authed: await authed(request, env) });
      if (seg[1] === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
      if (seg[1] === 'login' && method === 'POST') {
        const { passcode } = await request.json().catch(() => ({}));
        const a = await hmac(env.SESSION_SECRET, 'pw:' + String(passcode ?? ''));
        const b = await hmac(env.SESSION_SECRET, 'pw:' + env.APP_PASSCODE);
        if (!same(a, b)) { await new Promise((r) => setTimeout(r, 600)); throw new HttpError(401, 'Wrong passcode.'); }
        const exp = String(Date.now() + SESSION_MS);
        return json({ authed: true }, 200, { 'Set-Cookie': cookie(`${exp}.${await hmac(env.SESSION_SECRET, exp)}`, SESSION_MS / 1000) });
      }
      throw new HttpError(404, 'Not found');
    }

    if (!(await authed(request, env))) throw new HttpError(401, 'Please sign in.');
    if (!env.HYPERDRIVE) throw new HttpError(503, 'Hyperdrive binding "HYPERDRIVE" is missing.');
    sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false, types: TYPES });
    schemaReady ||= sql.unsafe(SCHEMA).catch((e) => { schemaReady = undefined; throw e; });
    await schemaReady;

    if (seg[0] === 'state' && method === 'GET') {
      const [tasks, notes, folders, countdowns] = await Promise.all([
        sql`select * from tasks order by id`,
        sql`select * from notes order by is_pinned desc, updated_at desc`,
        sql`select * from folders order by lower(name)`,
        sql`select * from countdowns order by target_date, id`,
      ]);
      return json({ tasks, notes, folders, countdowns });
    }
    if (seg[0] === 'all' && method === 'DELETE') {
      await sql`truncate tasks, notes, folders, countdowns restart identity`;
      return json({ ok: true });
    }
    if (TABLES.includes(seg[0])) {
      const table = seg[0];
      if (seg.length === 1 && method === 'POST') return json(await create(sql, table, await request.json().catch(() => { throw bad('Invalid JSON'); })), 201);
      const id = Number(seg[1]);
      if (seg.length === 2 && Number.isInteger(id) && id > 0) {
        if (method === 'PUT') return json(await update(sql, table, id, await request.json().catch(() => { throw bad('Invalid JSON'); })));
        if (method === 'DELETE') { await sql`delete from ${sql(table)} where id = ${id}`; return json({ ok: true }); }
      }
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e && e.code === '23505') return json({ error: 'A folder with that name already exists.' }, 409);
    if (e && e.code === '23503') return json({ error: 'That folder no longer exists.' }, 400);
    console.error('API error', e);
    return json({ error: 'Database error. Please try again.' }, 500);
  } finally {
    if (sql) waitUntil(sql.end());
  }
}
