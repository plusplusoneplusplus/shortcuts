/**
 * run_tool_script MCP access (features.toolScriptingMcp): the mock AI calls the
 * real run_tool_script handler, whose script reaches a fake stdio MCP server
 * through tools.mcp_list_tools / tools.mcp_call. The nested MCP calls must
 * render as child cards under the run_tool_script card.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace, request } from './fixtures/seed';
import { E2E_SERVER_CONFIG_YAML } from './fixtures/e2e-server-config';
import type { Page } from '@playwright/test';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';

const FAKE_MCP_SERVER = path.resolve(__dirname, '../server/llm-tools/fixtures/fake-mcp-server.cjs');

async function waitForTaskStatus(serverUrl: string, taskId: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue/${taskId}`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const task = json.task ?? json;
            if (task.status === 'completed' || task.status === 'failed') return task;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`Task ${taskId} did not finish within ${timeoutMs}ms`);
}

async function gotoConversation(page: Page, serverUrl: string, wsId: string, taskId: string): Promise<void> {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/${encodeURIComponent(`queue_${taskId}`)}`);
    await page.waitForSelector('[data-testid="activity-chat-detail"]', { timeout: 8_000 });
}

test.describe('run_tool_script MCP calls', () => {
    test('renders nested mcp_list_tools and mcp_call cards under run_tool_script', async ({
        serverUrl, dataDir, mockAI, page,
    }) => {
        fs.writeFileSync(path.join(dataDir, 'config.yaml'),
            E2E_SERVER_CONFIG_YAML.replace('features:\n', 'features:\n  toolScripting: true\n  toolScriptingMcp: true\n'));

        const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-script-mcp-'));
        try {
            fs.mkdirSync(path.join(rootPath, '.vscode'), { recursive: true });
            fs.writeFileSync(path.join(rootPath, '.vscode', 'mcp.json'), JSON.stringify({
                servers: { fake: { command: process.execPath, args: [FAKE_MCP_SERVER] } },
            }));
            const wsId = `script-mcp-${Date.now().toString(36)}`;
            await seedWorkspace(serverUrl, wsId, 'script-mcp', rootPath);
            const mcpConfig = await request(`${serverUrl}/api/workspaces/${wsId}/mcp-config`, {
                method: 'PUT', body: JSON.stringify({ enabledMcpServers: ['fake'] }),
            });
            expect(mcpConfig.status).toBe(200);
            // Approval off for mcp_call so the scripted call runs without a prompt.
            const llmTools = await request(`${serverUrl}/api/workspaces/${wsId}/llm-tools-config`, {
                method: 'PUT', body: JSON.stringify({ approvalRequiredLlmTools: [] }),
            });
            expect(llmTools.status).toBe(200);

            let scriptResult = '';
            let description = '';
            mockAI.mockSendMessage.mockImplementation(async (...args: unknown[]) => {
                const opts = args[0] as {
                    tools?: Tool<unknown>[];
                    onToolEvent?: (event: Record<string, unknown>) => void;
                };
                const script = opts.tools?.find(t => t.name === 'run_tool_script');
                if (!script?.handler) return { success: false, error: 'run_tool_script not found', sessionId: 'sess-mcp' };
                description = script.description ?? '';
                const code = [
                    "const listed = await tools.mcp_list_tools({ server: 'fake' });",
                    "const echoed = await tools.mcp_call({ server: 'fake', tool: 'echo', args: { text: 'hi' } });",
                    'return { listed, echoed };',
                ].join('\n');
                opts.onToolEvent?.({ type: 'tool-start', toolCallId: 'tc-script', toolName: 'run_tool_script', parameters: { code } });
                const result = await script.handler(
                    { code },
                    { sessionId: 'sess-mcp', toolCallId: 'tc-script', toolName: 'run_tool_script', arguments: { code } },
                ) as { textResultForLlm?: string } | string;
                scriptResult = typeof result === 'string' ? result : result.textResultForLlm ?? JSON.stringify(result);
                opts.onToolEvent?.({ type: 'tool-complete', toolCallId: 'tc-script', toolName: 'run_tool_script', result: scriptResult });
                return { success: true, response: 'Script finished.', sessionId: 'sess-mcp' };
            });

            const task = await seedQueueTask(serverUrl, {
                type: 'chat',
                repoId: wsId,
                payload: { kind: 'chat', workspaceId: wsId, prompt: 'Use the fake MCP server.', mode: 'ask' },
            });
            const done = await waitForTaskStatus(serverUrl, task.id as string);
            expect(done.status).toBe('completed');
            expect(description).toContain('fake');
            expect(scriptResult).toContain('echo:hi');

            // Render tool calls as individual cards rather than whisper-collapsed.
            await request(`${serverUrl}/api/admin/config`, { method: 'PUT', body: JSON.stringify({ toolCompactness: 0 }) });
            await gotoConversation(page, serverUrl, wsId, task.id as string);
            const scriptCard = page.locator('.tool-call-card[data-tool-id="tc-script"]');
            await expect(scriptCard).toHaveCount(1, { timeout: 10_000 });

            const children = scriptCard.locator('.tool-call-children .tool-call-card');
            await expect(children).toHaveCount(2);
            const toggle = scriptCard.locator(':scope > .tool-call-header button[aria-label]');
            if (await scriptCard.locator('.subtree-collapsed').count() > 0) await toggle.click();
            await expect(children.nth(0)).toContainText('mcp_list_tools');
            await expect(children.nth(1)).toContainText('mcp_call');
        } finally {
            safeRmSync(rootPath);
        }
    });
});
