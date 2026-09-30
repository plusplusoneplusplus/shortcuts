/**
 * RALPH_NEEDS_INPUT handling in the CoC iteration orchestrator.
 *
 * Covers:
 *  - a valid question block parks the session in `awaiting-input`, persists
 *    `pendingInput`, enqueues nothing and broadcasts no session-complete
 *  - the pending request survives a fresh store (server restart)
 *  - the journal section header uses RALPH_NEEDS_INPUT
 *  - the awaiting-input broadcast fires with the asking iteration
 *  - a malformed block falls back to the normal signal path
 *  - asking at the iteration cap still pauses instead of CAP_REACHED
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    orchestrateRalphIteration,
    type OrchestrateRalphIterationDeps,
} from '../../../src/server/ralph/orchestrate-iteration';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { _clearFinalCheckEnqueuedSet } from '../../../src/server/ralph/enqueue-final-check';
import { createMockProcessStore } from '../helpers/mock-process-store';

const WS = 'ws-needs-input';
const SID = 'sess-needs-input';
const PROCESS_ID = 'proc-ni';
const TASK_ID = 'task-ni';

const REQUEST = {
    context: 'The [decision] says SQLite but the repo only ships Postgres.',
    questions: [
        {
            question: 'Which database should the store use?',
            type: 'select',
            options: [
                { value: 'sqlite', label: 'SQLite' },
                { value: 'postgres', label: 'Postgres' },
            ],
            recommendation: 'postgres',
        },
    ],
};

function makeNeedsInputResponse(request: unknown = REQUEST): string {
    return [
        'Found a conflict with a decision item.',
        '',
        'RALPH_PROGRESS:',
        'Files: none',
        'Decisions: blocked on database choice',
        'Remaining: pick the database',
        'RALPH_NEEDS_INPUT',
        '```json',
        JSON.stringify(request, null, 2),
        '```',
    ].join('\n');
}

function makeDeps(overrides?: Partial<OrchestrateRalphIterationDeps>): OrchestrateRalphIterationDeps {
    return {
        enqueueTask: vi.fn().mockReturnValue('new-task-id'),
        broadcastSessionComplete: vi.fn(),
        broadcastAwaitingInput: vi.fn(),
        workingDirectory: '/work',
        folderPath: '/folder',
        repoId: WS,
        existingTaskConfig: {},
        ...overrides,
    };
}

describe('orchestrateRalphIteration — RALPH_NEEDS_INPUT', () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'orch-iter-ni-'));
        _clearFinalCheckEnqueuedSet();
        await new RalphSessionStore({ dataDir }).initSession(WS, SID, {
            originalGoal: 'Do the goal.',
            maxIterations: 5,
        });
    });

    afterEach(async () => {
        _clearFinalCheckEnqueuedSet();
        await fs.promises.rm(dataDir, { recursive: true, force: true });
    });

    async function run(responseText: string, currentIteration = 2, deps = makeDeps({ dataDir })) {
        await orchestrateRalphIteration({
            responseText,
            completedTaskId: TASK_ID,
            processId: PROCESS_ID,
            workspaceId: WS,
            sessionId: SID,
            originalGoal: 'Do the goal.',
            currentIteration,
            maxIterations: 5,
            deps,
        });
        return deps;
    }

    it('parks the session in awaiting-input without enqueueing or completing', async () => {
        const deps = await run(makeNeedsInputResponse());

        expect(deps.enqueueTask).not.toHaveBeenCalled();
        expect(deps.broadcastSessionComplete).not.toHaveBeenCalled();

        const record = await new RalphSessionStore({ dataDir }).readSessionRecord(WS, SID);
        expect(record?.phase).toBe('awaiting-input');
        expect(record?.terminalReason).toBeUndefined();
        expect(record?.completedAt).toBeUndefined();
        expect(record?.currentIteration).toBe(2);
        expect(record?.iterations.find(i => i.iteration === 2)?.exitSignal).toBe('RALPH_NEEDS_INPUT');
        expect(record?.pendingInput).toMatchObject({
            iteration: 2,
            taskId: TASK_ID,
            processId: PROCESS_ID,
            request: REQUEST,
        });
        expect(typeof record?.pendingInput?.requestedAt).toBe('string');
    });

    it('keeps the pending request after a store reload (server restart)', async () => {
        await run(makeNeedsInputResponse());

        const reloaded = new RalphSessionStore({ dataDir });
        const record = await reloaded.readSessionRecord(WS, SID);
        expect(record?.phase).toBe('awaiting-input');
        expect(record?.pendingInput?.request.questions[0].recommendation).toBe('postgres');
    });

    it('writes the journal section with RALPH_NEEDS_INPUT as the signal', async () => {
        await run(makeNeedsInputResponse());

        const store = new RalphSessionStore({ dataDir });
        const sections = RalphSessionStore.parseProgressSections(await store.readProgress(WS, SID));
        const section = sections.find(s => s.iteration === 2);
        expect(section?.signal).toBe('RALPH_NEEDS_INPUT');
    });

    it('broadcasts awaiting-input with the asking iteration', async () => {
        const deps = await run(makeNeedsInputResponse());

        expect(deps.broadcastAwaitingInput).toHaveBeenCalledWith({
            workspaceId: WS,
            sessionId: SID,
            processId: PROCESS_ID,
            iteration: 2,
        });
    });

    it('marks the asking process ralph.phase awaiting-input for the chat-list marker (AC-05)', async () => {
        const store = createMockProcessStore();
        await store.addProcess({
            id: PROCESS_ID,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'iteration 2',
            metadata: { mode: 'ralph', ralph: { sessionId: SID, phase: 'executing', currentIteration: 2 } },
        } as any);

        await run(makeNeedsInputResponse(), 2, makeDeps({ dataDir, processStore: store }));

        const proc = await store.getProcess(PROCESS_ID);
        expect((proc?.metadata as any).ralph).toMatchObject({ sessionId: SID, phase: 'awaiting-input', currentIteration: 2 });
        expect((proc?.metadata as any).mode).toBe('ralph');
    });

    it('still persists the request when no awaiting-input broadcaster is wired', async () => {
        await run(makeNeedsInputResponse(), 2, makeDeps({ dataDir, broadcastAwaitingInput: undefined }));

        const record = await new RalphSessionStore({ dataDir }).readSessionRecord(WS, SID);
        expect(record?.phase).toBe('awaiting-input');
        expect(record?.pendingInput?.iteration).toBe(2);
    });

    it('pauses instead of reaching the cap when asking on the last iteration', async () => {
        const deps = await run(makeNeedsInputResponse(), 5);

        expect(deps.enqueueTask).not.toHaveBeenCalled();
        expect(deps.broadcastSessionComplete).not.toHaveBeenCalled();
        const record = await new RalphSessionStore({ dataDir }).readSessionRecord(WS, SID);
        expect(record?.phase).toBe('awaiting-input');
        expect(record?.terminalReason).toBeUndefined();
    });

    it('falls back to the normal signal path when the block is malformed', async () => {
        const response = makeNeedsInputResponse({ questions: [] }) + '\nRALPH_NEXT';
        const deps = await run(response);

        expect(deps.enqueueTask).toHaveBeenCalledTimes(1);
        expect(deps.broadcastAwaitingInput).not.toHaveBeenCalled();
        const record = await new RalphSessionStore({ dataDir }).readSessionRecord(WS, SID);
        expect(record?.phase).toBe('executing');
        expect(record?.pendingInput).toBeUndefined();
    });
});

describe('RalphSessionStore.setPendingInput', () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ralph-pending-input-'));
    });

    afterEach(async () => {
        await fs.promises.rm(dataDir, { recursive: true, force: true });
    });

    it('throws when the session does not exist', async () => {
        const store = new RalphSessionStore({ dataDir });
        await expect(store.setPendingInput(WS, 'missing', {
            iteration: 1,
            taskId: TASK_ID,
            processId: PROCESS_ID,
            requestedAt: '2026-01-01T00:00:00.000Z',
            request: REQUEST as never,
        })).rejects.toThrow(/not found/);
    });
});
