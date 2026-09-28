/**
 * Independent process-search benchmark. Run after building forge and coc-native:
 * npm run bench:process-search -w @plusplusoneplusplus/forge -- --turns 50000
 * A locally installed better-sqlite3 is optional; it is never installed by this script.
 * --assert-p50 requires every AC-07 workload and an output-equivalent baseline.
 * --profile measures native read calls separately from Forge hydration.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TURN_CONTENT = 'common benchmark conversation search fixture';
const SEARCHES = [
    { name: 'dense', query: 'common', filter: { limit: 20 } },
    { name: 'workspace', query: 'common', filter: { workspaceId: 'ws-a', limit: 20 } },
    { name: 'sparse', query: 'needle', filter: { limit: 20 } },
];

export function parseArgs(argv) {
    const options = { turns: 50_000, runs: 5, json: false, assertP50: false, profile: false };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--json') {
            options.json = true;
        } else if (flag === '--profile') {
            options.profile = true;
        } else if (flag === '--assert-p50') {
            options.assertP50 = true;
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
            last_event_at, title, metadata, full_prompt, result, structured_result)
         VALUES (?, ?, 'chat', ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertTurn = db.prepare(
        `INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp,
            timeline, token_usage, tool_calls) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)`,
    );
    const timestamp = '2026-01-01T00:00:00.000Z';
    const batch = db.transaction((start, end) => {
        for (let index = start; index < end; index++) {
            const processIndex = Math.floor(index / 10);
            const processId = `fixture-${processIndex}`;
            if (index % 10 === 0) {
                insertProcess.run(processId, processIndex % 2 ? 'ws-b' : 'ws-a',
                    `prompt ${processIndex}`, timestamp, timestamp, `Chat ${processIndex}`,
                    JSON.stringify({ model: 'fixture', __pendingMessages: [] }),
                    `full prompt ${processIndex}`, `result ${processIndex}`, `structured ${processIndex}`);
            }
            const toolCalls = index % 100 === 0
                ? JSON.stringify([{ id: `tool-${index}`, name: 'fixture', status: 'completed',
                    startTime: timestamp, args: { index } }]) : null;
            insertTurn.run(processId, index % 10,
                index % 100 === 0 ? `${TURN_CONTENT} needle` : TURN_CONTENT, timestamp,
                index % 100 === 0 ? JSON.stringify([{ type: 'message', timestamp, content: 'fixture' }]) : '[]',
                '{"inputTokens":12,"outputTokens":4}', toolCalls);
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
        return { status: 'available', db: new BetterSqlite3(dbPath) };
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
    const rows = db.prepare(`SELECT ct.process_id AS processId, ct.turn_index AS turnIndex,
        ct.role, snippet(conversation_search, 0, '<mark>', '</mark>', '…', 48) AS snippet,
        cs.rank, p.title AS processTitle, p.prompt_preview AS promptPreview,
        p.status AS processStatus, p.type AS processType, p.workspace_id AS workspaceId,
        p.start_time AS startTime ${from} ORDER BY cs.rank LIMIT ? OFFSET ?`)
        .all(...params, filter.limit, 0);
    const results = rows.map(({ processTitle, promptPreview, ...row }) => ({
        ...row, ...(processTitle == null ? {} : { processTitle }), promptPreview: promptPreview ?? '',
    }));
    return { total, results };
}

const optional = value => value ?? undefined;
const date = value => value ? new Date(value) : undefined;
const json = value => value == null ? undefined : JSON.parse(value);
const bool = value => value ? true : undefined;

function hydrateToolCall(raw) {
    return {
        id: raw.id ?? '',
        name: raw.name ?? '',
        status: raw.status ?? 'completed',
        startTime: new Date(raw.startTime ?? 0),
        endTime: date(raw.endTime),
        args: raw.args ?? {},
        result: raw.result,
        error: raw.error,
        parentToolCallId: raw.parentToolCallId,
        progressMessage: raw.progressMessage,
        permissionRequest: raw.permissionRequest ? {
            kind: raw.permissionRequest.kind,
            timestamp: new Date(raw.permissionRequest.timestamp ?? 0),
            resource: raw.permissionRequest.resource,
            operation: raw.permissionRequest.operation,
        } : undefined,
        permissionResult: raw.permissionResult ? {
            approved: raw.permissionResult.approved,
            timestamp: new Date(raw.permissionResult.timestamp ?? 0),
            reason: raw.permissionResult.reason,
        } : undefined,
    };
}

function hydrateTurn(row) {
    const toolCalls = json(row.tool_calls)?.map(hydrateToolCall);
    return {
        role: row.role,
        content: row.content ?? '',
        timestamp: new Date(row.timestamp),
        turnIndex: row.turn_index,
        streaming: bool(row.streaming),
        interrupted: bool(row.interrupted),
        interruptionReason: optional(row.interruption_reason),
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        timeline: json(row.timeline)?.map(item => ({
            type: item.type,
            timestamp: new Date(item.timestamp ?? 0),
            content: item.content,
            toolCall: item.toolCall ? hydrateToolCall(item.toolCall) : undefined,
        })) ?? [],
        images: json(row.images),
        historical: bool(row.historical),
        suggestions: json(row.suggestions),
        tokenUsage: json(row.token_usage),
        pasteExternalized: bool(row.paste_externalized),
        displayOnly: bool(row.display_only),
        ...(row.compaction_summary ? { compactionSummary: row.compaction_summary } : {}),
        ...(row.repo_group_context ? { repoGroupContext: row.repo_group_context } : {}),
        ...(row.chat_mode_context ? { chatModeContext: row.chat_mode_context } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...(row.mode ? { mode: row.mode } : {}),
        ...(row.provider ? { provider: row.provider } : {}),
        ...(row.segment_id ? { segmentId: row.segment_id } : {}),
        ...(row.relay_request_id !== null ? { relayRequestId: row.relay_request_id } : {}),
        ...(row.sdk_event_id ? { sdkEventId: row.sdk_event_id } : {}),
        deletedAt: date(row.deleted_at),
        pinnedAt: date(row.pinned_at),
        archived: bool(row.archived),
    };
}

function hydrateProcess(row, turns, excludeConversation = false) {
    const { __codeReviewMetadata, __discoveryMetadata, __codeReviewGroupMetadata,
        __pendingMessages, __pendingAskUser, __pendingAskUserAnswer, ...metadata } = json(row.metadata) ?? {};
    const process = {
        id: row.id,
        type: row.type ?? 'clarification',
        promptPreview: row.prompt_preview ?? '',
        status: row.status,
        startTime: new Date(row.start_time),
        endTime: date(row.end_time),
        error: optional(row.error),
        resultFilePath: optional(row.result_file_path),
        rawStdoutFilePath: optional(row.raw_stdout_file_path),
        metadata: Object.keys(metadata).length ? metadata : undefined,
        groupMetadata: json(row.group_metadata),
        codeReviewMetadata: __codeReviewMetadata,
        discoveryMetadata: __discoveryMetadata,
        codeReviewGroupMetadata: __codeReviewGroupMetadata,
        structuredResult: optional(row.structured_result),
        parentProcessId: optional(row.parent_process_id),
        sdkSessionId: optional(row.sdk_session_id),
        activeProviderSession: json(row.active_provider_session),
        backend: optional(row.backend),
        workingDirectory: optional(row.working_directory),
        title: optional(row.title),
        customTitle: optional(row.custom_title),
        lastMessagePreview: optional(row.last_message_preview),
        tokenLimit: optional(row.token_limit),
        currentTokens: optional(row.current_tokens),
        systemTokens: optional(row.system_tokens),
        toolDefinitionsTokens: optional(row.tool_definitions_tokens),
        conversationTokens: optional(row.conversation_tokens),
        cumulativeTokenUsage: json(row.cumulative_token_usage),
        stale: bool(row.stale),
        dataFilePath: optional(row.data_file_path),
        pendingMessages: __pendingMessages,
        pendingAskUser: __pendingAskUser,
        pendingAskUserAnswer: __pendingAskUserAnswer,
        lastEventAt: date(row.last_event_at),
        pinnedAt: optional(row.pinned_at),
        archived: bool(row.archived),
    };
    if (!excludeConversation) {
        process.fullPrompt = row.full_prompt ?? '';
        process.result = optional(row.result);
        process.conversationTurns = turns;
    }
    return process;
}

function baselineTurns(db) {
    const results = db.prepare(
        'SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index',
    ).all('fixture-0').map(hydrateTurn);
    return { total: results.length, results };
}

function baselineProcesses(db, excludeConversation = false) {
    const columns = excludeConversation
        ? `id, workspace_id, type, prompt_preview, NULL AS full_prompt, status,
           start_time, end_time, error, NULL AS result, result_file_path, raw_stdout_file_path,
           metadata, group_metadata, NULL AS structured_result, parent_process_id,
           sdk_session_id, active_provider_session, backend, working_directory,
           title, custom_title, last_message_preview, token_limit, current_tokens,
           cumulative_token_usage, stale, data_file_path, archived, pinned_at, seen_at, last_event_at`
        : '*';
    const rows = db.prepare(
        `SELECT ${columns} FROM processes WHERE workspace_id = ? ORDER BY last_event_at DESC LIMIT ?`,
    ).all('ws-a', 100);
    const turns = db.prepare('SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index');
    const results = rows.map(row => hydrateProcess(row,
        excludeConversation ? undefined : turns.all(row.id).map(hydrateTurn), excludeConversation));
    return { total: results.length, results };
}

function hydrateIndex(row, summary = false) {
    const startMs = new Date(row.start_time).getTime();
    const endMs = row.end_time ? new Date(row.end_time).getTime() : undefined;
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        status: row.status,
        type: row.type || 'clarification',
        startTime: new Date(row.start_time).toISOString(),
        endTime: row.end_time ? new Date(row.end_time).toISOString() : undefined,
        promptPreview: row.prompt_preview ?? '',
        error: optional(row.error),
        parentProcessId: optional(row.parent_process_id),
        title: optional(row.title),
        customTitle: optional(row.custom_title),
        lastMessagePreview: optional(row.last_message_preview),
        duration: endMs !== undefined ? endMs - startMs : undefined,
        lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : undefined,
        activityAt: new Date(row.last_event_at ?? row.start_time).toISOString(),
        pinnedAt: optional(row.pinned_at),
        archived: bool(row.archived) || undefined,
        ...(summary ? { pendingAskUserCount: row.pending_ask_user_count > 0
            ? row.pending_ask_user_count : undefined } : {}),
        compaction: json(row.compaction_json),
    };
}

function baselineSummaries(db) {
    const where = 'WHERE workspace_id = ?';
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM processes ${where}`).get('ws-a').cnt;
    const rows = db.prepare(`SELECT id, workspace_id, status, type, start_time, end_time,
        prompt_preview, error, parent_process_id, title, custom_title, last_message_preview,
        last_event_at, pinned_at, archived,
        COALESCE(json_array_length(json_extract(metadata, '$.__pendingAskUser')), 0) AS pending_ask_user_count,
        json_extract(metadata, '$.compaction') AS compaction_json
        FROM processes ${where} ORDER BY last_event_at DESC LIMIT ?`).all('ws-a', 100);
    return { total, results: rows.map(row => hydrateIndex(row, true)) };
}

function baselineRecent(db) {
    const rows = db.prepare(`SELECT id, workspace_id, status, type, start_time, end_time,
        prompt_preview, error, parent_process_id, title, custom_title, last_message_preview,
        last_event_at, pinned_at, archived,
        json_extract(metadata, '$.compaction') AS compaction_json
        FROM processes WHERE archived = 0 AND workspace_id = ?
        ORDER BY last_event_at DESC LIMIT ? OFFSET ?`).all('ws-a', 100, 0);
    return { total: rows.length, results: rows.map(row => hydrateIndex(row)) };
}

function streamingRows(db, processId) {
    const results = db.prepare(
        'SELECT turn_index, role, content, streaming, timeline FROM conversation_turns WHERE process_id = ? ORDER BY turn_index',
    ).all(processId);
    return { total: results.length, results };
}

function baselineStreamingWrite(db) {
    db.transaction(() => {
        const updated = db.prepare(
            'UPDATE conversation_turns SET content = ?, timeline = ?, streaming = ? WHERE process_id = ? AND streaming = 1',
        ).run('updated stream', '[]', 1, 'bench-baseline-stream');
        assert.equal(updated.changes, 1);
    })();
    return streamingRows(db, 'bench-baseline-stream');
}

function baselineAppend(db) {
    db.transaction(() => {
        const index = db.prepare(
            'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_idx FROM conversation_turns WHERE process_id = ?',
        ).get('bench-baseline-append').next_idx;
        db.prepare(
            `INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp, timeline)
             VALUES (?, ?, 'assistant', ?, ?, '[]')`,
        ).run('bench-baseline-append', index, `reply-${index}`, '2026-01-01T00:00:00.000Z');
        db.prepare('UPDATE processes SET last_event_at = ? WHERE id = ?')
            .run(new Date().toISOString(), 'bench-baseline-append');
    })();
    const rows = db.prepare('SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index')
        .all('bench-baseline-append');
    hydrateProcess(db.prepare('SELECT * FROM processes WHERE id = ?').get('bench-baseline-append'),
        rows.map(hydrateTurn));
    const results = rows.map(hydrateTurn);
    return { total: results.length, results };
}

export async function measure(run, runs, observeTimer = false) {
    const samplesMs = [];
    let timerFiredDuringSearch = false;
    let result;
    for (let i = 0; i <= runs; i++) {
        let timer;
        let pending = true;
        const start = performance.now();
        if (observeTimer && i === 1) {
            timer = setTimeout(() => {
                if (pending) timerFiredDuringSearch = true;
            }, 0);
        }
        try {
            result = await run();
        } finally {
            pending = false;
            if (timer) clearTimeout(timer);
        }
        if (i > 0) samplesMs.push(performance.now() - start);
    }
    return { p50Ms: p50(samplesMs), samplesMs, total: result.total,
        resultCount: result.results.length,
        results: result.results,
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
        for (const id of ['bench-native-stream', 'bench-baseline-stream',
            'bench-native-append', 'bench-baseline-append']) {
            await store.addProcess({
                id, type: 'chat', status: 'running', promptPreview: 'benchmark',
                startTime: new Date('2026-01-01T00:00:00.000Z'),
                metadata: { type: 'chat', workspaceId: 'ws-benchmark' },
            });
        }
        await store.upsertStreamingTurn('bench-native-stream', 'initial stream', true);
        await store.upsertStreamingTurn('bench-baseline-stream', 'initial stream', true);
        baseline = baselineFactory(dbPath);
        const reads = [
            {
                name: 'getConversationTurns',
                production: async () => {
                    const turns = await store.getConversationTurns('fixture-0');
                    return { total: turns.length, results: turns };
                },
                baseline: () => baselineTurns(baseline.db),
            },
            {
                name: 'getAllProcesses (100, ws-a)',
                production: async () => {
                    const processes = await store.getAllProcesses({ workspaceId: 'ws-a', limit: 100 });
                    return { total: processes.length, results: processes };
                },
                baseline: () => baselineProcesses(baseline.db),
            },
            {
                name: 'getAllProcesses (100, ws-a, exclude conversation)',
                production: async () => {
                    const processes = await store.getAllProcesses({
                        workspaceId: 'ws-a', limit: 100, exclude: ['conversation'],
                    });
                    return { total: processes.length, results: processes };
                },
                baseline: () => baselineProcesses(baseline.db, true),
            },
            {
                name: 'getProcessSummaries (100, ws-a)',
                production: async () => {
                    const page = await store.getProcessSummaries({ workspaceId: 'ws-a', limit: 100 });
                    return { total: page.total, results: page.entries };
                },
                baseline: () => baselineSummaries(baseline.db),
            },
            {
                name: 'listRecentProcesses (100, ws-a)',
                production: async () => {
                    const results = await store.listRecentProcesses({ workspaceId: 'ws-a', limit: 100 });
                    return { total: results.length, results };
                },
                baseline: () => baselineRecent(baseline.db),
            },
        ];
        const workloads = [
            ...SEARCHES.map(({ name, query, filter }) => ({
                name,
                production: () => store.searchConversations(query, filter),
                baseline: () => baselineSearch(baseline.db, query, filter),
            })),
            ...reads,
            {
                name: 'upsertStreamingTurn',
                production: async () => {
                    await store.upsertStreamingTurn('bench-native-stream', 'updated stream', true);
                    return streamingRows(store.getDatabase(), 'bench-native-stream');
                },
                baseline: () => baselineStreamingWrite(baseline.db),
            },
            {
                name: 'appendConversationTurn',
                production: async () => {
                    const result = await store.appendConversationTurn('bench-native-append', index => ({
                        role: 'assistant', content: `reply-${index}`, turnIndex: index,
                        timestamp: new Date('2026-01-01T00:00:00.000Z'), timeline: [],
                    }));
                    return { total: result.allTurns.length, results: result.allTurns };
                },
                baseline: () => baselineAppend(baseline.db),
            },
        ];
        const cases = [];
        for (const { name, production: runProduction, baseline: runBaseline } of workloads) {
            const production = await measure(
                runProduction, options.runs, name === 'dense');
            let comparison = null;
            if (baseline.status === 'available') {
                comparison = await measure(runBaseline, options.runs);
                assert.deepStrictEqual(
                    { total: comparison.total, results: comparison.results },
                    { total: production.total, results: production.results },
                    `${name}: baseline result differs from production`);
            }
            delete production.results;
            if (comparison) delete comparison.results;
            cases.push({ name, production, baseline: comparison,
                speedup: comparison ? comparison.p50Ms / production.p50Ms : null });
        }
        let profile;
        if (options.profile) {
            const db = store.getDatabase();
            const nativeReads = [
                ...SEARCHES.map(({ name, query, filter }) => ({
                    name,
                    run: () => db.searchConversations(query, {
                        workspaceId: filter.workspaceId, limit: filter.limit,
                    }),
                })),
                {
                    name: 'getConversationTurns',
                    run: async () => {
                        const results = await db.getConversationTurns('fixture-0');
                        return { total: results.length, results };
                    },
                },
                ...[false, true].map(excludeConversation => ({
                    name: excludeConversation
                        ? 'getAllProcesses (100, ws-a, exclude conversation)'
                        : 'getAllProcesses (100, ws-a)',
                    run: async () => {
                        const results = await db.getAllProcesses({
                            workspaceId: 'ws-a', limit: 100, excludeConversation,
                        });
                        return { total: results.length, results };
                    },
                })),
                {
                    name: 'getProcessSummaries (100, ws-a)',
                    run: async () => {
                        const page = await db.getProcessSummaries({ workspaceId: 'ws-a', limit: 100 });
                        return { total: page.total, results: page.rows };
                    },
                },
                {
                    name: 'listRecentProcesses (100, ws-a)',
                    run: async () => {
                        const results = await db.listRecentProcesses({ workspaceId: 'ws-a', limit: 100 });
                        return { total: results.length, results };
                    },
                },
            ];
            profile = [];
            for (const { name, run } of nativeReads) {
                const native = await measure(run, options.runs);
                const production = cases.find(item => item.name === name).production;
                assert.equal(native.total, production.total, `${name}: native count differs`);
                assert.equal(native.resultCount, production.resultCount, `${name}: native page differs`);
                profile.push({ name, nativeP50Ms: native.p50Ms, productionP50Ms: production.p50Ms });
            }
        }
        return {
            turns: options.turns, processes: Math.ceil(options.turns / 10),
            runs: options.runs, fixtureMs,
            comparison: baseline.status === 'available' ? 'output-equivalent' : 'unavailable',
            baseline: baseline.status === 'available'
                ? { status: 'available' } : { status: 'unavailable', reason: baseline.reason },
            cases,
            ...(profile ? { profile } : {}),
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
        `Comparison: ${report.comparison}`,
        'Read baselines hydrate full ProcessStore objects; --assert-p50 gates every output-equivalent p50.',
        ...report.cases.map(({ name, production, baseline, speedup }) =>
            `${name}: production p50 ${production.p50Ms.toFixed(2)} ms; ` +
            `better-sqlite3 p50 ${baseline ? `${baseline.p50Ms.toFixed(2)} ms` : 'unavailable'}; ` +
            `speedup ${speedup === null ? 'unavailable' : `${speedup.toFixed(2)}x`}; ` +
            `${production.total} total, ${production.resultCount} returned` +
            (name === 'dense' ? `; timer fired during async search: ${production.timerFiredDuringSearch}` : '')),
        ...(report.profile ?? []).map(({ name, nativeP50Ms, productionP50Ms }) =>
            `${name} (native read): ${nativeP50Ms.toFixed(2)} ms; Forge read: ${productionP50Ms.toFixed(2)} ms`),
    ].join('\n');
}

export function assertP50(report) {
    if (report.turns < 50_000) {
        throw new Error('p50 gate requires at least 50,000 turns');
    }
    if (report.baseline.status !== 'available' || report.comparison !== 'output-equivalent') {
        throw new Error('p50 gate requires an available, output-equivalent better-sqlite3 baseline');
    }
    const required = ['dense', 'getConversationTurns', 'getAllProcesses (100, ws-a)',
        'getProcessSummaries (100, ws-a)', 'listRecentProcesses (100, ws-a)',
        'upsertStreamingTurn', 'appendConversationTurn'];
    const missing = required.filter(name => !report.cases.some(item => item.name === name));
    if (missing.length > 0) {
        throw new Error(`p50 gate missing AC-07 workloads: ${missing.join(', ')}`);
    }
    const slower = report.cases.filter(({ baseline, production }) =>
        !baseline || production.p50Ms > baseline.p50Ms);
    if (slower.length > 0) {
        throw new Error(`p50 slower than better-sqlite3: ${slower.map(item => item.name).join(', ')}`);
    }
    if (!report.cases.find(item => item.name === 'dense')?.production.timerFiredDuringSearch) {
        throw new Error('event-loop timer did not fire during dense search');
    }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const report = await benchmark(options);
        console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
        if (options.assertP50) assertP50(report);
    } catch (error) {
        console.error(`process-search benchmark: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}
