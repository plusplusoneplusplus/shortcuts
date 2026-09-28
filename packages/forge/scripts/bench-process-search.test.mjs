import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchmark, formatReport, p50, parseArgs } from './bench-process-search.mjs';

test('CLI options and p50 reject invalid fixtures and summarize even samples', () => {
    assert.deepEqual(parseArgs([]), { turns: 50_000, runs: 5, json: false });
    assert.deepEqual(parseArgs(['--turns', '250', '--runs', '2', '--json']),
        { turns: 250, runs: 2, json: true });
    for (const args of [['--turns', '0'], ['--runs', '-1'], ['--turns', '1.5'],
        ['--turns'], ['--runs', '9007199254740992'], ['--unknown']]) {
        assert.throws(() => parseArgs(args));
    }
    assert.equal(p50([3, 1, 4, 2]), 2.5);
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
            ['getConversationTurns', 10], ['getAllProcesses (100, ws-a)', 100]]);
    for (const item of report.cases) {
        assert.equal(item.production.samplesMs.length, 2);
        assert.ok(item.production.p50Ms > 0);
        assert.equal(item.production.resultCount, item.name === 'getConversationTurns' ? 10
            : item.name.startsWith('getAllProcesses') ? 100 : 20);
        assert.match(item.production.firstHit.processId, /^fixture-/);
        if (['dense', 'workspace', 'sparse'].includes(item.name)) {
            assert.match(item.production.firstHit.snippet, /<mark>/);
            assert.equal(item.production.firstHit.role, 'user');
        }
        assert.equal(item.baseline, null);
        assert.equal(item.speedup, null);
    }
    assert.equal(report.cases[0].production.timerFiredDuringSearch, true);
    assert.match(formatReport(report), /better-sqlite3 p50 unavailable/);
    assert.match(formatReport(report), /timer fired during async search: true/);
});

test('local better-sqlite3 baseline, when present, matches production result shape', async (context) => {
    const report = await benchmark({ turns: 120, runs: 1 });
    if (report.baseline.status === 'unavailable') {
        context.diagnostic(report.baseline.reason);
        assert.ok(report.cases.every(item => item.baseline === null && item.speedup === null));
        return;
    }
    for (const item of report.cases) {
        assert.equal(item.baseline.total, item.production.total);
        assert.equal(item.baseline.resultCount, item.production.resultCount);
        assert.deepEqual(item.baseline.firstHit, item.production.firstHit);
        assert.ok(item.baseline.p50Ms > 0);
        assert.ok(item.speedup > 0);
    }
});
