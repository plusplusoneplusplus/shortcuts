/**
 * Unit tests for orchestrate-submit.ts (AC-03).
 *
 * Covers:
 *  - submitted result → record 'completed' with prUrl/prNumber/commitShas,
 *    processId and completedAt set
 *  - failed result → record 'failed' with the agent's error
 *  - missing/malformed RALPH_SUBMIT_RESULT block → record 'failed' with
 *    error 'unparseable'
 *  - store persistence failures are swallowed (async-void contract)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { orchestrateSubmitCompletion } from '../../../src/server/ralph/orchestrate-submit';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';

const WORKSPACE_ID = 'ws-01';
const SESSION_ID = 'sess-01';
const TASK_ID = 'task-01';
const PROCESS_ID = 'proc-01';
const SUBMIT_INDEX = 1;

function makeSubmittedResponse(): string {
    return `PR created.\n\nRALPH_SUBMIT_RESULT\n\`\`\`json\n${JSON.stringify({
        status: 'submitted',
        prUrl: 'https://github.com/acme/repo/pull/42',
        prNumber: 42,
        commitShas: ['aaa111', 'bbb222'],
    }, null, 2)}\n\`\`\``;
}

function makeFailedResponse(): string {
    return `Could not submit.\n\nRALPH_SUBMIT_RESULT\n\`\`\`json\n${JSON.stringify({
        status: 'failed',
        error: 'cherry-pick conflict on aaa111; submit aborted',
    }, null, 2)}\n\`\`\``;
}

describe('orchestrateSubmitCompletion', () => {
    let dataDir: string;
    let store: RalphSessionStore;

    beforeEach(async () => {
        dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ralph-submit-orch-'));
        store = new RalphSessionStore({ dataDir });
        await store.initSession(WORKSPACE_ID, SESSION_ID, {
            originalGoal: 'Do the thing.',
            maxIterations: 10,
        });
        // Seed the queued record the submit route writes before the job runs.
        await store.upsertSubmitRecord(WORKSPACE_ID, SESSION_ID, SUBMIT_INDEX, {
            status: 'queued',
            taskId: TASK_ID,
            startedAt: '2026-08-20T00:00:00.000Z',
        });
    });

    async function readSubmit(index = SUBMIT_INDEX) {
        const record = await store.readSessionRecord(WORKSPACE_ID, SESSION_ID);
        return record?.submits?.find(s => s.submitIndex === index);
    }

    async function run(responseText: string): Promise<void> {
        await orchestrateSubmitCompletion({
            workspaceId: WORKSPACE_ID,
            sessionId: SESSION_ID,
            submitIndex: SUBMIT_INDEX,
            taskId: TASK_ID,
            processId: PROCESS_ID,
            responseText,
            deps: { store },
        });
    }

    it('marks the record completed with PR metadata on a submitted result', async () => {
        await run(makeSubmittedResponse());

        const submit = await readSubmit();
        expect(submit).toBeDefined();
        expect(submit?.status).toBe('completed');
        expect(submit?.prUrl).toBe('https://github.com/acme/repo/pull/42');
        expect(submit?.prNumber).toBe(42);
        expect(submit?.commitShas).toEqual(['aaa111', 'bbb222']);
        expect(submit?.processId).toBe(PROCESS_ID);
        expect(submit?.taskId).toBe(TASK_ID);
        expect(submit?.completedAt).toBeTruthy();
        expect(submit?.startedAt).toBe('2026-08-20T00:00:00.000Z');
        expect(submit?.error).toBeUndefined();
    });

    it('marks the record failed with the agent error on a failed result', async () => {
        await run(makeFailedResponse());

        const submit = await readSubmit();
        expect(submit?.status).toBe('failed');
        expect(submit?.error).toBe('cherry-pick conflict on aaa111; submit aborted');
        expect(submit?.processId).toBe(PROCESS_ID);
        expect(submit?.completedAt).toBeTruthy();
        expect(submit?.prUrl).toBeUndefined();
    });

    it('marks the record failed with error "unparseable" when the block is missing', async () => {
        await run('I opened the PR but did not emit the result block.');

        const submit = await readSubmit();
        expect(submit?.status).toBe('failed');
        expect(submit?.error).toBe('unparseable');
        expect(submit?.completedAt).toBeTruthy();
    });

    it('marks the record failed with error "unparseable" on malformed JSON', async () => {
        await run('RALPH_SUBMIT_RESULT\n```json\n{ "status": "submitted", \n```');

        const submit = await readSubmit();
        expect(submit?.status).toBe('failed');
        expect(submit?.error).toBe('unparseable');
    });

    it('falls back to a generic error when a failed result carries none', async () => {
        await run(`RALPH_SUBMIT_RESULT\n\`\`\`json\n{ "status": "failed" }\n\`\`\``);

        const submit = await readSubmit();
        expect(submit?.status).toBe('failed');
        expect(submit?.error).toBe('failed');
    });

    it('leaves other submit records untouched', async () => {
        await store.upsertSubmitRecord(WORKSPACE_ID, SESSION_ID, 2, {
            status: 'failed',
            startedAt: '2026-08-19T00:00:00.000Z',
            error: 'earlier failure',
        });

        await run(makeSubmittedResponse());

        const other = await readSubmit(2);
        expect(other?.status).toBe('failed');
        expect(other?.error).toBe('earlier failure');
    });

    it('does not throw when the store cannot persist', async () => {
        const broken = {
            upsertSubmitRecord: async () => {
                throw new Error('disk full');
            },
        } as unknown as RalphSessionStore;

        await expect(orchestrateSubmitCompletion({
            workspaceId: WORKSPACE_ID,
            sessionId: SESSION_ID,
            submitIndex: SUBMIT_INDEX,
            taskId: TASK_ID,
            processId: PROCESS_ID,
            responseText: makeSubmittedResponse(),
            deps: { store: broken },
        })).resolves.toBeUndefined();
    });
});
