/**
 * ComponentRegenerationRunner Tests
 *
 * Characterizes the single-article path: event sequence, AI failures,
 * cancellation, cache + markdown persistence, and the shared reload policy.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    runComponentRegeneration,
    createRecordingEventSink,
    type GenerationEvent,
} from '../../../../src/server/wiki/generation';
import { createFakeAdapter, createFakeHandle, createFakeWiki, makeGraph } from './fakes';

let tempDir: string;
let wikiDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-gen-component-'));
    wikiDir = path.join(tempDir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function run(options: {
    adapter?: ReturnType<typeof createFakeAdapter>;
    handle?: ReturnType<typeof createFakeHandle>;
    wiki?: ReturnType<typeof createFakeWiki>;
    componentInfo?: any;
} = {}) {
    const events: GenerationEvent[] = [];
    const adapter = options.adapter ?? createFakeAdapter();
    const handle = options.handle ?? createFakeHandle();
    const wiki = options.wiki ?? createFakeWiki(wikiDir);
    const graph = makeGraph(['auth']);

    return runComponentRegeneration({
        wiki: wiki as any,
        componentId: 'auth',
        componentInfo: options.componentInfo ?? { id: 'auth', name: 'Auth Service', domain: 'core' },
        analysis: { componentId: 'auth', summary: 'does auth' },
        graph,
        emit: createRecordingEventSink(events),
        handle,
        adapter,
    }).then(() => ({ events, adapter, handle, wiki, graph }));
}

const types = (events: GenerationEvent[]) => events.map((e) => e.type);
const last = (events: GenerationEvent[]) => events[events.length - 1] as any;

describe('runComponentRegeneration — happy path', () => {
    it('emits status, two logs, the reload log, then a successful done', async () => {
        const { events } = await run();

        expect(types(events)).toEqual(['status', 'log', 'log', 'log', 'done']);
        expect(events[0]).toEqual({
            type: 'status',
            state: 'running',
            componentId: 'auth',
            message: 'Generating article for Auth Service...',
        });
        expect((events[1] as any).message).toBe('Sending to AI model...');
        expect((events[2] as any).message).toBe('Article generated, saving...');
        expect(last(events)).toMatchObject({
            type: 'done',
            success: true,
            componentId: 'auth',
            message: 'Article regenerated',
        });
    });

    it('falls back to the component id when the component has no name', async () => {
        const { events } = await run({ componentInfo: { id: 'auth', domain: 'core' } });
        expect((events[0] as any).message).toBe('Generating article for auth...');
    });

    it('builds the prompt from the analysis and graph at normal depth', async () => {
        const { adapter, graph } = await run();
        expect(adapter.buildComponentArticlePrompt).toHaveBeenCalledWith(
            { componentId: 'auth', summary: 'does auth' },
            graph,
            'normal',
        );
    });

    it('saves the article to the cache with the repo git hash', async () => {
        const { adapter } = await run();

        expect(adapter.calls.articleWriter.saveArticle).toHaveBeenCalledWith(
            'auth',
            expect.objectContaining({
                type: 'component',
                slug: 'auth',
                title: 'Auth Service',
                content: '# Article',
                componentId: 'auth',
                domainId: 'core',
            }),
            wikiDir,
            'abc123',
        );
    });

    it('writes the article file, creating parent directories', async () => {
        const adapter = createFakeAdapter({
            articleWriter: {
                getArticleFilePath: (article: any, dir: string) =>
                    path.join(dir, 'core', `${article.slug}.md`),
            },
        });
        await run({ adapter });

        const filePath = path.join(path.resolve(wikiDir), 'core', 'auth.md');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Article');
    });

    it('uses "unknown" when the repo has no git hash', async () => {
        const adapter = createFakeAdapter({ articleWriter: { getFolderHeadHash: async () => undefined } });
        await run({ adapter });

        expect(adapter.calls.articleWriter.saveArticle.mock.calls[0][3]).toBe('unknown');
    });

    it('reloads wiki data after writing', async () => {
        const { wiki, events } = await run();

        expect(wiki.wikiData.reload).toHaveBeenCalledTimes(1);
        expect((events[3] as any).message).toBe('Wiki data reloaded');
    });

    it('downgrades a reload failure to a warning and still succeeds', async () => {
        const wiki = createFakeWiki(wikiDir, { reload: () => { throw new Error('nope'); } });
        const { events } = await run({ wiki });

        expect((events[3] as any).message).toBe('Warning: Failed to reload wiki data: nope');
        expect(last(events)).toMatchObject({ type: 'done', success: true });
    });
});

describe('runComponentRegeneration — failures', () => {
    it('stops when the AI backend is unavailable', async () => {
        const adapter = createFakeAdapter({ aiAvailable: { available: false, reason: 'no token' } });
        const { events } = await run({ adapter });

        expect(events.slice(1)).toEqual([
            { type: 'error', message: 'Copilot SDK not available: no token' },
            { type: 'done', success: false, componentId: 'auth', error: 'AI service unavailable' },
        ]);
        expect(adapter.createWritingInvoker).not.toHaveBeenCalled();
    });

    it('surfaces the AI error message', async () => {
        const adapter = createFakeAdapter({ invokeResult: { success: false, error: 'rate limited' } });
        const { events } = await run({ adapter });

        expect(events.slice(-2)).toEqual([
            { type: 'error', message: 'rate limited' },
            { type: 'done', success: false, componentId: 'auth', error: 'rate limited' },
        ]);
    });

    it('treats an empty AI response as a failure', async () => {
        const adapter = createFakeAdapter({ invokeResult: { success: true, response: '' } });
        const { events } = await run({ adapter });

        expect(events.slice(-2)).toEqual([
            { type: 'error', message: 'AI returned empty response' },
            { type: 'done', success: false, componentId: 'auth', error: 'AI returned empty response' },
        ]);
    });

    it('does not write anything when the AI call fails', async () => {
        const adapter = createFakeAdapter({ invokeResult: { success: false, error: 'boom' } });
        const { wiki } = await run({ adapter });

        expect(adapter.calls.articleWriter.saveArticle).not.toHaveBeenCalled();
        expect(wiki.wikiData.reload).not.toHaveBeenCalled();
    });
});

describe('runComponentRegeneration — cancellation', () => {
    it('stops before the AI call when already cancelled', async () => {
        const adapter = createFakeAdapter();
        const { events } = await run({ adapter, handle: createFakeHandle(true) });

        expect(events).toEqual([
            {
                type: 'status',
                state: 'running',
                componentId: 'auth',
                message: 'Generating article for Auth Service...',
            },
            { type: 'done', success: false, componentId: 'auth', error: 'Cancelled' },
        ]);
        expect(adapter.checkAIAvailability).not.toHaveBeenCalled();
        expect(adapter.calls.articleWriter.saveArticle).not.toHaveBeenCalled();
    });
});
