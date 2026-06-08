/**
 * Tests for `recordRalphIteration` — the bridge's journal-write helper.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordRalphIteration } from '../../../src/server/ralph/record-iteration';
import { RalphSessionStore, parseProgressSections } from '../../../src/server/ralph/ralph-session-store';

let dataDir: string;
const WS = 'ws-1';
const SID = 'sess-rec';

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-iteration-test-'));
});
afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('recordRalphIteration', () => {
    it('returns skipped=true when dataDir is missing', async () => {
        const r = await recordRalphIteration({
            dataDir: undefined,
            workspaceId: WS,
            sessionId: SID,
            iteration: 1,
            maxIterations: 5,
            signal: 'RALPH_NEXT',
            progressBody: 'x',
            taskId: 't',
            processId: 'p',
            shouldContinue: true,
        });
        expect(r.skipped).toBe(true);
    });

    it('returns skipped=true when sessionId is missing', async () => {
        const r = await recordRalphIteration({
            dataDir,
            workspaceId: WS,
            sessionId: undefined,
            iteration: 1,
            maxIterations: 5,
            signal: 'RALPH_NEXT',
            progressBody: 'x',
            taskId: 't',
            processId: 'p',
            shouldContinue: true,
        });
        expect(r.skipped).toBe(true);
    });

    it('appends a section, seeds session.json, marks executing for next-iteration', async () => {
        const result = await recordRalphIteration({
            dataDir,
            workspaceId: WS,
            sessionId: SID,
            iteration: 1,
            maxIterations: 4,
            signal: 'RALPH_NEXT',
            progressBody: 'Files: a.ts\nDecisions: foo',
            taskId: 'task-1',
            processId: 'queue_p1',
            shouldContinue: true,
            originalGoal: 'Goal X',
            nowIso: '2026-05-11T08:00:00.000Z',
        });

        expect(result.skipped).toBe(false);
        expect(result.record!.phase).toBe('executing');
        expect(result.record!.currentIteration).toBe(1);
        expect(result.record!.iterations).toHaveLength(1);
        expect(result.record!.iterations[0]).toMatchObject({
            iteration: 1,
            taskId: 'task-1',
            processId: 'queue_p1',
            status: 'completed',
            exitSignal: 'RALPH_NEXT',
        });
        expect(result.record!.terminalReason).toBeUndefined();
        expect(result.record!.originalGoal).toBe('Goal X');

        const store = new RalphSessionStore({ dataDir });
        const md = await store.readProgress(WS, SID);
        const sections = parseProgressSections(md);
        expect(sections).toHaveLength(1);
        expect(sections[0].iteration).toBe(1);
        expect(sections[0].signal).toBe('RALPH_NEXT');
        expect(sections[0].body).toContain('Files: a.ts');
    });

    it('marks the session complete with terminalReason=RALPH_COMPLETE', async () => {
        const r = await recordRalphIteration({
            dataDir,
            workspaceId: WS,
            sessionId: SID,
            iteration: 3,
            maxIterations: 5,
            signal: 'RALPH_COMPLETE',
            progressBody: 'done',
            taskId: 't3',
            processId: 'p3',
            shouldContinue: false,
            originalGoal: 'g',
        });
        expect(r.record!.phase).toBe('complete');
        expect(r.record!.terminalReason).toBe('RALPH_COMPLETE');
        expect(r.record!.completedAt).toBeDefined();
    });

    it('marks terminalReason=CAP_REACHED when shouldContinue is false but signal is RALPH_NEXT', async () => {
        const r = await recordRalphIteration({
            dataDir,
            workspaceId: WS,
            sessionId: SID,
            iteration: 5,
            maxIterations: 5,
            signal: 'RALPH_NEXT',
            progressBody: 'still going',
            taskId: 't5',
            processId: 'p5',
            shouldContinue: false,
        });
        expect(r.record!.terminalReason).toBe('CAP_REACHED');
    });

    it('honors explicit terminalReason=MANUAL_VERIFICATION_ONLY for manual-only RALPH_NEXT', async () => {
        const r = await recordRalphIteration({
            dataDir,
            workspaceId: WS,
            sessionId: SID,
            iteration: 2,
            maxIterations: 5,
            signal: 'RALPH_NEXT',
            progressBody: 'Remaining: manual verification only',
            taskId: 't2',
            processId: 'p2',
            shouldContinue: false,
            terminalReason: 'MANUAL_VERIFICATION_ONLY',
        });
        expect(r.record!.phase).toBe('complete');
        expect(r.record!.terminalReason).toBe('MANUAL_VERIFICATION_ONLY');
    });

    it('marks terminalReason=NO_SIGNAL when no signal was emitted', async () => {
        const r = await recordRalphIteration({
            dataDir,
            workspaceId: WS,
            sessionId: SID,
            iteration: 2,
            maxIterations: 5,
            signal: 'NONE',
            progressBody: '',
            taskId: 't2',
            processId: 'p2',
            shouldContinue: false,
        });
        expect(r.record!.terminalReason).toBe('NO_SIGNAL');
    });

    it('preserves earlier iterations when called repeatedly', async () => {
        await recordRalphIteration({
            dataDir, workspaceId: WS, sessionId: SID,
            iteration: 1, maxIterations: 3, signal: 'RALPH_NEXT',
            progressBody: 'first', taskId: 't1', processId: 'p1', shouldContinue: true,
        });
        const r2 = await recordRalphIteration({
            dataDir, workspaceId: WS, sessionId: SID,
            iteration: 2, maxIterations: 3, signal: 'RALPH_COMPLETE',
            progressBody: 'second', taskId: 't2', processId: 'p2', shouldContinue: false,
        });
        expect(r2.record!.iterations.map(i => i.iteration)).toEqual([1, 2]);
        expect(r2.record!.iterations[0].exitSignal).toBe('RALPH_NEXT');
        expect(r2.record!.iterations[1].exitSignal).toBe('RALPH_COMPLETE');
    });

    it('falls back to a placeholder when the AI omitted RALPH_PROGRESS body', async () => {
        await recordRalphIteration({
            dataDir, workspaceId: WS, sessionId: SID,
            iteration: 1, maxIterations: 5, signal: 'RALPH_NEXT',
            progressBody: '', taskId: 't', processId: 'p', shouldContinue: true,
        });
        const md = await new RalphSessionStore({ dataDir }).readProgress(WS, SID);
        expect(md).toContain('(no RALPH_PROGRESS body provided)');
    });

    it('skips the safety-net append when journal mtime advanced past iterationStartMs (AI wrote a section)', async () => {
        const fs = await import('fs');
        const pathMod = await import('path');
        // Pre-create the journal with an AI-written section. mtime > startMs.
        const startMs = Date.now() - 60_000;
        const journalPath = new (await import('../../../src/server/ralph/ralph-session-store')).RalphSessionStore({ dataDir }).getProgressPath(WS, SID);
        fs.mkdirSync(pathMod.dirname(journalPath), { recursive: true });
        fs.writeFileSync(journalPath, '# header\n\n## Iteration 1 — RALPH_NEXT — t\nai-wrote\n', 'utf-8');

        const result = await recordRalphIteration({
            dataDir, workspaceId: WS, sessionId: SID,
            iteration: 1, maxIterations: 5, signal: 'RALPH_NEXT',
            progressBody: 'safety-net body', taskId: 't', processId: 'p',
            shouldContinue: true, iterationStartMs: startMs,
        });
        expect(result.aiWroteSection).toBe(true);

        const md = fs.readFileSync(journalPath, 'utf-8');
        // safety-net body must NOT have been appended
        expect(md).not.toContain('safety-net body');
        // AI section is preserved
        expect(md).toContain('ai-wrote');
        // session.json is still updated
        expect(result.record!.currentIteration).toBe(1);
    });

    it('writes the safety-net section when iterationStartMs is given but journal mtime did NOT advance', async () => {
        const future = Date.now() + 60_000;
        const result = await recordRalphIteration({
            dataDir, workspaceId: WS, sessionId: SID,
            iteration: 1, maxIterations: 5, signal: 'RALPH_NEXT',
            progressBody: 'safety-net body', taskId: 't', processId: 'p',
            shouldContinue: true, iterationStartMs: future,
        });
        expect(result.aiWroteSection).toBe(false);
        const md = await new (await import('../../../src/server/ralph/ralph-session-store')).RalphSessionStore({ dataDir }).readProgress(WS, SID);
        expect(md).toContain('safety-net body');
    });
});
