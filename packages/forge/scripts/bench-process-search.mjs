/**
 * Independent process-search benchmark. Run after building forge and coc-native:
 * npm run bench:process-search -w @plusplusoneplusplus/forge -- --turns 50000
 * A locally installed better-sqlite3 is optional; it is never installed by this script.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TURN_CONTENT = 'common benchmark conversation search fixture';
const SEARCHES = [
    { name: 'dense', query: 'common', filter: { limit: 20 } },
    { name: 'workspace', query: 'common', filter: { workspaceId: 'ws-a', limit: 20 } },
    { name: 'sparse', query: 'needle', filter: { limit: 20 } },
];

export function parseArgs(argv) {
    const options = { turns: 50_000, runs: 5, json: false };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--json') {
            options.json = true;
        } else if (flag === '--turns' || flag === '--runs') {
            const value = argv[++i];
            if (!/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) {
                throw new Error(`${flag} requires a positive safe integer`);
            }
            options[flag.slice(2)] = Number(value);
        } else {
            throw new Error(`unknown option: ${flag}`);
        }
    }
    return options;
}

export function p50(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function seed(store, turns) {
    const db = store.getDatabase();
    const insertProcess = db.prepare(
        `INSERT INTO processes (id, workspace_id, type, prompt_preview, status, start_time,
            last_event_at, title) VALUES (?, ?, 'chat', ?, 'completed', ?, ?, ?)`,
    );
    const insertTurn = db.prepare(
        `INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp)
         VALUES (?, ?, 'user', ?, ?)`,
    );
    const timestamp = '2026-01-01T00:00:00.000Z';
    const batch = db.transaction((start, end) => {
        for (let index = start; index < end; index++) {
            const processIndex = Math.floor(index / 10);
            const processId = `fixture-${processIndex}`;
            if (index % 10 === 0) {
                insertProcess.run(processId, processIndex % 2 ? 'ws-b' : 'ws-a',
                    `prompt ${processIndex}`, timestamp, timestamp, `Chat ${processIndex}`);
            }
            insertTurn.run(processId, index % 10,
                index % 100 === 0 ? `${TURN_CONTENT} needle` : TURN_CONTENT, timestamp);
        }
    });
    for (let start = 0; start < turns; start += 1_000) {
        batch(start, Math.min(start + 1_000, turns));
    }
}

function openBaseline(dbPath) {
    let BetterSqlite3;
    try {
        BetterSqlite3 = require('better-sqlite3');
    } catch (error) {
        if (error?.code === 'MODULE_NOT_FOUND' && /better-sqlite3/.test(error.message)) {
            return { status: 'unavailable', reason: 'better-sqlite3 is not installed (optional baseline)' };
        }
        return { status: 'unavailable', reason: `better-sqlite3 could not load: ${error.message}` };
    }
    try {
        return { status: 'available', db: new BetterSqlite3(dbPath, { readonly: true }) };
    } catch (error) {
        return { status: 'unavailable', reason: `better-sqlite3 could not open fixture: ${error.message}` };
    }
}

function baselineSearch(db, query, filter) {
    const scope = filter.workspaceId ? ' AND p.workspace_id = ?' : '';
    const from = `FROM conversation_search cs
        JOIN conversation_turns ct ON ct.id = cs.rowid
        JOIN processes p ON ct.process_id = p.id
        WHERE conversation_search MATCH ? AND p.archived = 0 AND ct.interrupted = 0${scope}`;
    const params = filter.workspaceId ? [query, filter.workspaceId] : [query];
    const total = db.prepare(`SELECT COUNT(*) AS total ${from}`).get(...params).total;
    if (total === 0) return { total, results: [] };
    const results = db.prepare(`SELECT ct.process_id AS processId, ct.turn_index AS turnIndex,
        ct.role, snippet(conversation_search, 0, '<mark>', '</mark>', '…', 48) AS snippet,
        cs.rank, p.title AS processTitle, p.prompt_preview AS promptPreview,
        p.status AS processStatus, p.type AS processType, p.workspace_id AS workspaceId,
        p.start_time AS startTime ${from} ORDER BY cs.rank LIMIT ? OFFSET ?`)
        .all(...params, filter.limit, 0);
    return { total, results };
}

function baselineTurns(db) {
    const results = db.prepare(
        'SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index',
    ).all('fixture-0').map(turn => ({
        processId: 'fixture-0', turnIndex: turn.turn_index, role: turn.role, snippet: turn.content,
    }));
    return { total: results.length, results };
}

function baselineProcesses(db) {
    const rows = db.prepare(
        'SELECT * FROM processes WHERE workspace_id = ? ORDER BY last_event_at DESC LIMIT ?',
    ).all('ws-a', 100);
    const turns = db.prepare('SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index');
    const results = rows.map(row => ({
        processId: row.id, turnIndex: turns.all(row.id).length,
        role: 'process', snippet: row.prompt_preview,
    }));
    return { total: results.length, results };
}

async function measure(run, runs, observeTimer = false) {
    const samplesMs = [];
    let timerFiredDuringSearch = false;
    let result;
    for (let i = 0; i <= runs; i++) {
        let timer;
        let fired = false;
        const start = performance.now();
        const pending = run();
        if (observeTimer && i === 1) {
            timer = setTimeout(() => { fired = true; }, 0);
        }
        result = await pending;
        if (timer) {
            timerFiredDuringSearch = fired;
            clearTimeout(timer);
        }
        if (i > 0) samplesMs.push(performance.now() - start);
    }
    return { p50Ms: p50(samplesMs), samplesMs, total: result.total,
        resultCount: result.results.length,
        firstHit: result.results.length ? {
            processId: result.results[0].processId,
            turnIndex: result.results[0].turnIndex,
            role: result.results[0].role,
            snippet: result.results[0].snippet,
        } : null,
        timerFiredDuringSearch };
}

export async function benchmark(options, { baselineFactory = openBaseline } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'forge-search-bench-'));
    let store;
    let baseline;
    try {
        const { SqliteProcessStore } = await import(pathToFileURL(
            path.join(packageRoot, 'dist', 'sqlite-process-store.js')).href);
        const dbPath = path.join(dir, 'processes.db');
        store = new SqliteProcessStore({ dbPath });
        const seedStart = performance.now();
        seed(store, options.turns);
        const fixtureMs = performance.now() - seedStart;
        baseline = baselineFactory(dbPath);
        const reads = [
            {
                name: 'getConversationTurns',
                production: async () => {
                    const turns = await store.getConversationTurns('fixture-0');
                    return { total: turns.length, results: turns.map(turn => ({
                        processId: 'fixture-0', turnIndex: turn.turnIndex,
                        role: turn.role, snippet: turn.content,
                    })) };
                },
                baseline: () => baselineTurns(baseline.db),
            },
            {
                name: 'getAllProcesses (100, ws-a)',
                production: async () => {
                    const processes = await store.getAllProcesses({ workspaceId: 'ws-a', limit: 100 });
                    return { total: processes.length, results: processes.map(process => ({
                        processId: process.id, turnIndex: process.conversationTurns.length,
                        role: 'process', snippet: process.promptPreview,
                    })) };
                },
                baseline: () => baselineProcesses(baseline.db),
            },
        ];
        const workloads = [
            ...SEARCHES.map(({ name, query, filter }) => ({
                name,
                production: () => store.searchConversations(query, filter),
                baseline: () => baselineSearch(baseline.db, query, filter),
            })),
            ...reads,
        ];
        const cases = [];
        for (const { name, production: runProduction, baseline: runBaseline } of workloads) {
            const production = await measure(
                runProduction, options.runs, name === 'dense');
            let comparison = null;
            if (baseline.status === 'available') {
                comparison = await measure(runBaseline, options.runs);
                if (comparison.total !== production.total ||
                    comparison.resultCount !== production.resultCount ||
                    JSON.stringify(comparison.firstHit) !== JSON.stringify(production.firstHit)) {
                    throw new Error(`${name}: baseline result shape differs from production`);
                }
            }
            cases.push({ name, production, baseline: comparison,
                speedup: comparison ? comparison.p50Ms / production.p50Ms : null });
        }
        return {
            turns: options.turns, processes: Math.ceil(options.turns / 10),
            runs: options.runs, fixtureMs,
            baseline: baseline.status === 'available'
                ? { status: 'available' } : { status: 'unavailable', reason: baseline.reason },
            cases,
        };
    } finally {
        if (baseline?.status === 'available') baseline.db.close();
        store?.close();
        rmSync(dir, { recursive: true, force: true });
    }
}

export function formatReport(report) {
    return [
        `Fixture: ${report.turns} turns, ${report.processes} processes (${report.fixtureMs.toFixed(1)} ms seed)`,
        `Baseline: ${report.baseline.status}${report.baseline.reason ? ` — ${report.baseline.reason}` : ''}`,
        'Read baselines fetch the same rows without production object hydration.',
        ...report.cases.map(({ name, production, baseline, speedup }) =>
            `${name}: production p50 ${production.p50Ms.toFixed(2)} ms; ` +
            `better-sqlite3 p50 ${baseline ? `${baseline.p50Ms.toFixed(2)} ms` : 'unavailable'}; ` +
            `speedup ${speedup === null ? 'unavailable' : `${speedup.toFixed(2)}x`}; ` +
            `${production.total} matches, ${production.resultCount} returned` +
            (name === 'dense' ? `; timer fired during async search: ${production.timerFiredDuringSearch}` : '')),
    ].join('\n');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    try {
        const report = await benchmark(parseArgs(process.argv.slice(2)));
        console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
    } catch (error) {
        console.error(`process-search benchmark: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}
