import { describe, expect, it, vi } from 'vitest';
import type { CopilotClient } from '@github/copilot-sdk';
import { RequestRunner } from '../../src/request-runner';
import { SessionManager } from '../../src/session-manager';
import { createMockSession } from '../helpers/mock-sdk';

describe('CoC canvas ownership', () => {
    it.each(['create', 'resume', 'fallback'] as const)(
        'keeps native loading and rendering opted out on %s without excluding CoC tools',
        async mode => {
            const session = createMockSession();
            const client = {
                createSession: vi.fn().mockResolvedValue(session),
                resumeSession: mode === 'fallback'
                    ? vi.fn().mockRejectedValue(new Error('Missing session'))
                    : vi.fn().mockResolvedValue(session),
                stop: vi.fn(),
            };
            const tools = ['list_canvas_capabilities', 'manage_canvas', 'invoke_canvas_action']
                .map(name => ({ name, handler: vi.fn() }));
            const runner = new RequestRunner(
                async () => ({ available: true }),
                async () => client as unknown as CopilotClient,
                new SessionManager(),
            );
            const result = await runner.send({
                prompt: 'fixture', tools, loadDefaultMcpConfig: false,
                ...(mode !== 'create' ? { sessionId: 'previous-session' } : {}),
            });
            expect(result.success).toBe(true);
            const configs = [
                ...client.createSession.mock.calls.map(([config]) => config),
                ...client.resumeSession.mock.calls.map(([, config]) => config),
            ];
            expect(configs).toHaveLength(mode === 'fallback' ? 2 : 1);
            for (const config of configs) {
                expect(config).not.toHaveProperty('requestExtensions');
                expect(config).not.toHaveProperty('requestCanvasRenderer');
                expect(config).not.toHaveProperty('enableConfigDiscovery');
                expect(config.tools).toBe(tools);
                expect(config).not.toHaveProperty('excludedTools');
            }
        },
    );
});
