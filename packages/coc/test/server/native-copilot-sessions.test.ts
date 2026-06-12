/**
 * Tests for the read-only native Copilot CLI session routes and query service.
 *
 * All fixtures are synthetic temporary SQLite databases — these tests never
 * read real local user data from ~/.copilot.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import DatabaseConstructor from 'better-sqlite3';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '../../src/server/types';
import {
    NativeCopilotSessionService,
    buildFtsMatchExpression,
    sessionMatchesWorkspace,
} from '../../src/server/native-copilot-sessions/native-copilot-session-service';

// ── Fixture helpers ──────────────────────────────────────────────────────────

interface FixtureSession {
    id: string;
    cwd?: string | null;
    repository?: string | null;
    hostType?: string | null;
    branch?: string | null;
    summary?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

interface FixtureTurn {
    sessionId: string;
    turnIndex: number;
    userMessage?: string | null;
    assistantResponse?: string | null;
    timestamp?: string;
    indexed?: boolean;
}

function createFixtureDb(dbPath: string, sessions: FixtureSession[], turns: FixtureTurn[] = [], options: { searchIndex?: boolean } = {}): void {
    const db = new DatabaseConstructor(dbPath);
    try {
        db.exec(`
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                cwd TEXT,
                repository TEXT,
                host_type TEXT,
                branch TEXT,
                summary TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                turn_index INTEGER NOT NULL,
                user_message TEXT,
                assistant_response TEXT,
                timestamp TEXT DEFAULT (datetime('now')),
                UNIQUE(session_id, turn_index)
            );
        `);
        if (options.searchIndex !== false) {
            db.exec(`
                CREATE VIRTUAL TABLE search_index USING fts5(
                    content,
                    session_id UNINDEXED,
                    source_type UNINDEXED,
                    source_id UNINDEXED
                );
            `);
        }
        const insertSession = db.prepare(
            'INSERT INTO sessions (id, cwd, repository, host_type, branch, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const s of sessions) {
            insertSession.run(
                s.id,
                s.cwd ?? null,
                s.repository ?? null,
                s.hostType ?? 'github',
                s.branch ?? null,
                s.summary ?? null,
                s.createdAt ?? '2026-06-01T00:00:00.000Z',
                s.updatedAt ?? '2026-06-01T00:00:00.000Z',
            );
        }
        const insertTurn = db.prepare(
            'INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)',
        );
        const insertIndex = options.searchIndex !== false
            ? db.prepare('INSERT INTO search_index (content, session_id, source_type, source_id) VALUES (?, ?, ?, ?)')
            : null;
        for (const t of turns) {
            insertTurn.run(t.sessionId, t.turnIndex, t.userMessage ?? null, t.assistantResponse ?? null, t.timestamp ?? '2026-06-01T00:00:00.000Z');
            if (t.indexed !== false && insertIndex) {
                const content = [t.userMessage, t.assistantResponse].filter(Boolean).join('\n');
                if (content) {
                    insertIndex.run(content, t.sessionId, 'turn', `${t.sessionId}:turn:${t.turnIndex}`);
                }
            }
        }
    } finally {
        db.close();
    }
}

function request(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'GET' },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            },
        );
        req.on('error', reject);
        req.end();
    });
}

function postJSON(url: string, data: unknown): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const body = JSON.stringify(data);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ── Service-level tests ──────────────────────────────────────────────────────

describe('NativeCopilotSessionService', () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-sessions-svc-'));
        dbPath = path.join(tmpDir, 'session-store.db');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns db-missing when the native store does not exist', () => {
        const service = new NativeCopilotSessionService({ dbPath });
        const result = service.listSessions({ rootPath: tmpDir });
        expect(result).toMatchObject({ available: false, reason: 'db-missing' });
    });

    it('returns db-invalid for a non-SQLite file', () => {
        fs.writeFileSync(dbPath, 'not a sqlite database at all');
        const service = new NativeCopilotSessionService({ dbPath });
        const result = service.listSessions({ rootPath: tmpDir });
        expect(result).toMatchObject({ available: false, reason: 'db-invalid' });
    });

    it('returns db-invalid when the schema lacks required tables', () => {
        const db = new DatabaseConstructor(dbPath);
        db.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
        db.close();
        const service = new NativeCopilotSessionService({ dbPath });
        const result = service.listSessions({ rootPath: tmpDir });
        expect(result).toMatchObject({ available: false, reason: 'db-invalid' });
        const detail = service.getSession({ rootPath: tmpDir }, 'anything');
        expect(detail).toMatchObject({ available: false, reason: 'db-invalid' });
    });

    it('filters sessions to the workspace by cwd and repository across two synthetic repos', () => {
        const wsRoot = path.join(tmpDir, 'repo-a');
        const otherRoot = path.join(tmpDir, 'repo-b');
        createFixtureDb(dbPath, [
            { id: 'in-cwd', cwd: wsRoot, repository: null, updatedAt: '2026-06-03T00:00:00.000Z' },
            { id: 'in-cwd-sub', cwd: path.join(wsRoot, 'packages', 'x'), repository: null, updatedAt: '2026-06-02T00:00:00.000Z' },
            { id: 'in-repo', cwd: otherRoot, repository: 'Owner/Repo-A', updatedAt: '2026-06-01T00:00:00.000Z' },
            { id: 'other-repo', cwd: otherRoot, repository: 'owner/repo-b', updatedAt: '2026-06-04T00:00:00.000Z' },
            { id: 'prefix-trap', cwd: `${wsRoot}-sibling`, repository: null, updatedAt: '2026-06-05T00:00:00.000Z' },
        ]);
        const service = new NativeCopilotSessionService({ dbPath });
        const result = service.listSessions({ rootPath: wsRoot, repository: 'owner/repo-a' });
        expect(result.available).toBe(true);
        if (result.available) {
            expect(result.items.map(i => i.id)).toEqual(['in-cwd', 'in-cwd-sub', 'in-repo']);
        }
    });

    it('sorts by updated_at descending and reports turn counts', () => {
        const wsRoot = path.join(tmpDir, 'ws');
        createFixtureDb(
            dbPath,
            [
                { id: 'older', cwd: wsRoot, updatedAt: '2026-06-01T00:00:00.000Z' },
                { id: 'newer', cwd: wsRoot, updatedAt: '2026-06-10T00:00:00.000Z' },
            ],
            [
                { sessionId: 'older', turnIndex: 0, userMessage: 'hello' },
                { sessionId: 'older', turnIndex: 1, userMessage: 'again' },
                { sessionId: 'newer', turnIndex: 0, userMessage: 'hi' },
            ],
        );
        const service = new NativeCopilotSessionService({ dbPath });
        const result = service.listSessions({ rootPath: wsRoot });
        expect(result.available).toBe(true);
        if (result.available) {
            expect(result.items.map(i => i.id)).toEqual(['newer', 'older']);
            expect(result.items.map(i => i.turnCount)).toEqual([1, 2]);
        }
    });

    it('paginates with limit/offset and reports the full total', () => {
        const wsRoot = path.join(tmpDir, 'ws');
        const sessions = Array.from({ length: 5 }, (_, i) => ({
            id: `s-${i}`,
            cwd: wsRoot,
            updatedAt: `2026-06-0${5 - i}T00:00:00.000Z`,
        }));
        createFixtureDb(dbPath, sessions);
        const service = new NativeCopilotSessionService({ dbPath });
        const page = service.listSessions({ rootPath: wsRoot }, { limit: 2, offset: 2 });
        expect(page.available).toBe(true);
        if (page.available) {
            expect(page.total).toBe(5);
            expect(page.items.map(i => i.id)).toEqual(['s-2', 's-3']);
            expect(page.limit).toBe(2);
            expect(page.offset).toBe(2);
        }
    });

    it('finds text hits through search_index with snippets, and supports combined filters', () => {
        const wsRoot = path.join(tmpDir, 'ws');
        createFixtureDb(
            dbPath,
            [
                { id: 'hit-main', cwd: wsRoot, branch: 'main', updatedAt: '2026-06-02T00:00:00.000Z' },
                { id: 'hit-feature', cwd: wsRoot, branch: 'feature', updatedAt: '2026-06-03T00:00:00.000Z' },
                { id: 'no-hit', cwd: wsRoot, branch: 'main', updatedAt: '2026-06-04T00:00:00.000Z' },
            ],
            [
                { sessionId: 'hit-main', turnIndex: 0, userMessage: 'please fix the mermaid build failure' },
                { sessionId: 'hit-feature', turnIndex: 0, userMessage: 'mermaid diagrams render blank' },
                { sessionId: 'no-hit', turnIndex: 0, userMessage: 'unrelated work item planning' },
            ],
        );
        const service = new NativeCopilotSessionService({ dbPath });

        const textOnly = service.listSessions({ rootPath: wsRoot }, { q: 'mermaid' });
        expect(textOnly.available).toBe(true);
        if (textOnly.available) {
            expect(textOnly.items.map(i => i.id).sort()).toEqual(['hit-feature', 'hit-main']);
            expect(textOnly.items[0].matchSnippets.length).toBeGreaterThan(0);
            expect(textOnly.searchIndexAvailable).toBe(true);
        }

        const combined = service.listSessions({ rootPath: wsRoot }, { q: 'mermaid', branch: 'main' });
        expect(combined.available).toBe(true);
        if (combined.available) {
            expect(combined.items.map(i => i.id)).toEqual(['hit-main']);
        }

        const noResult = service.listSessions({ rootPath: wsRoot }, { q: 'zzz-not-present-anywhere' });
        expect(noResult.available).toBe(true);
        if (noResult.available) {
            expect(noResult.items).toEqual([]);
            expect(noResult.total).toBe(0);
        }
    });

    it('filters by partial session id and date range', () => {
        const wsRoot = path.join(tmpDir, 'ws');
        createFixtureDb(dbPath, [
            { id: 'abc-123', cwd: wsRoot, updatedAt: '2026-06-02T00:00:00.000Z' },
            { id: 'def-456', cwd: wsRoot, updatedAt: '2026-06-08T00:00:00.000Z' },
        ]);
        const service = new NativeCopilotSessionService({ dbPath });

        const byId = service.listSessions({ rootPath: wsRoot }, { sessionId: 'abc' });
        expect(byId.available && byId.items.map(i => i.id)).toEqual(['abc-123']);

        const byRange = service.listSessions({ rootPath: wsRoot }, { from: '2026-06-05T00:00:00.000Z' });
        expect(byRange.available && byRange.items.map(i => i.id)).toEqual(['def-456']);

        const byUpper = service.listSessions({ rootPath: wsRoot }, { to: '2026-06-05T00:00:00.000Z' });
        expect(byUpper.available && byUpper.items.map(i => i.id)).toEqual(['abc-123']);
    });

    it('treats hostile filter input as data, never as SQL or FTS syntax', () => {
        const wsRoot = path.join(tmpDir, 'ws');
        createFixtureDb(
            dbPath,
            [{ id: 'safe', cwd: wsRoot, branch: 'main', summary: 'safe summary', updatedAt: '2026-06-02T00:00:00.000Z' }],
            [{ sessionId: 'safe', turnIndex: 0, userMessage: 'regular indexed content' }],
        );
        const service = new NativeCopilotSessionService({ dbPath });
        const hostileInputs = [
            "'; DROP TABLE sessions; --",
            '" OR "1"="1',
            'content* OR session_id:x',
            '%_\\',
        ];
        for (const hostile of hostileInputs) {
            const viaQ = service.listSessions({ rootPath: wsRoot }, { q: hostile });
            expect(viaQ.available).toBe(true);
            const viaBranch = service.listSessions({ rootPath: wsRoot }, { branch: hostile });
            expect(viaBranch.available && viaBranch.items).toEqual([]);
            const viaId = service.listSessions({ rootPath: wsRoot }, { sessionId: hostile });
            expect(viaId.available && viaId.items).toEqual([]);
        }
        // The sessions table must survive every hostile input above.
        const after = service.listSessions({ rootPath: wsRoot });
        expect(after.available && after.items.map(i => i.id)).toEqual(['safe']);
    });

    it('reports text search unavailable when search_index is absent', () => {
        const wsRoot = path.join(tmpDir, 'ws');
        createFixtureDb(dbPath, [{ id: 's1', cwd: wsRoot, updatedAt: '2026-06-02T00:00:00.000Z' }], [], { searchIndex: false });
        const service = new NativeCopilotSessionService({ dbPath });
        const noQuery = service.listSessions({ rootPath: wsRoot });
        expect(noQuery.available && noQuery.searchIndexAvailable).toBe(false);
        expect(noQuery.available && noQuery.items.map(i => i.id)).toEqual(['s1']);

        const withQuery = service.listSessions({ rootPath: wsRoot }, { q: 'anything' });
        expect(withQuery.available).toBe(true);
        if (withQuery.available) {
            expect(withQuery.items).toEqual([]);
            expect(withQuery.searchIndexAvailable).toBe(false);
        }
    });

    it('returns ordered turns, empty assistant responses, and index diagnostics on detail reads', () => {
        const wsRoot = path.join(tmpDir, 'ws');
        createFixtureDb(
            dbPath,
            [{ id: 'detail-1', cwd: wsRoot, branch: null, summary: 'Full stored summary\nsecond line' }],
            [
                { sessionId: 'detail-1', turnIndex: 1, userMessage: 'second user', assistantResponse: 'second answer' },
                { sessionId: 'detail-1', turnIndex: 0, userMessage: '<script>alert("xss")</script>', assistantResponse: null, indexed: true },
                { sessionId: 'detail-1', turnIndex: 2, userMessage: 'third — not indexed', assistantResponse: '', indexed: false },
            ],
        );
        const service = new NativeCopilotSessionService({ dbPath });
        const result = service.getSession({ rootPath: wsRoot }, 'detail-1');
        expect(result.available).toBe(true);
        if (!result.available || !result.session) throw new Error('expected session');
        const session = result.session;
        expect(session.summary).toBe('Full stored summary\nsecond line');
        expect(session.turns.map(t => t.turnIndex)).toEqual([0, 1, 2]);
        // Stored text is returned exactly as stored; rendering safety is a UI concern.
        expect(session.turns[0].userMessage).toBe('<script>alert("xss")</script>');
        expect(session.turns[0].assistantResponse).toBe('');
        expect(session.turns[0].assistantChars).toBe(0);
        expect(session.turns[0].searchIndexSourceId).toBe('detail-1:turn:0');
        expect(session.turns[0].searchIndexChars).toBeGreaterThan(0);
        expect(session.turns[2].searchIndexSourceId).toBeNull();
        expect(session.turns[2].searchIndexChars).toBeNull();
    });

    it('hides sessions from other workspaces on detail reads', () => {
        const wsRoot = path.join(tmpDir, 'ws');
        createFixtureDb(dbPath, [{ id: 'foreign', cwd: path.join(tmpDir, 'elsewhere') }]);
        const service = new NativeCopilotSessionService({ dbPath });
        const result = service.getSession({ rootPath: wsRoot }, 'foreign');
        expect(result).toMatchObject({ available: true, session: null });
    });
});

describe('native session matching helpers', () => {
    it('matches repository case-insensitively and cwd by normalized prefix', () => {
        expect(sessionMatchesWorkspace({ repository: 'Owner/Repo', cwd: null }, { repository: 'owner/repo' })).toBe(true);
        expect(sessionMatchesWorkspace({ repository: 'owner/other', cwd: null }, { repository: 'owner/repo' })).toBe(false);
        expect(sessionMatchesWorkspace({ repository: null, cwd: '/a/b/c' }, { rootPath: '/a/b' })).toBe(true);
        expect(sessionMatchesWorkspace({ repository: null, cwd: '/a/bc' }, { rootPath: '/a/b' })).toBe(false);
        expect(sessionMatchesWorkspace({ repository: null, cwd: '/a/b/' }, { rootPath: '/a/b' })).toBe(true);
        expect(sessionMatchesWorkspace({ repository: null, cwd: null }, { rootPath: '/a/b', repository: 'o/r' })).toBe(false);
        expect(sessionMatchesWorkspace({ repository: 'o/r', cwd: '/x' }, {})).toBe(false);
    });

    it('builds literal-quoted FTS match expressions', () => {
        expect(buildFtsMatchExpression('hello world')).toBe('"hello" "world"');
        expect(buildFtsMatchExpression('say "hi"')).toBe('"say" """hi"""');
        expect(buildFtsMatchExpression('   ')).toBeNull();
    });
});

// ── Route-level tests ────────────────────────────────────────────────────────

describe('Native Copilot session routes', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let fixtureDir: string;
    let dbPath: string;
    const wsId = 'native-sessions-ws';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-sessions-data-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-sessions-repo-'));
        fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-sessions-db-'));
        dbPath = path.join(fixtureDir, 'session-store.db');
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        for (const dir of [dataDir, workspaceDir, fixtureDir]) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    async function startServer(options: { enabled?: boolean } = {}): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({
            port: 0,
            host: 'localhost',
            store,
            dataDir,
            fileConfig: { features: { nativeCopilotSessions: options.enabled ?? true } },
            nativeCopilotSessionDbPath: dbPath,
            queue: { autoStart: false },
        });
        const res = await postJSON(`${server.url}/api/workspaces`, {
            id: wsId,
            name: 'Native Sessions Test Workspace',
            rootPath: workspaceDir,
        });
        expect(res.status).toBe(201);
        return server;
    }

    function listUrl(query = ''): string {
        return `${server!.url}/api/workspaces/${encodeURIComponent(wsId)}/native-copilot-sessions${query}`;
    }

    it('returns enabled:false with feature-disabled reason when the flag is off', async () => {
        createFixtureDb(dbPath, [{ id: 's1', cwd: workspaceDir }]);
        await startServer({ enabled: false });
        const res = await request(listUrl());
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ enabled: false, reason: 'feature-disabled', items: [], total: 0 });

        const detail = await request(`${listUrl()}/s1`);
        expect(detail.status).toBe(200);
        expect(JSON.parse(detail.body)).toMatchObject({ enabled: false, reason: 'feature-disabled' });
    });

    it('returns a typed unavailable payload when the native DB is missing', async () => {
        await startServer();
        const res = await request(listUrl());
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ enabled: true, available: false, reason: 'db-missing', items: [] });
    });

    it('returns a typed unavailable payload for an invalid native DB', async () => {
        fs.writeFileSync(dbPath, 'garbage, not sqlite');
        await startServer();
        const res = await request(listUrl());
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ enabled: true, available: false, reason: 'db-invalid' });
    });

    it('lists only workspace-matching sessions sorted newest first with pagination metadata', async () => {
        createFixtureDb(
            dbPath,
            [
                { id: 'mine-old', cwd: workspaceDir, branch: 'main', summary: 'First summary line\nmore', updatedAt: '2026-06-01T00:00:00.000Z' },
                { id: 'mine-new', cwd: path.join(workspaceDir, 'sub'), branch: 'feature', updatedAt: '2026-06-09T00:00:00.000Z' },
                { id: 'foreign', cwd: '/somewhere/else', repository: 'other/repo', updatedAt: '2026-06-10T00:00:00.000Z' },
            ],
            [
                { sessionId: 'mine-old', turnIndex: 0, userMessage: 'searchable mermaid text' },
                { sessionId: 'mine-new', turnIndex: 0, userMessage: 'other text' },
                { sessionId: 'mine-new', turnIndex: 1, userMessage: 'more text' },
            ],
        );
        await startServer();
        const res = await request(listUrl());
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.enabled).toBe(true);
        expect(body.available).toBe(true);
        expect(body.items.map((i: { id: string }) => i.id)).toEqual(['mine-new', 'mine-old']);
        expect(body.items[0].turnCount).toBe(2);
        expect(body.items[1].summaryPreview).toBe('First summary line');
        expect(body.total).toBe(2);
        expect(body.limit).toBe(50);
        expect(body.offset).toBe(0);

        const paged = await request(listUrl('?limit=1&offset=1'));
        const pagedBody = JSON.parse(paged.body);
        expect(pagedBody.items.map((i: { id: string }) => i.id)).toEqual(['mine-old']);
        expect(pagedBody.total).toBe(2);

        const searched = await request(listUrl('?q=mermaid'));
        const searchedBody = JSON.parse(searched.body);
        expect(searchedBody.items.map((i: { id: string }) => i.id)).toEqual(['mine-old']);
        expect(searchedBody.items[0].matchSnippets.length).toBeGreaterThan(0);
    });

    it('serves workspace-scoped session detail and 404s for foreign or unknown sessions', async () => {
        createFixtureDb(
            dbPath,
            [
                { id: 'mine', cwd: workspaceDir, summary: 'Stored summary' },
                { id: 'foreign', cwd: '/somewhere/else' },
            ],
            [
                { sessionId: 'mine', turnIndex: 0, userMessage: 'user text', assistantResponse: null },
            ],
        );
        await startServer();

        const ok = await request(`${listUrl()}/mine`);
        expect(ok.status).toBe(200);
        const okBody = JSON.parse(ok.body);
        expect(okBody.session.id).toBe('mine');
        expect(okBody.session.turns).toHaveLength(1);
        expect(okBody.session.turns[0].assistantResponse).toBe('');

        const foreign = await request(`${listUrl()}/foreign`);
        expect(foreign.status).toBe(404);

        const unknown = await request(`${listUrl()}/does-not-exist`);
        expect(unknown.status).toBe(404);
    });

    it('returns 404 for an unknown workspace', async () => {
        createFixtureDb(dbPath, [{ id: 's1', cwd: workspaceDir }]);
        await startServer();
        const res = await request(`${server!.url}/api/workspaces/nope/native-copilot-sessions`);
        expect(res.status).toBe(404);
    });
});
