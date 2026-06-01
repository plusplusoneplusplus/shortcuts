/**
 * Tests for RalphSessionStore — file I/O, atomic writes, parsing, size cap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    RalphSessionStore,
    parseProgressSections,
    normaliseSessionRecord,
} from '../../../src/server/ralph/ralph-session-store';

let dataDir: string;
let store: RalphSessionStore;

const WS = 'ws-1';
const SID = 'sess-abc';

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-session-store-test-'));
    store = new RalphSessionStore({ dataDir });
});

afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('RalphSessionStore — paths', () => {
    it('locates session dir under repos/<wsId>/ralph-sessions/<sid>/', () => {
        const dir = store.getSessionDir(WS, SID);
        expect(dir).toContain(path.join('repos', WS, 'ralph-sessions', SID));
        expect(store.getProgressPath(WS, SID)).toBe(path.join(dir, 'progress.md'));
        expect(store.getSessionRecordPath(WS, SID)).toBe(path.join(dir, 'session.json'));
    });
});

describe('RalphSessionStore — initSession', () => {
    it('creates session.json and progress.md with header on first call', async () => {
        await store.initSession(WS, SID, {
            originalGoal: 'Build the auth feature',
            maxIterations: 7,
            startedAt: '2026-05-11T08:00:00Z',
        });

        const rec = await store.readSessionRecord(WS, SID);
        expect(rec).not.toBeNull();
        expect(rec!.sessionId).toBe(SID);
        expect(rec!.workspaceId).toBe(WS);
        expect(rec!.originalGoal).toBe('Build the auth feature');
        expect(rec!.maxIterations).toBe(7);
        expect(rec!.currentIteration).toBe(0);
        expect(rec!.phase).toBe('executing');
        expect(rec!.iterations).toEqual([]);
        expect(rec!.startedAt).toBe('2026-05-11T08:00:00Z');

        const progress = await store.readProgress(WS, SID);
        expect(progress).toContain(`# Ralph Session: ${SID}`);
        expect(progress).toContain('Goal: Build the auth feature');
        expect(progress).toContain('Started: 2026-05-11T08:00:00Z');
    });

    it('is idempotent — does not overwrite existing record or progress', async () => {
        await store.initSession(WS, SID, { originalGoal: 'first', maxIterations: 5 });
        await store.appendProgressSection(WS, SID, {
            iteration: 1,
            signal: 'RALPH_NEXT',
            timestamp: '2026-05-11T08:05:00Z',
            body: 'did stuff',
        });
        const before = await store.readProgress(WS, SID);
        const recBefore = await store.readSessionRecord(WS, SID);

        await store.initSession(WS, SID, { originalGoal: 'second', maxIterations: 99 });

        const after = await store.readProgress(WS, SID);
        const recAfter = await store.readSessionRecord(WS, SID);
        expect(after).toBe(before);
        expect(recAfter!.originalGoal).toBe('first');
        expect(recAfter!.maxIterations).toBe(5);
    });

    it('truncates very long single-line goals in the progress.md header', async () => {
        const huge = 'x'.repeat(500);
        await store.initSession(WS, SID, { originalGoal: huge, maxIterations: 1 });
        const progress = await store.readProgress(WS, SID);
        const goalLine = progress.split('\n').find((l) => l.startsWith('Goal: '))!;
        // Goal: prefix + capped body length
        expect(goalLine.length).toBeLessThanOrEqual('Goal: '.length + 240);
        expect(goalLine.endsWith('...')).toBe(true);
    });
});

describe('RalphSessionStore — appendProgressSection', () => {
    it('appends a parseable section block', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 5 });
        await store.appendProgressSection(WS, SID, {
            iteration: 1,
            signal: 'RALPH_NEXT',
            timestamp: '2026-05-11T08:05:00Z',
            body: 'Files: src/a.ts\nDecisions: chose foo\nRemaining: nothing',
        });
        await store.appendProgressSection(WS, SID, {
            iteration: 2,
            signal: 'RALPH_COMPLETE',
            timestamp: '2026-05-11T08:10:00Z',
            body: 'Files: src/b.ts',
        });

        const md = await store.readProgress(WS, SID);
        const sections = parseProgressSections(md);
        expect(sections).toHaveLength(2);
        expect(sections[0]).toMatchObject({
            iteration: 1,
            signal: 'RALPH_NEXT',
            timestamp: '2026-05-11T08:05:00Z',
        });
        expect(sections[0].body).toContain('Files: src/a.ts');
        expect(sections[0].body).toContain('Remaining: nothing');
        expect(sections[1].iteration).toBe(2);
        expect(sections[1].signal).toBe('RALPH_COMPLETE');
    });

    it('creates the session directory lazily if missing', async () => {
        await store.appendProgressSection(WS, SID, {
            iteration: 1,
            signal: 'RALPH_NEXT',
            timestamp: '2026-05-11T08:05:00Z',
            body: 'lazy create',
        });
        const md = await store.readProgress(WS, SID);
        expect(md).toContain('## Iteration 1 — RALPH_NEXT');
    });
});

describe('RalphSessionStore — updateSessionRecord', () => {
    it('atomically updates record and round-trips', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 5 });

        const updated = await store.updateSessionRecord(WS, SID, (rec) => {
            const r = rec!;
            r.currentIteration = 3;
            r.iterations.push({
                iteration: 1,
                taskId: 't1',
                processId: 'queue_p1',
                startedAt: '2026-05-11T08:00:00Z',
                endedAt: '2026-05-11T08:05:00Z',
                status: 'completed',
                exitSignal: 'RALPH_NEXT',
            });
            return r;
        });

        expect(updated.currentIteration).toBe(3);
        expect(updated.iterations).toHaveLength(1);

        const reread = await store.readSessionRecord(WS, SID);
        expect(reread!.currentIteration).toBe(3);
        expect(reread!.iterations[0].taskId).toBe('t1');
    });

    it('leaves no .tmp leftover after an update', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 5 });
        await store.updateSessionRecord(WS, SID, (rec) => ({
            ...rec!,
            currentIteration: 1,
        }));
        const dir = store.getSessionDir(WS, SID);
        const entries = fs.readdirSync(dir);
        expect(entries.some((e) => e.includes('.tmp-'))).toBe(false);
    });

    it('recovers from a malformed session.json by treating it as missing', async () => {
        const recordPath = store.getSessionRecordPath(WS, SID);
        fs.mkdirSync(path.dirname(recordPath), { recursive: true });
        fs.writeFileSync(recordPath, '{not json', 'utf-8');
        const rec = await store.readSessionRecord(WS, SID);
        expect(rec).toBeNull();
    });
});

describe('RalphSessionStore — progressMtimeAfter', () => {
    it('returns false when the file does not exist', async () => {
        const after = await store.progressMtimeAfter(WS, SID, Date.now());
        expect(after).toBe(false);
    });

    it('returns true after appending a section', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 1 });
        const beforeMs = Date.now() - 10_000;
        await store.appendProgressSection(WS, SID, {
            iteration: 1, signal: 'RALPH_NEXT', timestamp: 'now', body: 'x',
        });
        expect(await store.progressMtimeAfter(WS, SID, beforeMs)).toBe(true);
    });
});

describe('parseProgressSections', () => {
    it('returns [] for empty input', () => {
        expect(parseProgressSections('')).toEqual([]);
    });

    it('skips intro text before the first iteration header', () => {
        const md = `# Ralph Session: x\nGoal: foo\nStarted: 2026\n\n## Iteration 1 — RALPH_NEXT — t1\nbody1`;
        const out = parseProgressSections(md);
        expect(out).toHaveLength(1);
        expect(out[0].body).toBe('body1');
    });

    it('handles dashes (-) as a fallback for em-dash headers', () => {
        const md = `## Iteration 1 - RALPH_NEXT - 2026-05-11\nfoo`;
        const out = parseProgressSections(md);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ iteration: 1, signal: 'RALPH_NEXT', timestamp: '2026-05-11', body: 'foo' });
    });

    it('ignores lines that look like headers but do not match grammar', () => {
        const md = `## Iteration ABC — RALPH_NEXT — t1\n## Other heading\n## Iteration 2 — RALPH_COMPLETE — t2\nbody2`;
        const out = parseProgressSections(md);
        expect(out).toHaveLength(1);
        expect(out[0].iteration).toBe(2);
    });
});

describe('RalphSessionStore — size cap', () => {
    it('truncates progress.md to ~500 KB + banner once it exceeds 10 MB', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 2 });

        // Pre-fill the file directly to ~10 MB so the next append crosses
        // the cap. Direct file write keeps the test fast (no 10 000 small
        // appendProgressSection calls).
        const progressPath = store.getProgressPath(WS, SID);
        const blob = 'A'.repeat(10 * 1024 * 1024 + 200 * 1024);
        await fs.promises.appendFile(progressPath, blob, 'utf-8');

        const before = await fs.promises.stat(progressPath);
        expect(before.size).toBeGreaterThan(10 * 1024 * 1024);

        // Triggering one more append runs enforceSizeCap.
        await store.appendProgressSection(WS, SID, {
            iteration: 1,
            signal: 'RALPH_NEXT',
            timestamp: '2026-05-11T00:00:00.000Z',
            body: 'tail-section',
        });

        const after = await fs.promises.stat(progressPath);
        // Kept tail (~500 KB) + small banner. Allow some slack for the
        // banner text and the appended section itself.
        expect(after.size).toBeLessThan(700 * 1024);

        const contents = await fs.promises.readFile(progressPath, 'utf-8');
        expect(contents).toContain('Ralph Session (truncated)');
        expect(contents).toContain('earlier content removed');
        // The most recent append must survive the truncation.
        expect(contents).toContain('## Iteration 1 — RALPH_NEXT');
        expect(contents).toContain('tail-section');
    });

    it('does not touch progress.md while it is below the 10 MB cap', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 2 });
        await store.appendProgressSection(WS, SID, {
            iteration: 1,
            signal: 'RALPH_NEXT',
            timestamp: 't',
            body: 'small body',
        });
        const contents = await fs.promises.readFile(store.getProgressPath(WS, SID), 'utf-8');
        expect(contents).not.toContain('Ralph Session (truncated)');
        expect(contents).toContain('## Iteration 1 — RALPH_NEXT — t');
    });
});

describe('RalphSessionStore — startNewLoop', () => {
    async function makeCompleteSession(goal = 'goal-1', iterations = 3): Promise<void> {
        await store.initSession(WS, SID, {
            originalGoal: goal,
            maxIterations: iterations,
            startedAt: '2026-05-01T10:00:00Z',
        });
        await store.updateSessionRecord(WS, SID, (rec) => ({
            ...rec!,
            phase: 'complete',
            terminalReason: 'RALPH_COMPLETE',
            currentIteration: iterations,
            completedAt: '2026-05-01T12:00:00Z',
        }));
    }

    it('happy path: resets phase and bumps maxIterations, creates two loops', async () => {
        await makeCompleteSession('goal-1', 3);
        const updated = await store.startNewLoop(
            WS, SID, 'goal-2', 20, '2026-05-01T13:00:00Z',
        );

        expect(updated.phase).toBe('executing');
        expect(updated.maxIterations).toBe(23);
        expect(updated.terminalReason).toBeUndefined();
        expect(updated.completedAt).toBeUndefined();
        expect(updated.loops).toHaveLength(2);
        expect(updated.loops![0]).toMatchObject({
            loopIndex: 1,
            goal: 'goal-1',
            startIteration: 1,
            endIteration: 3,
            terminalReason: 'RALPH_COMPLETE',
        });
        expect(updated.loops![1]).toMatchObject({
            loopIndex: 2,
            goal: 'goal-2',
            startIteration: 4,
            startedAt: '2026-05-01T13:00:00Z',
        });
    });

    it('appends a loop banner to progress.md', async () => {
        await makeCompleteSession('goal-1', 3);
        await store.startNewLoop(WS, SID, 'goal-2', 20, '2026-05-01T13:00:00Z');
        const md = await store.readProgress(WS, SID);
        expect(md).toContain('## Loop 2 — 2026-05-01T13:00:00Z');
        expect(md).toContain('Goal: goal-2');
    });

    it('throws 404 when session does not exist', async () => {
        const err = await store.startNewLoop(WS, 'no-such-session', 'goal', 5).catch(e => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as any).statusCode).toBe(404);
    });

    it('throws 409 when phase is not complete (still executing)', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 10 });
        const err = await store.startNewLoop(WS, SID, 'new-goal', 5).catch(e => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as any).statusCode).toBe(409);
        expect(err.message).toContain('executing');
    });

    it('throws 409 when terminalReason is CAP_REACHED (not RALPH_COMPLETE)', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 3 });
        await store.updateSessionRecord(WS, SID, (rec) => ({
            ...rec!,
            phase: 'complete',
            terminalReason: 'CAP_REACHED',
            currentIteration: 3,
        }));
        const err = await store.startNewLoop(WS, SID, 'new-goal', 5).catch(e => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as any).statusCode).toBe(409);
        expect(err.message).toContain('CAP_REACHED');
    });

    it('lazily initialises loops[] from originalGoal when absent', async () => {
        await makeCompleteSession('original-goal', 5);
        // Remove loops field to simulate pre-existing record
        const recordPath = store.getSessionRecordPath(WS, SID);
        const raw = JSON.parse(await (await import('fs')).promises.readFile(recordPath, 'utf-8'));
        delete raw.loops;
        await (await import('fs')).promises.writeFile(recordPath, JSON.stringify(raw, null, 2), 'utf-8');

        const updated = await store.startNewLoop(WS, SID, 'new-goal', 10, '2026-05-01T15:00:00Z');
        expect(updated.loops).toHaveLength(2);
        expect(updated.loops![0].goal).toBe('original-goal');
        expect(updated.loops![0].loopIndex).toBe(1);
        expect(updated.loops![1].goal).toBe('new-goal');
        expect(updated.loops![1].loopIndex).toBe(2);
    });

    it('idempotent banner: calling twice with same timestamp does not double-append', async () => {
        await makeCompleteSession('goal-1', 3);
        const ts = '2026-05-01T14:00:00Z';
        await store.startNewLoop(WS, SID, 'goal-2', 10, ts);
        // Manually reset phase for the second call (simulating concurrent race)
        await store.updateSessionRecord(WS, SID, (rec) => ({
            ...rec!,
            phase: 'complete',
            terminalReason: 'RALPH_COMPLETE',
        }));
        await store.startNewLoop(WS, SID, 'goal-2', 10, ts);

        const md = await store.readProgress(WS, SID);
        const occurrences = (md.match(/## Loop 2 — 2026-05-01T14:00:00Z/g) ?? []).length;
        expect(occurrences).toBe(1);
    });

    it('goal preview is truncated to 200 chars in banner', async () => {
        await makeCompleteSession('goal-1', 1);
        const longGoal = 'x'.repeat(300);
        await store.startNewLoop(WS, SID, longGoal, 5, '2026-05-01T16:00:00Z');
        const md = await store.readProgress(WS, SID);
        const goalLine = md.split('\n').find(l => l.startsWith('Goal: '))!;
        // "Goal: " prefix (6 chars) + up to 200 chars + ellipsis char
        expect(goalLine.length).toBeLessThanOrEqual('Goal: '.length + 201);
    });
});

describe('normaliseSessionRecord', () => {
    it('sets loopIndex: 1 on iterations that lack the field', () => {
        const raw = {
            sessionId: 's1',
            workspaceId: 'ws1',
            originalGoal: 'goal',
            maxIterations: 5,
            currentIteration: 2,
            phase: 'complete',
            startedAt: '2026-01-01T00:00:00Z',
            iterations: [
                { iteration: 1, taskId: 't1', processId: 'p1', startedAt: '2026-01-01T00:00:00Z', status: 'completed' },
                { iteration: 2, taskId: 't2', processId: 'p2', startedAt: '2026-01-01T01:00:00Z', status: 'completed' },
            ],
        };
        const result = normaliseSessionRecord(raw);
        expect(result.iterations[0].loopIndex).toBe(1);
        expect(result.iterations[1].loopIndex).toBe(1);
    });

    it('leaves loopIndex unchanged when already set', () => {
        const raw = {
            sessionId: 's1',
            workspaceId: 'ws1',
            originalGoal: 'goal',
            maxIterations: 10,
            currentIteration: 5,
            phase: 'complete',
            startedAt: '2026-01-01T00:00:00Z',
            iterations: [
                { iteration: 1, loopIndex: 1, taskId: 't1', processId: 'p1', startedAt: '2026-01-01T00:00:00Z', status: 'completed' },
                { iteration: 5, loopIndex: 2, taskId: 't5', processId: 'p5', startedAt: '2026-01-01T04:00:00Z', status: 'completed' },
            ],
        };
        const result = normaliseSessionRecord(raw);
        expect(result.iterations[0].loopIndex).toBe(1);
        expect(result.iterations[1].loopIndex).toBe(2);
    });

    it('handles records with no iterations gracefully', () => {
        const raw = {
            sessionId: 's1',
            workspaceId: 'ws1',
            originalGoal: 'goal',
            maxIterations: 5,
            currentIteration: 0,
            phase: 'executing',
            startedAt: '2026-01-01T00:00:00Z',
            iterations: [],
        };
        const result = normaliseSessionRecord(raw);
        expect(result.iterations).toEqual([]);
    });

    it('round-trips through readSessionRecord persisting loopIndex', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 3 });
        // Write a session.json without loopIndex on iterations
        const recordPath = store.getSessionRecordPath(WS, SID);
        const raw = JSON.parse(await fs.promises.readFile(recordPath, 'utf-8'));
        raw.iterations = [
            { iteration: 1, taskId: 't1', processId: 'p1', startedAt: '2026-01-01T00:00:00Z', status: 'completed', exitSignal: 'RALPH_NEXT' },
        ];
        await fs.promises.writeFile(recordPath, JSON.stringify(raw, null, 2), 'utf-8');

        const read = await store.readSessionRecord(WS, SID);
        expect(read).not.toBeNull();
        expect(read!.iterations[0].loopIndex).toBe(1);
    });
});

describe('RalphSessionStore — appendResumeMarker', () => {
    it('appends a resume marker to progress.md', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 10 });
        await store.appendResumeMarker(WS, SID, 3, '2026-06-01T10:00:00Z');

        const md = await store.readProgress(WS, SID);
        expect(md).toContain('## Session resumed at 2026-06-01T10:00:00Z — picking up from iteration 3');
    });

    it('is idempotent for same timestamp and iteration', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 10 });
        await store.appendResumeMarker(WS, SID, 5, '2026-06-01T12:00:00Z');
        await store.appendResumeMarker(WS, SID, 5, '2026-06-01T12:00:00Z');

        const md = await store.readProgress(WS, SID);
        const markers = md.match(/Session resumed at/g) ?? [];
        expect(markers).toHaveLength(1);
    });

    it('appends a second marker with a different timestamp', async () => {
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 10 });
        await store.appendResumeMarker(WS, SID, 3, '2026-06-01T10:00:00Z');
        await store.appendResumeMarker(WS, SID, 5, '2026-06-01T14:00:00Z');

        const md = await store.readProgress(WS, SID);
        const markers = md.match(/Session resumed at/g) ?? [];
        expect(markers).toHaveLength(2);
    });

    it('creates progress.md if it does not exist', async () => {
        const dir = store.getSessionDir(WS, SID);
        await fs.promises.mkdir(dir, { recursive: true });
        await store.appendResumeMarker(WS, SID, 1, '2026-06-01T08:00:00Z');

        const md = await store.readProgress(WS, SID);
        expect(md).toContain('Session resumed at 2026-06-01T08:00:00Z');
    });
});
