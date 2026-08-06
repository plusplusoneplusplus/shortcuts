import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    createCanvasCompleteFn,
    MAX_CANVAS_COMPLETE_PROMPT_CHARS,
} from '../../../src/server/canvas/canvas-capability-completion';

const ATTRIBUTION = {
    workspaceId: 'ws-1',
    canvasId: 'canvas-abc',
    capability: 'ask',
    processId: 'proc-9',
};

describe('createCanvasCompleteFn', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-complete-'));
    });
    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns the model response', async () => {
        const invoke = vi.fn(async () => ({ success: true as const, response: 'the answer' }));
        const complete = createCanvasCompleteFn(dataDir, ATTRIBUTION, { invoke, log: () => {} });
        await expect(complete({ prompt: 'q' })).resolves.toEqual({ ok: true, text: 'the answer' });
        expect(invoke).toHaveBeenCalledWith('q', undefined);
    });

    it('logs workspace, canvas, capability and process for every call', async () => {
        const log = vi.fn();
        const complete = createCanvasCompleteFn(dataDir, ATTRIBUTION, {
            invoke: async () => ({ success: true as const, response: 'x' }),
            log,
        });
        await complete({ prompt: 'hello' });
        expect(log).toHaveBeenCalledTimes(1);
        const line = log.mock.calls[0][0] as string;
        expect(line).toContain('workspace=ws-1');
        expect(line).toContain('canvas=canvas-abc');
        expect(line).toContain('capability=ask');
        expect(line).toContain('process=proc-9');
    });

    it('records the absence of an owning process rather than omitting it', async () => {
        const log = vi.fn();
        const complete = createCanvasCompleteFn(dataDir, { ...ATTRIBUTION, processId: undefined }, {
            invoke: async () => ({ success: true as const, response: 'x' }),
            log,
        });
        await complete({ prompt: 'hello' });
        expect(log.mock.calls[0][0] as string).toContain('process=none');
    });

    it('passes a caller-chosen model straight through', async () => {
        const invoke = vi.fn(async () => ({ success: true as const, response: 'x' }));
        const complete = createCanvasCompleteFn(dataDir, ATTRIBUTION, { invoke, log: () => {} });
        await complete({ prompt: 'q', model: 'claude-opus-5' });
        expect(invoke).toHaveBeenCalledWith('q', 'claude-opus-5');
    });

    it('falls back to the per-repo default model', async () => {
        const prefsDir = path.join(dataDir, 'repos', 'ws-1');
        fs.mkdirSync(prefsDir, { recursive: true });
        fs.writeFileSync(
            path.join(prefsDir, 'preferences.json'),
            JSON.stringify({ defaultModels: { quickAsk: 'preferred-model' } }),
            'utf-8',
        );
        const invoke = vi.fn(async () => ({ success: true as const, response: 'x' }));
        const complete = createCanvasCompleteFn(dataDir, ATTRIBUTION, { invoke, log: () => {} });
        await complete({ prompt: 'q' });
        expect(invoke).toHaveBeenCalledWith('q', 'preferred-model');
    });

    it('refuses an empty prompt without calling the model', async () => {
        const invoke = vi.fn();
        const complete = createCanvasCompleteFn(dataDir, ATTRIBUTION, { invoke, log: () => {} });
        await expect(complete({ prompt: '   ' })).resolves.toMatchObject({ ok: false });
        expect(invoke).not.toHaveBeenCalled();
    });

    it('refuses a prompt over the character cap without calling the model', async () => {
        const invoke = vi.fn();
        const complete = createCanvasCompleteFn(dataDir, ATTRIBUTION, { invoke, log: () => {} });
        const result = await complete({ prompt: 'x'.repeat(MAX_CANVAS_COMPLETE_PROMPT_CHARS + 1) });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('over the');
        expect(invoke).not.toHaveBeenCalled();
    });

    it('surfaces an invoker failure as an error result', async () => {
        const complete = createCanvasCompleteFn(dataDir, ATTRIBUTION, {
            invoke: async () => ({ success: false as const, error: 'AI service unavailable' }),
            log: () => {},
        });
        await expect(complete({ prompt: 'q' })).resolves.toMatchObject({
            ok: false,
            error: 'AI service unavailable',
        });
    });
});
