import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { request, seedWorkspace, seedQueueTask } from './fixtures/seed';

test('delegated native questions and goal review survive refresh, with no execution before confirmation', async ({ serverUrl, mockAI, page }) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-grill-browser-'));
    const workspaceId = `native-grill-${Date.now().toString(36)}`;
    try {
        await seedWorkspace(serverUrl, workspaceId, 'Native grill', root);
        const config = await request(`${serverUrl}/api/admin/config`, { method: 'PUT', body: JSON.stringify({ 'ralph.enabled': true }) });
        expect(config.status).toBe(200);
        let child: { processId: string; sessionId: string } | undefined;
        mockAI.mockSendMessage.mockImplementation(async (opts: { prompt?: string; tools?: Tool<unknown>[] }) => {
            if (opts.prompt?.includes('Delegate this native interview')) {
                const send = opts.tools?.find(tool => tool.name === 'send_to_conversation');
                if (!send?.handler) throw new Error('Delegation tool missing');
                child = await send.handler({ content: 'Build a native interview', title: 'Native interview', workspaceId,
                    mode: 'ralph', entryPoint: 'grill', provider: 'copilot', model: 'gpt-5.4' },
                { sessionId: 'parent', toolCallId: 'native-delegate', toolName: 'send_to_conversation', arguments: {} }) as typeof child;
                return { success: true, response: 'Interview created', sessionId: 'parent' };
            }
            const ask = opts.tools?.find(tool => tool.name === 'ask_user');
            if (!ask?.handler) throw new Error('Native Ask User missing');
            const answers = await ask.handler({ questions: [{ question: 'Which language should the feature use?', type: 'text' }] },
                { sessionId: 'interview', toolCallId: 'native-question', toolName: 'ask_user', arguments: {} }) as Array<{ answer: string }>;
            return { success: true, sessionId: 'interview', response: `## Goal\nBuild the feature in ${answers[0].answer}.\n\n## Acceptance Criteria\n- Tests pass.` };
        });
        await seedQueueTask(serverUrl, { type: 'chat', repoId: workspaceId,
            payload: { kind: 'chat', workspaceId, mode: 'ask', prompt: 'Delegate this native interview' } });
        await expect.poll(() => child?.processId, { timeout: 15_000 }).toBeTruthy();
        const url = `${serverUrl}/#repos/${encodeURIComponent(workspaceId)}/activity/${child!.processId}`;
        await page.goto(url);
        const question = page.getByTestId('ask-user-inline');
        await expect(question).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('ralph-start-btn')).toHaveCount(0);
        await page.reload();
        await expect(question).toContainText('Which language', { timeout: 15_000 });
        await page.getByTestId('ask-user-text-input').fill('TypeScript');
        await page.getByTestId('ask-user-submit-all-btn').click();
        await expect.poll(async () => {
            const res = await request(`${serverUrl}/api/processes/${child!.processId}`);
            return JSON.parse(res.body).process?.metadata?.ralphGoal?.revision;
        }, { timeout: 15_000 }).toBeTruthy();
        const before = await request(`${serverUrl}/api/queue/history?repoId=${encodeURIComponent(workspaceId)}`);
        expect(before.body).not.toContain('"phase":"executing"');
        await page.reload();
        await expect(page.getByTestId('ralph-start-btn')).toBeVisible({ timeout: 15_000 });
        await page.getByTestId('ralph-start-btn').click();
        await expect(page.getByTestId('ralph-goal-spec-input')).toHaveValue(/TypeScript/);
        // Exercise the native review payload; admit no execution in this browser fixture.
        let approval: any;
        await page.route('**/ralph-start', async route => {
            approval = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ processId: 'queue_mock-approved' }) });
        });
        await page.getByTestId('ralph-confirm-start-btn').click();
        await expect.poll(() => approval).toBeTruthy();
        expect(approval.workspaceId).toBe(workspaceId);
        expect(approval.goalRevision).toMatch(/^[a-f0-9]{64}$/);
        expect(approval.goalSpec).toContain('## Goal');
    } finally { safeRmSync(root); }
});
