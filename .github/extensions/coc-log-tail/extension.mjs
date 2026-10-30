// CoC Log Tail: follows the CoC server and desktop logs, filters them, and sends a
// chosen line with nearby lines into the current conversation.
//
// Hosted by CoC's canvas extension runtime (one process per conversation). Single file on
// purpose: discovery hashes only extension.mjs and package.json, so a sibling module edit
// would not restart running hosts.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promises as fs, constants as fsConstants } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import * as os from 'node:os';
import * as path from 'node:path';
import { joinSession, createCanvas, CanvasError } from '@github/copilot-sdk/extension';

const BACKLOG_BYTES = 256 * 1024;
const MAX_READ_BYTES = 4 * 1024 * 1024;
const RING_SIZE = 5000;
const POLL_MS = Number(process.env.COC_LOG_TAIL_POLL_MS) || 500;
const RAW_CAP = 16 * 1024;
const EXCERPT_CAP = 8 * 1024;
const EXCERPT_BEFORE = 10;
const EXCERPT_AFTER = 5;
const LEVELS = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };

// The host sets COPILOT_HOME=<dataDir>/canvas-ext/home; the cwd is the repository, never the data dir.
const dataDir = process.env.COPILOT_HOME
    ? path.dirname(path.dirname(process.env.COPILOT_HOME))
    : path.join(os.homedir(), '.coc');
const logDir = path.join(dataDir, 'logs');
// ai-service.ndjson duplicates coc-service.ndjson today, so read one file and filter on `store`.
const SOURCES = {
    server: { file: path.join(logDir, 'coc-service.ndjson'), label: 'coc-service.ndjson' },
    desktop: { file: path.join(logDir, 'coc-desktop.log'), label: 'coc-desktop.log' },
};

function parseLine(src, raw) {
    const text = raw.length > RAW_CAP ? `${raw.slice(0, RAW_CAP)}…` : raw;
    if (raw.startsWith('{')) {
        try {
            const o = JSON.parse(raw);
            if (o && typeof o === 'object') {
                // The desktop log echoes the server's pino lines; keep them only in the server source.
                if (src === 'desktop' && o.store) return null;
                const { level, time, msg, store, pid, hostname, ...fields } = o;
                return {
                    src, level: Number(level) || 30, time: Number(time) || Date.now(),
                    store: typeof store === 'string' ? store : '', msg: String(msg ?? ''),
                    err: o.err?.message ? String(o.err.message) : '', fields, raw: text,
                };
            }
        } catch { /* plain text */ }
    }
    if (!raw.trim()) return null;
    const level = /\b(error|fatal|uncaught|exception)\b/i.test(raw) ? 50 : /\bwarn(ing)?\b/i.test(raw) ? 40 : 30;
    return { src, level, time: Date.now(), store: src === 'desktop' ? 'desktop' : '', msg: text, err: '', fields: {}, raw: text };
}

// ---- tailing ----

let nextId = 1;
const ring = [];
const listeners = new Set();

function push(entries) {
    if (!entries.length) return;
    for (const entry of entries) ring.push({ id: nextId++, ...entry });
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
    const added = ring.slice(-entries.length);
    for (const listener of listeners) listener(added);
}

class Tail {
    constructor(src, file) {
        this.src = src;
        this.file = file;
        this.ino = null;
        this.offset = -1;
        this.decoder = new StringDecoder('utf8');
        this.partial = '';
        this.dropFirst = false;
        this.chain = Promise.resolve();
        this.timer = null;
    }

    start() {
        if (this.timer) return;
        this.poll();
        this.timer = setInterval(() => this.poll(), POLL_MS);
        this.timer.unref?.();
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }

    poll() {
        this.chain = this.chain.then(() => this.read()).catch(error => {
            if (error?.code !== 'ENOENT') console.error(`[coc-log-tail] ${this.src}: ${error?.message ?? error}`);
        });
        return this.chain;
    }

    reset(offset) {
        this.offset = offset;
        this.decoder = new StringDecoder('utf8');
        this.partial = '';
        this.dropFirst = offset > 0;
    }

