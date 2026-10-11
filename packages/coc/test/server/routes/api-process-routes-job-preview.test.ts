import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { buildJobPreviewProcess } from '../../../src/server/processes/process-metadata-read-model';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import type { Route } from '../../../src/server/types';
const at = new Date('2026-10-11T00:00:00Z');
const process = {
    id: 'job', workspaceId: 'owner', type: 'clarification', status: 'running', startTime: at,
    promptPreview: 'Private prompt', fullPrompt: 'Full private prompt', result: 'Previous result',
    metadata: { workspaceId: 'owner', private: 'not needed' }, lastMessagePreview: 'Most recent user request',
    conversationTurns: [
        { role: 'assistant', content: 'Verified selection. '.repeat(100), timestamp: at, turnIndex: 0 },
        { role: 'user', content: 'User request is not progress', timestamp: at, turnIndex: 1 },
    ],
} as AIProcess;

describe('bounded job preview projection', () => {
    it('uses assistant progress, never user input or previous result while running', () => {
        const projected = buildJobPreviewProcess(process);
        expect(projected.jobPreview).toEqual({ source: 'progress', excerpt: process.conversationTurns![0].content.slice(0, 800), updatedAt: at.toISOString() });
        expect(projected).not.toHaveProperty('conversationTurns'); expect(projected).not.toHaveProperty('metadata');
        expect(projected).not.toHaveProperty('result'); expect(projected.promptPreview).toBe('');
        expect(projected).not.toHaveProperty('fullPrompt');
    });
    it('uses terminal result/error, empty states and tolerates invalid freshness', () => {
        expect(buildJobPreviewProcess({ ...process, status: 'completed', endTime: at }).jobPreview).toEqual({ source: 'result', excerpt: 'Previous result', updatedAt: at.toISOString() });
        expect(buildJobPreviewProcess({ ...process, status: 'failed', result: undefined, error: 'Check failed', endTime: new Date('invalid') }).jobPreview).toEqual({ source: 'error', excerpt: 'Check failed' });
        expect(buildJobPreviewProcess({ ...process, conversationTurns: [] }).jobPreview).toEqual({ source: 'empty', excerpt: '' });
    });
});

describe('owner-scoped preview HTTP contract', () => {
    let server: http.Server;
    let base: string;
    const readHistory = vi.fn().mockRejectedValue(new Error('Previews must not page history'));
    beforeAll(async () => {
        const store = createMockProcessStore();
        store.getProcess.mockImplementation(async id => id === 'job' ? process : undefined);
        store.getProcessHistory = readHistory;
        const routes: Route[] = [];
        registerApiProcessRoutes({ routes, store, getLiveFeatureFlags: () => ({
            excalidrawEnabled: false, canvasEnabled: false, kustoEnabled: false,
            chatStyleSelectorEnabled: false, chatProviderSwitchingEnabled: false,
            chatHistoryPagingEnabled: true, defaultChatStyle: 'default',
        }), bridge: {
            executeFollowUp: vi.fn(), isSessionAlive: vi.fn(), cancelProcess: vi.fn(),
            getTask: id => id === 'pending' ? { id, repoId: 'owner', type: 'chat', status: 'queued', payload: { prompt: 'Private queued prompt', workspaceId: 'owner' }, createdAt: at } as any : undefined,
        } });
        server = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as http.AddressInfo).port}`;
    });
    afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
    it('returns bounded data even with include=children and rejects another workspace', async () => {
        const body = await (await fetch(`${base}/api/processes/job?workspace=owner&preview=true&include=children`)).json();
        expect(body.process.workspaceId).toBe('owner');
        expect((await fetch(`${base}/api/processes/job?preview=true`)).status).toBe(400);
        expect(body.children).toEqual([]); expect(body.process.jobPreview.excerpt.length).toBe(800);
        expect(body.process).not.toHaveProperty('conversationTurns');
        expect((await fetch(`${base}/api/processes/job?workspace=other&preview=true`)).status).toBe(404);
    });
    it('keeps queued synthetic data bounded and validates queued ownership', async () => {
        const body = await (await fetch(`${base}/api/processes/queue_pending?workspace=owner&preview=true`)).json();
        expect(body.process.jobPreview).toEqual({ source: 'empty', excerpt: '' });
        expect(body.process.promptPreview).toBe('');
        expect((await fetch(`${base}/api/processes/queue_pending?workspace=other&preview=true`)).status).toBe(404);
    });
    it.each(['job', 'queue_pending'])('prioritizes previews over paging for %s without exposing history', async id => {
        const response = await fetch(`${base}/api/processes/${id}?workspace=owner&preview=true&turnsLimit=30&include=children`);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.process).toHaveProperty('jobPreview');
        expect(body.process.jobPreview.excerpt.length).toBeLessThanOrEqual(800);
        expect(body.process.promptPreview).toBe('');
        expect(body.process).not.toHaveProperty('conversationTurns');
        expect(body.process).not.toHaveProperty('fullPrompt');
        expect(body).not.toHaveProperty('history');
        expect(body.children).toEqual([]);
        expect(readHistory).not.toHaveBeenCalled();
        expect((await fetch(`${base}/api/processes/${id}?workspace=other&preview=true&turnsLimit=30`)).status).toBe(404);
        expect((await fetch(`${base}/api/processes/${id}?preview=true&turnsLimit=30`)).status).toBe(400);
    });
});
