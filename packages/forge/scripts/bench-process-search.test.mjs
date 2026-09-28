import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { assertP50, benchmark, formatReport, measure, p50, parseArgs } from './bench-process-search.mjs';

const require = createRequire(import.meta.url);

test('CLI options and p50 reject invalid fixtures and summarize even samples', () => {
    assert.deepEqual(parseArgs([]), {
        turns: 50_000, runs: 5, json: false, assertP50: false, profile: false,
    });
    assert.deepEqual(parseArgs(['--turns', '250', '--runs', '2', '--json']),
        { turns: 250, runs: 2, json: true, assertP50: false, profile: false });
    assert.equal(parseArgs(['--assert-p50']).assertP50, true);
    assert.equal(parseArgs(['--profile']).profile, true);
    for (const args of [['--turns', '0'], ['--runs', '-1'], ['--turns', '1.5'],
        ['--turns'], ['--runs', '9007199254740992'], ['--unknown']]) {
        assert.throws(() => parseArgs(args));
    }
    assert.equal(p50([3, 1, 4, 2]), 2.5);
});

test('p50 gate requires a real 50k baseline, all methods no slower, and an active timer', () => {
    const dense = { name: 'dense', production: { p50Ms: 3, timerFiredDuringSearch: true },
        baseline: { p50Ms: 3 } };
    const reads = { name: 'getConversationTurns', production: { p50Ms: 2 },
        baseline: { p50Ms: 3 } };
    const otherReads = ['getAllProcesses (100, ws-a)', 'getProcessSummaries (100, ws-a)',
        'listRecentProcesses (100, ws-a)', 'upsertStreamingTurn', 'appendConversationTurn']
        .map(name => ({ ...reads, name }));
    const report = { turns: 50_000, baseline: { status: 'available' },
        comparison: 'output-equivalent', cases: [dense, reads, ...otherReads] };
    assert.doesNotThrow(() => assertP50(report));
    assert.throws(() => assertP50({ ...report, turns: 4_000 }), /50,000 turns/);
    assert.throws(() => assertP50({ ...report, baseline: { status: 'unavailable' } }), /available/);
    assert.throws(() => assertP50({ ...report, comparison: 'unavailable' }), /output-equivalent/);
    assert.throws(() => assertP50({ ...report, cases: [reads, ...otherReads] }), /missing AC-07 workloads.*dense/);
    assert.throws(() => assertP50({ ...report, cases: [{ ...dense, production: { p50Ms: 4 } }, reads,
        ...otherReads] }),
        /p50 slower.*dense/);
    assert.throws(() => assertP50({ ...report, cases: [{ ...dense, production: {
        p50Ms: 3, timerFiredDuringSearch: false,
    } }, reads, ...otherReads] }), /event-loop timer/);
});

test('real compiled production search reports counts, p50, and timer responsiveness', async () => {
    const report = await benchmark({ turns: 4_000, runs: 2 }, {
        baselineFactory: () => ({ status: 'unavailable', reason: 'not installed' }),
    });
    assert.equal(report.turns, 4_000);
    assert.equal(report.processes, 400);
    assert.deepEqual(report.baseline, { status: 'unavailable', reason: 'not installed' });
    assert.deepEqual(report.cases.map(item => [item.name, item.production.total]),
        [['dense', 4_000], ['workspace', 2_000], ['sparse', 40],
            ['getConversationTurns', 10], ['getAllProcesses (100, ws-a)', 100],
            ['getAllProcesses (100, ws-a, exclude conversation)', 100],
            ['getProcessSummaries (100, ws-a)', 200],
            ['listRecentProcesses (100, ws-a)', 100],
            ['upsertStreamingTurn', 1], ['appendConversationTurn', 3]]);
    for (const item of report.cases) {
        assert.equal(item.production.samplesMs.length, 2);
        assert.ok(item.production.p50Ms > 0);
        assert.equal(item.production.resultCount, item.name === 'getConversationTurns' ? 10
            : item.name === 'upsertStreamingTurn' ? 1
            : item.name === 'appendConversationTurn' ? 3
            : ['dense', 'workspace', 'sparse'].includes(item.name) ? 20 : 100);
        assert.equal(item.baseline, null);
        assert.equal(item.speedup, null);
    }
    assert.equal(report.cases[0].production.timerFiredDuringSearch, true);
    assert.equal(report.comparison, 'unavailable');
    assert.match(formatReport(report), /better-sqlite3 p50 unavailable/);
    assert.match(formatReport(report), /Comparison: unavailable/);
    assert.match(formatReport(report), /timer fired during async search: true/);
});

test('optional native read profile reports the same page and count before Forge hydration', async () => {
    const report = await benchmark({ turns: 120, runs: 1, profile: true }, {
        baselineFactory: () => ({ status: 'unavailable', reason: 'not installed' }),
    });
    assert.deepEqual(report.profile.map(item => item.name), report.cases.slice(0, 8).map(item => item.name));
    for (const item of report.profile) {
        assert.ok(item.nativeP50Ms > 0);
        assert.equal(item.productionP50Ms, report.cases.find(entry => entry.name === item.name).production.p50Ms);
    }
    assert.match(formatReport(report), /getConversationTurns \(native read\): .*Forge read:/);
    assert.throws(() => assertP50(report), /50,000 turns/);
});

test('timer observation requires callback before completion, not just eventual firing', async () => {
    const result = { total: 0, results: [] };
    assert.equal((await measure(() => Promise.resolve(result), 1, true)).timerFiredDuringSearch, false);
    assert.equal((await measure(() => new Promise(resolve =>
        setTimeout(() => resolve(result), 20)), 1, true)).timerFiredDuringSearch, true);
});

test('local better-sqlite3 baseline, when present, matches production result shape', async (context) => {
    const report = await benchmark({ turns: 120, runs: 1 });
    if (report.baseline.status === 'unavailable') {
        context.diagnostic(report.baseline.reason);
        assert.equal(report.comparison, 'unavailable');
        assert.ok(report.cases.every(item => item.baseline === null && item.speedup === null));
        return;
    }
    assert.equal(report.comparison, 'output-equivalent');
    for (const item of report.cases) {
        assert.equal(item.baseline.total, item.production.total);
        assert.equal(item.baseline.resultCount, item.production.resultCount);
        assert.ok(item.baseline.p50Ms > 0);
        assert.ok(item.speedup > 0);
    }
});

test('rejects mismatched hydrated output instead of reporting speedup', async context => {
    let BetterSqlite3;
    try {
        BetterSqlite3 = require('better-sqlite3');
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
        context.skip('optional better-sqlite3 not installed');
        return;
    }
    await assert.rejects(benchmark({ turns: 120, runs: 1 }, {
        baselineFactory: dbPath => {
            const db = new BetterSqlite3(dbPath, { readonly: true });
            return { status: 'available', db: {
                prepare(sql) {
                    const statement = db.prepare(sql);
                    if (!sql.startsWith('SELECT * FROM conversation_turns')) return statement;
                    return {
                        all(...args) {
                            return statement.all(...args).map((row, index) =>
                                index === 0 ? { ...row, content: 'incorrect turn' } : row);
                        },
                    };
                },
                close() { db.close(); },
            } };
        },
    }), /baseline result differs from production/);
});