    async read() {
        const stat = await fs.stat(this.file);
        if (this.offset < 0) this.reset(Math.max(0, stat.size - BACKLOG_BYTES));
        // Rotation (new inode) or truncation: start over from the top of the new file.
        else if ((this.ino !== null && stat.ino !== this.ino) || stat.size < this.offset) this.reset(0);
        this.ino = stat.ino;
        if (stat.size - this.offset > MAX_READ_BYTES) this.reset(stat.size - BACKLOG_BYTES);
        if (stat.size === this.offset) return;
        const handle = await fs.open(this.file, fsConstants.O_RDONLY);
        try {
            const length = stat.size - this.offset;
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
            this.offset += bytesRead;
            const lines = (this.partial + this.decoder.write(buffer.subarray(0, bytesRead))).split('\n');
            this.partial = lines.pop();
            if (this.dropFirst) { lines.shift(); this.dropFirst = false; }
            push(lines.map(line => parseLine(this.src, line.replace(/\r$/, ''))).filter(Boolean));
        } finally {
            await handle.close();
        }
    }
}

const tails = Object.entries(SOURCES).map(([src, { file }]) => new Tail(src, file));

async function ensureTailing() {
    for (const tail of tails) tail.start();
    await Promise.all(tails.map(tail => tail.chain));
}

// ---- queries ----

function matcher(query) {
    if (!query) return () => true;
    const regex = /^\/(.+)\/([a-z]*)$/.exec(query);
    if (regex) {
        let pattern;
        try { pattern = new RegExp(regex[1], regex[2].replace(/[gy]/g, '')); }
        catch { throw new CanvasError('bad_query', `Invalid regex: ${query}`); }
        return entry => pattern.test(entry.raw);
    }
    const needle = query.toLowerCase();
    return entry => entry.raw.toLowerCase().includes(needle);
}

function filterEntries({ query, level = 0, source = 'all', store = 'all', since = 0 } = {}) {
    const match = matcher(query);
    return ring.filter(entry => entry.level >= level && entry.time >= since
        && (source === 'all' || entry.src === source)
        && (store === 'all' || entry.store === store) && match(entry));
}

const compact = entry => ({
    id: entry.id, source: entry.src, time: new Date(entry.time).toISOString(),
    level: LEVELS[entry.level] ?? String(entry.level), store: entry.store,
    msg: entry.err ? `${entry.msg}: ${entry.err}` : entry.msg,
});

const clampLimit = (value, fallback) => Math.max(1, Math.min(500, Number(value) || fallback));

function buildExcerpt(id) {
    const index = ring.findIndex(entry => entry.id === Number(id));
    if (index < 0) throw new CanvasError('not_found', `Log entry ${id} is no longer in the buffer`);
    const target = ring[index];
    const same = ring.filter(entry => entry.src === target.src);
    const at = same.indexOf(target);
    let before = same.slice(Math.max(0, at - EXCERPT_BEFORE), at);
    const after = same.slice(at + 1, at + 1 + EXCERPT_AFTER);
    const header = `CoC log excerpt (${SOURCES[target.src].label}, ${new Date(target.time).toISOString()}):`;
    const render = () => [header, '', '```', ...before.map(e => e.raw), `>>> ${target.raw}`, ...after.map(e => e.raw), '```'].join('\n');
    let text = render();
    // Drop context before the line first, then after it, to stay under the cap.
    while (text.length > EXCERPT_CAP && before.length) { before = before.slice(1); text = render(); }
    while (text.length > EXCERPT_CAP && after.length) { after.pop(); text = render(); }
    if (text.length > EXCERPT_CAP) text = `${text.slice(0, EXCERPT_CAP - 4)}…\n\`\`\``;
    return text;
}

// ---- canvas instances ----

const instances = new Map();
let session;

function broadcast(instance, event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const stream of instance.streams) stream.write(frame);
}

async function readJson(request) {
    let body = '';
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 64 * 1024) throw new Error('Body too large');
    }
    return JSON.parse(body || '{}');
}

function sendJson(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
}

