import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore, type AIProcess } from '@plusplusoneplusplus/forge';
import { MicrosoftTokenProvider } from '@plusplusoneplusplus/coc-native';
import { resolveTeamsReactionOutcome } from '../../../src/server/messaging/teams-reaction-outcome';
import { sendTeamsReactionResult } from '../../../src/server/messaging/teams-reaction-reply';

describe('persisted Teams delegation outcome delivery', () => {
    const job = {
        requestId: 'teams-reaction-integration', workspaceId: 'workspace-alpha',
        processId: 'queue_teams-reaction-integration', status: 'completed' as const,
    };
    const account = {
        tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222',
    };
    const source = {
        account, chatId: '19:fixture@thread.v2', messageId: 'foreign-authored-target',
        region: 'amer', verifyAccess: vi.fn(async (_signal: AbortSignal) => {}),
    };
    const fetch = vi.fn<typeof globalThis.fetch>();
    let directory: string;
    let store: SqliteProcessStore;
    let process: AIProcess;
    const report = (kind = 'approval', outcome = 'done') =>
        'Private findings remain here.\n```teams-delegation-result\n'
        + JSON.stringify({ requestId: job.requestId, kind, outcome }) + '\n```';
    const deliver = async (controller = new AbortController(), chatId = source.chatId) => {
        const result = await resolveTeamsReactionOutcome(store, job, controller.signal);
        await sendTeamsReactionResult({ ...source, chatId }, {
            sourceText: 'Review <this> request.', result,
        }, controller.signal);
    };
    const notice = () => JSON.parse(String(fetch.mock.calls[0][1]?.body)).content as string;
    const reaction = () => JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body)).emotions.key as string;

    beforeEach(() => {
        vi.resetAllMocks();
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reaction-result-'));
        store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        process = {
            id: job.processId, type: 'chat', status: 'completed', promptPreview: 'Delegated task',
            startTime: new Date('2026-01-01T01:00:00Z'), endTime: new Date('2026-01-01T01:01:00Z'),
            metadata: { workspaceId: job.workspaceId, queueTaskId: job.requestId, mode: 'ask' },
            conversationTurns: [
                { role: 'user', content: 'Untrusted context: ' + report(), relayRequestId: job.requestId,
                    timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: report(), timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        };
        source.verifyAccess.mockResolvedValue(undefined);
        fetch.mockImplementation(async () => new Response(JSON.stringify({ OriginalArrivalTime: '12345' }), { status: 201 }));
        vi.stubGlobal('fetch', fetch);
        vi.spyOn(MicrosoftTokenProvider.prototype, 'getToken').mockResolvedValue({
            accessToken: 'header.' + Buffer.from(JSON.stringify({
                aud: 'https://ic3.teams.office.com', tid: account.tenantId, oid: account.userId,
                exp: Math.floor(Date.now() / 1000) + 3600, name: 'Fixture User',
            })).toString('base64url') + '.signature',
            tokenType: 'Bearer', expiresAt: Math.floor(Date.now() / 1000) + 3600,
            source: 'azure-cli', target: 'https://ic3.teams.office.com',
        });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        store.close();
        await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    it.each(['48:notes', '19:fixture@thread.v2', '19:fixture@unq.gbl.spaces'])(
        'delivers persisted dispatcher completion to the exact source (%s)', async chatId => {
            await store.addProcess(process);
            await deliver(new AbortController(), chatId);
            expect(fetch).toHaveBeenCalledOnce();
            expect(reaction()).toBe('2714_heavycheckmark');
            expect(String(fetch.mock.calls[0][0])).toContain(
                `/conversations/${encodeURIComponent(chatId)}/messages/${source.messageId}/properties`,
            );
            expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT']);
        },
    );

    it.each(['New approval saved.', 'Existing approval confirmed for the current revision.'])(
        'reports done without another approval write: %s', async findings => {
            process.conversationTurns![1].content = findings + '\n' + report();
            await store.addProcess(process);
            await deliver();
            expect(fetch).toHaveBeenCalledOnce();
            expect(fetch.mock.calls[0][1]?.method).toBe('PUT');
            expect(reaction()).toBe('2714_heavycheckmark');
            expect(fetch.mock.calls.every(([url]) => String(url).startsWith('https://teams.cloud.microsoft/'))).toBe(true);
        },
    );

    it.each(['task', 'approval'])('delivers %s rejection with Crossmark', async kind => {
        process.conversationTurns![1].content = report(kind, 'rejected');
        await store.addProcess(process);
        await deliver();
        expect(reaction()).toBe('274c_crossmark');
        expect(notice()).toContain(kind === 'approval' ? 'PR approval rejected.' : 'Task rejected.');
    });

    it.each(['missing-report', 'unknown-outcome', 'follow-up', 'partial-answer'])(
        'rejects incomplete evidence rather than claiming done (%s)', async state => {
            if (state === 'missing-report') process.conversationTurns![1].content = 'Done.';
            if (state === 'unknown-outcome') process.conversationTurns![1].content = report('approval', 'unverified');
            if (state === 'partial-answer') process.conversationTurns![1].streaming = true;
            if (state === 'follow-up') process.conversationTurns!.push({
                role: 'user', content: 'Another task', timestamp: new Date(), turnIndex: 2, timeline: [],
            });
            await store.addProcess(process);
            await deliver();
            expect(reaction()).toBe('274c_crossmark');
            expect(notice()).toContain('Task rejected.');
            expect(notice()).not.toContain('done.');
        },
    );

    it.each(['foreign-owner', 'cancelled'])('prevents writes for %s', async state => {
        const controller = new AbortController();
        if (state === 'foreign-owner') process.metadata!.workspaceId = 'workspace-beta';
        else controller.abort(new Error('Account lifetime ended'));
        await store.addProcess(process);
        await expect(deliver(controller)).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
        expect(MicrosoftTokenProvider.prototype.getToken).not.toHaveBeenCalled();
    });
});
