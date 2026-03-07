import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeWorkflow } from '../../src/workflow/executor';
import { setLogger, nullLogger, resetLogger } from '../../src/logger';
import type { WorkflowConfig, WorkflowExecutionOptions } from '../../src/workflow/types';
import type { AIInvokerResult, AIInvokerOptions } from '../../src/map-reduce/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvoker() {
    return vi.fn(async (_prompt: string, _opts?: AIInvokerOptions): Promise<AIInvokerResult> => ({
        success: true,
        response: '{"result":"ok"}',
    }));
}

function configWithSettings(settings: WorkflowConfig['settings']): WorkflowConfig {
    return {
        name: 'settings-test',
        settings,
        nodes: {
            load: {
                type: 'load' as const,
                source: { type: 'inline' as const, items: [{ id: '1' }] },
            },
            map: {
                type: 'map' as const,
                from: ['load'],
                prompt: 'Process {{id}}',
                output: ['result'],
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowSettings cascading', () => {
    beforeEach(() => setLogger(nullLogger));
    afterEach(() => resetLogger());

    it('settings.workingDirectory flows through to aiInvoker when caller does not provide it', async () => {
        const invoker = makeInvoker();
        const config = configWithSettings({ workingDirectory: '/from/settings' });
        await executeWorkflow(config, { aiInvoker: invoker });

        expect(invoker).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ workingDirectory: '/from/settings' }),
        );
    });

    it('caller-provided workingDirectory takes precedence over settings', async () => {
        const invoker = makeInvoker();
        const config = configWithSettings({ workingDirectory: '/from/settings' });
        await executeWorkflow(config, { aiInvoker: invoker, workingDirectory: '/from/caller' });

        expect(invoker).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ workingDirectory: '/from/caller' }),
        );
    });

    it('settings.model cascades when caller does not override', async () => {
        const invoker = makeInvoker();
        const config = configWithSettings({ model: 'settings-model' });
        await executeWorkflow(config, { aiInvoker: invoker });

        expect(invoker).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ model: 'settings-model' }),
        );
    });

    it('caller model takes precedence over settings model', async () => {
        const invoker = makeInvoker();
        const config = configWithSettings({ model: 'settings-model' });
        await executeWorkflow(config, { aiInvoker: invoker, model: 'caller-model' });

        expect(invoker).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ model: 'caller-model' }),
        );
    });

    it('settings.timeoutMs cascades correctly', async () => {
        const invoker = makeInvoker();
        const config = configWithSettings({ timeoutMs: 5000 });
        await executeWorkflow(config, { aiInvoker: invoker });

        expect(invoker).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ timeoutMs: 5000 }),
        );
    });

    it('settings.concurrency is used by map node when not overridden', async () => {
        const invoker = makeInvoker();
        const config: WorkflowConfig = {
            name: 'concurrency-test',
            settings: { concurrency: 2 },
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: Array.from({ length: 4 }, (_, i) => ({ id: String(i) })) },
                },
                map: {
                    type: 'map',
                    from: ['load'],
                    prompt: 'Process {{id}}',
                    output: ['result'],
                },
            },
        };
        const result = await executeWorkflow(config, { aiInvoker: invoker });
        expect(result.success).toBe(true);
        expect(invoker).toHaveBeenCalledTimes(4);
    });

    it('no settings — options pass through unchanged', async () => {
        const invoker = makeInvoker();
        const config: WorkflowConfig = {
            name: 'no-settings',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                map: {
                    type: 'map',
                    from: ['load'],
                    prompt: 'Process {{id}}',
                    output: ['result'],
                },
            },
        };
        await executeWorkflow(config, { aiInvoker: invoker, model: 'my-model' });

        expect(invoker).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ model: 'my-model' }),
        );
    });

    it('workingDirectory falls back to workflowDirectory when neither settings nor caller provides it', async () => {
        const invoker = makeInvoker();
        const config: WorkflowConfig = {
            name: 'fallback-test',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                map: {
                    type: 'map',
                    from: ['load'],
                    prompt: 'Process {{id}}',
                    output: ['result'],
                },
            },
        };
        await executeWorkflow(config, { aiInvoker: invoker, workflowDirectory: '/workflow/dir' });

        expect(invoker).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ workingDirectory: '/workflow/dir' }),
        );
    });

    it('toolCallCache field is accepted on settings without error', async () => {
        const invoker = makeInvoker();
        const config = configWithSettings({ toolCallCache: true });
        const result = await executeWorkflow(config, { aiInvoker: invoker });
        expect(result.success).toBe(true);
    });
});