async function handle(instance, request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(PAGE);
        return;
    }
    if (request.method === 'GET' && url.pathname === '/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        response.write(`event: filter\ndata: ${JSON.stringify(instance.filter)}\n\n`);
        response.write(`event: entries\ndata: ${JSON.stringify(ring)}\n\n`);
        instance.streams.add(response);
        request.on('close', () => instance.streams.delete(response));
        return;
    }
    if (request.method === 'GET' && url.pathname === '/excerpt') {
        sendJson(response, 200, { text: buildExcerpt(url.searchParams.get('id')) });
        return;
    }
    if (request.method === 'POST' && url.pathname === '/send') {
        // A JSON content type forces a CORS preflight, so other loopback pages cannot post here.
        if (!String(request.headers['content-type']).startsWith('application/json')) {
            sendJson(response, 415, { error: 'Expected application/json' });
            return;
        }
        const { id } = await readJson(request);
        const messageId = await session.send(buildExcerpt(id));
        sendJson(response, 200, { messageId });
        return;
    }
    sendJson(response, 404, { error: 'Not found' });
}

function instanceFor(ctx) {
    const instance = instances.get(ctx.instanceId);
    if (!instance) throw new CanvasError('not_open', 'Open the log-tail canvas first');
    return instance;
}

const canvas = createCanvas({
    id: 'log-tail',
    displayName: 'CoC Log Tail',
    description: 'Live CoC server and desktop logs with filters; send a log line with context into the chat.',
    inputSchema: {
        type: 'object',
        properties: {
            level: { type: 'number', description: 'Minimum pino level: 10 trace … 50 error, 60 fatal' },
            query: { type: 'string', description: 'Substring, or /regex/flags' },
            source: { type: 'string', enum: ['server', 'desktop', 'all'] },
        },
    },
    async open(ctx) {
        if (!instances.has(ctx.instanceId)) {
            const instance = {
                filter: { level: 30, query: '', source: 'server', store: 'all', ...(ctx.input ?? {}) },
                streams: new Set(),
            };
            instance.listener = added => broadcast(instance, 'entries', added);
            instance.server = createServer((request, response) => {
                handle(instance, request, response).catch(error => {
                    if (!response.headersSent) sendJson(response, error instanceof CanvasError ? 404 : 500, { error: error.message });
                    else response.end();
                });
            });
            instance.server.listen(0, '127.0.0.1');
            await once(instance.server, 'listening');
            listeners.add(instance.listener);
            instances.set(ctx.instanceId, instance);
        }
        await ensureTailing();
        return { title: 'CoC logs', url: `http://127.0.0.1:${instances.get(ctx.instanceId).server.address().port}/` };
    },
    actions: [
        {
            name: 'recent_errors',
            description: 'List error and fatal log lines from the last N minutes, newest last.',
            inputSchema: { type: 'object', properties: {
                minutes: { type: 'number', default: 10 }, limit: { type: 'number', default: 20 },
                source: { type: 'string', enum: ['server', 'desktop', 'all'], default: 'all' },
            } },
            async handler(ctx) {
                await ensureTailing();
                const { minutes = 10, limit, source = 'all' } = ctx.input ?? {};
                const since = Date.now() - Number(minutes) * 60_000;
                return filterEntries({ level: 50, source, since }).slice(-clampLimit(limit, 20)).map(compact);
            },
        },
        {
            name: 'search',
            description: 'Search buffered log lines by substring or /regex/flags, newest last.',
            inputSchema: { type: 'object', required: ['query'], properties: {
                query: { type: 'string' }, level: { type: 'number' }, limit: { type: 'number', default: 50 },
                source: { type: 'string', enum: ['server', 'desktop', 'all'], default: 'all' },
            } },
            async handler(ctx) {
                await ensureTailing();
                const { query, level = 0, source = 'all', limit } = ctx.input ?? {};
                return filterEntries({ query, level: Number(level), source }).slice(-clampLimit(limit, 50)).map(compact);
            },
        },
        {
            name: 'excerpt',
            description: 'Return a log line by id with the lines around it, as sent by Send to chat.',
            inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'number' } } },
            handler: ctx => buildExcerpt(ctx.input?.id),
        },
        {
            name: 'set_filter',
            description: 'Change the filter shown in the open log view.',
            inputSchema: { type: 'object', properties: {
                level: { type: 'number' }, query: { type: 'string' },
                source: { type: 'string', enum: ['server', 'desktop', 'all'] }, store: { type: 'string' },
            } },
            handler(ctx) {
                const instance = instanceFor(ctx);
                const { level, query, source, store } = ctx.input ?? {};
                instance.filter = { ...instance.filter, ...Object.fromEntries(
                    Object.entries({ level, query, source, store }).filter(([, value]) => value !== undefined)) };
                broadcast(instance, 'filter', instance.filter);
                return instance.filter;
            },
        },
    ],
    async onClose(ctx) {
        const instance = instances.get(ctx.instanceId);
        if (!instance) return;
        instances.delete(ctx.instanceId);
        listeners.delete(instance.listener);
        for (const stream of instance.streams) stream.end();
        await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
        if (!instances.size) for (const tail of tails) tail.stop();
    },
});

// ---- page ----

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>CoC logs</title>
<style>
:root { color-scheme: light dark; --bg:#fff; --fg:#1f2328; --muted:#656d76; --line:#d0d7de; --hl:#f6f8fa;
  --warn:#9a6700; --error:#cf222e; --info:#0969da; --debug:#8250df; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8d96a0; --line:#30363d; --hl:#161b22;
  --warn:#d29922; --error:#f85149; --info:#4493f8; --debug:#ab7df8; } }
* { box-sizing: border-box; }
body { margin:0; font:12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background:var(--bg); color:var(--fg);
  display:flex; flex-direction:column; height:100vh; }
header { display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding:6px 8px; border-bottom:1px solid var(--line); }
select, input, button { font:inherit; color:inherit; background:var(--hl); border:1px solid var(--line); border-radius:4px; padding:2px 6px; }
input[type=search] { flex:1; min-width:120px; }
button { cursor:pointer; }
#count { color:var(--muted); margin-left:auto; }
#rows { flex:1; overflow:auto; }
.row { display:grid; grid-template-columns:86px 44px 76px 1fr auto; gap:8px; padding:2px 8px; border-bottom:1px solid var(--hl); cursor:pointer; }
.row:hover, .row.open { background:var(--hl); }
.time, .store { color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.msg { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.row.open .msg { white-space:pre-wrap; word-break:break-all; }
.lvl { font-weight:600; text-transform:uppercase; }
.l10,.l20 { color:var(--debug); } .l30 { color:var(--info); } .l40 { color:var(--warn); } .l50,.l60 { color:var(--error); }
.send { visibility:hidden; padding:0 6px; }
.row.l40 .send, .row.l50 .send, .row.l60 .send { visibility:visible; }
dialog { width:min(720px, 92vw); border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
dialog pre { max-height:50vh; overflow:auto; white-space:pre-wrap; word-break:break-all; background:var(--hl); padding:8px; }
dialog footer { display:flex; gap:8px; justify-content:flex-end; align-items:center; }
#status { color:var(--muted); margin-right:auto; }
</style></head>
<body>
<header>
  <select id="source"><option value="server">server</option><option value="desktop">desktop</option><option value="all">both</option></select>
  <select id="level"><option value="0">all</option><option value="20">debug+</option><option value="30">info+</option><option value="40">warn+</option><option value="50">error+</option><option value="60">fatal</option></select>
  <select id="store"><option value="all">all stores</option></select>
  <input id="query" type="search" placeholder="filter text or /regex/i">
  <button id="pause">Pause</button><button id="clear">Clear</button>
  <span id="count"></span>
</header>
<div id="rows"></div>
<dialog id="preview"><pre id="excerpt"></pre>
  <footer><span id="status"></span><button id="cancel">Cancel</button><button id="confirm">Send to chat</button></footer>
</dialog>
<script>
const LEVELS = ${JSON.stringify(LEVELS)};
const MAX = ${RING_SIZE};
const $ = id => document.getElementById(id);
let entries = [], paused = false, pending = [], clearedBefore = 0, openId = null, previewId = null;
const filter = { level: 30, query: '', source: 'server', store: 'all' };

function matcher() {
  const q = filter.query.trim();
  if (!q) return () => true;
  const m = /^\\/(.+)\\/([a-z]*)$/.exec(q);
  if (m) { try { const re = new RegExp(m[1], m[2].replace(/[gy]/g, '')); return e => re.test(e.raw); } catch { return () => false; } }
  const needle = q.toLowerCase();
  return e => e.raw.toLowerCase().includes(needle);
}
function visible() {
  const match = matcher();
  return entries.filter(e => e.id > clearedBefore && e.level >= filter.level
    && (filter.source === 'all' || e.src === filter.source)
    && (filter.store === 'all' || e.store === filter.store) && match(e));
}
function row(e) {
  const div = document.createElement('div');
  div.className = 'row l' + e.level + (e.id === openId ? ' open' : '');
  const time = new Date(e.time);
  const cells = [
    ['time', time.toLocaleTimeString([], { hour12: false }) + '.' + String(time.getMilliseconds()).padStart(3, '0')],
    ['lvl l' + e.level, LEVELS[e.level] || e.level],
    ['store', e.store],
    ['msg', e.id === openId ? JSON.stringify(Object.assign({ msg: e.msg }, e.fields), null, 2) : (e.err ? e.msg + ': ' + e.err : e.msg)],
  ];
  for (const [cls, text] of cells) { const s = document.createElement('span'); s.className = cls; s.textContent = text; div.appendChild(s); }
  const send = document.createElement('button');
  send.className = 'send'; send.textContent = 'Send to chat';
  send.onclick = ev => { ev.stopPropagation(); preview(e.id); };
  div.appendChild(send);
  div.onclick = () => { openId = openId === e.id ? null : e.id; render(); };
  return div;
}
function render() {
  const box = $('rows');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  const list = visible();
  box.replaceChildren(...list.slice(-1500).map(row));
  $('count').textContent = list.length + ' / ' + entries.length + (paused ? ' (paused, ' + pending.length + ' new)' : '');
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function addStores(names) {
  const select = $('store');
  for (const name of names) {
    if (!name || [...select.options].some(o => o.value === name)) continue;
    const option = document.createElement('option'); option.value = option.textContent = name; select.appendChild(option);
  }
}
function add(batch) {
  addStores(batch.map(e => e.store));
  entries = entries.concat(batch);
  if (entries.length > MAX) entries = entries.slice(-MAX);
}
function syncControls() { addStores([filter.store]); for (const k of ['source', 'level', 'store', 'query']) $(k).value = String(filter[k]); }
for (const k of ['source', 'level', 'store']) $(k).onchange = () => { filter[k] = k === 'level' ? Number($(k).value) : $(k).value; render(); };
$('query').oninput = () => { filter.query = $('query').value; render(); };
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; if (!paused) { add(pending); pending = []; } render(); };
$('clear').onclick = () => { clearedBefore = entries.length ? entries[entries.length - 1].id : 0; render(); };

async function preview(id) {
  previewId = id; $('status').textContent = ''; $('confirm').disabled = false;
  const res = await fetch('/excerpt?id=' + id);
  const body = await res.json();
  $('excerpt').textContent = body.text || body.error;
  $('confirm').disabled = !res.ok;
  $('preview').showModal();
}
$('cancel').onclick = () => $('preview').close();
$('confirm').onclick = async () => {
  $('confirm').disabled = true; $('status').textContent = 'Sending…';
  const res = await fetch('/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: previewId }) });
  const body = await res.json().catch(() => ({}));
  if (res.ok) $('preview').close();
  else { $('status').textContent = body.error || 'Send failed'; $('confirm').disabled = false; }
};

const events = new EventSource('/events');
events.addEventListener('filter', ev => { Object.assign(filter, JSON.parse(ev.data)); syncControls(); render(); });
events.addEventListener('entries', ev => {
  const batch = JSON.parse(ev.data);
  // A reconnect replays the whole buffer; keep only lines newer than what we have.
  const last = entries.length ? entries[entries.length - 1].id : 0;
  const fresh = batch.filter(e => e.id > last && !pending.some(p => p.id === e.id));
  if (paused) pending = pending.concat(fresh); else { add(fresh); render(); }
});
syncControls();
</script>
</body></html>`;

session = await joinSession({ canvases: [canvas] });
