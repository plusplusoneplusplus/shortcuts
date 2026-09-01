/**
 * Characterizes the five-phase state machine: event sequence, skipped-phase
 * prerequisite loading, cancellation before each phase, failure handling, and
 * the post-generation wiki reload.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    runWikiGeneration,
    createRecordingEventSink,
    type GenerationEvent,
} from '../../../../src/server/wiki/generation';
import { createFakeAdapter, createFakeHandle, createFakeWiki, makeGraph } from './fakes';

let tempDir: string;
let wikiDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-gen-runner-'));
    wikiDir = path.join(tempDir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function run(options: {
    startPhase: number;
    endPhase: number;
    adapter?: ReturnType<typeof createFakeAdapter>;
    handle?: ReturnType<typeof createFakeHandle>;
    wiki?: ReturnType<typeof createFakeWiki>;
    force?: boolean;
}): Promise<{ events: GenerationEvent[]; adapter: any; handle: any; wiki: any }> {
    const events: GenerationEvent[] = [];
    const adapter = options.adapter ?? createFakeAdapter();
    const handle = options.handle ?? createFakeHandle();
    const wiki = options.wiki ?? createFakeWiki(wikiDir);

    return runWikiGeneration({
        wiki: wiki as any,
        startPhase: options.startPhase,
        endPhase: options.endPhase,
        force: options.force ?? false,
        emit: createRecordingEventSink(events),
        handle,
        adapter,
    }).then(() => ({ events, adapter, handle, wiki }));
}

const types = (events: GenerationEvent[]) => events.map((e) => e.type);
const last = (events: GenerationEvent[]) => events[events.length - 1] as any;

describe('runWikiGeneration — full run', () => {
    it('emits status/phase-complete for every phase then a successful done', async () => {
        const { events } = await run({ startPhase: 1, endPhase: 5 });

        expect(types(events)).toEqual([
            'status', 'phase-complete',
            'status', 'phase-complete',
            'status', 'phase-complete',
            'status', 'phase-complete',
            'status', 'phase-complete',
            'log',
            'done',
        ]);
        expect(last(events)).toMatchObject({ type: 'done', success: true });
        expect(typeof last(events).duration).toBe('number');
    });

    it('reports the component counts each phase produced', async () => {
        const { events } = await run({ startPhase: 1, endPhase: 4 });
        const completes = events.filter((e) => e.type === 'phase-complete') as any[];

        expect(completes[0].message).toBe('Discovered 2 components');
        expect(completes[1].message).toBe('Consolidated to 1 components');
        expect(completes[2].message).toBe('Analyzed 1 components');
        expect(completes[3].message).toBe('Wrote 1 articles');
    });

    it('records each phase on the handle as it starts', async () => {
        const { handle } = await run({ startPhase: 1, endPhase: 5 });
        expect(handle.phases).toEqual([1, 2, 3, 4, 5]);
    });

    it('passes force through to phase options and disables the cache', async () => {
        const { adapter } = await run({ startPhase: 1, endPhase: 1, force: true });
        const options = adapter.calls.phases.runPhase1.mock.calls[0][1];

        expect(options).toMatchObject({ force: true, useCache: false, output: wikiDir, depth: 'normal' });
    });

    it('feeds phase 1 token usage into the usage tracker', async () => {
        const { adapter } = await run({ startPhase: 1, endPhase: 1 });
        expect(adapter.calls.usageTracker.addUsage).toHaveBeenCalledWith('discovery', { total: 10 });
    });

    it('writes component-graph.json before building the website', async () => {
        await run({ startPhase: 1, endPhase: 5 });

        const graphFile = path.join(wikiDir, 'component-graph.json');
        expect(fs.existsSync(graphFile)).toBe(true);
        expect(JSON.parse(fs.readFileSync(graphFile, 'utf-8')).components).toHaveLength(1);
    });
});

describe('runWikiGeneration — AI availability', () => {
    it('stops before phase 1 when the AI backend is unavailable', async () => {
        const adapter = createFakeAdapter({ aiAvailable: { available: false, reason: 'no token' } });
        const { events } = await run({ startPhase: 1, endPhase: 4, adapter });

        expect(events).toEqual([
            { type: 'error', message: 'Copilot SDK not available: no token' },
            { type: 'done', success: false, error: 'AI service unavailable' },
        ]);
        expect(adapter.calls.phases.runPhase1).not.toHaveBeenCalled();
    });

    it('falls back to Unknown when no reason is given', async () => {
        const adapter = createFakeAdapter({ aiAvailable: { available: false } });
        const { events } = await run({ startPhase: 1, endPhase: 1, adapter });

        expect((events[0] as any).message).toBe('Copilot SDK not available: Unknown');
    });

    it('skips the AI check for a website-only run', async () => {
        const adapter = createFakeAdapter({ aiAvailable: { available: false } });
        adapter.calls.cache.getCachedGraphAny.mockReturnValue({ graph: makeGraph(['auth']) });
        adapter.calls.cache.getCachedAnalyses.mockReturnValue([{ componentId: 'auth' }]);

        const { events } = await run({ startPhase: 5, endPhase: 5, adapter });

        expect(adapter.checkAIAvailability).not.toHaveBeenCalled();
        expect(last(events)).toMatchObject({ type: 'done', success: true });
    });
});

describe('runWikiGeneration — skipped-phase prerequisites', () => {
    it('errors when discovery output is missing', async () => {
        const adapter = createFakeAdapter();
        const { events } = await run({ startPhase: 2, endPhase: 4, adapter });

        expect(events).toEqual([
            { type: 'error', message: 'No cached component graph found. Run Discovery first.' },
            { type: 'done', success: false, error: 'Missing prerequisite: Discovery' },
        ]);
    });

    it('falls back to the async cached graph lookup', async () => {
        const adapter = createFakeAdapter();
        adapter.calls.cache.getCachedGraph.mockResolvedValue({ graph: makeGraph(['auth', 'db']) });

        const { events } = await run({ startPhase: 2, endPhase: 2, adapter });

        expect(events[0]).toEqual({
            type: 'log',
            phase: 2,
            message: 'Loaded cached component graph (2 components)',
        });
    });

    it('loads the consolidated graph when phase 2 is skipped', async () => {
        const adapter = createFakeAdapter();
        adapter.calls.cache.getCachedGraphAny.mockReturnValue({ graph: makeGraph(['a', 'b', 'c']) });
        adapter.calls.cache.getCachedConsolidationAny.mockReturnValue({ graph: makeGraph(['a']) });
        adapter.calls.cache.getCachedAnalyses.mockReturnValue([{ componentId: 'a' }]);

        const { events } = await run({ startPhase: 4, endPhase: 4, adapter });

        expect(events[1]).toEqual({
            type: 'log',
            phase: 4,
            message: 'Loaded consolidated graph (3 → 1 components)',
        });
    });

    it('errors when analyses are missing for the writing phase', async () => {
        const adapter = createFakeAdapter();
        adapter.calls.cache.getCachedGraphAny.mockReturnValue({ graph: makeGraph(['auth']) });
        adapter.calls.cache.getCachedAnalyses.mockReturnValue([]);

        const { events } = await run({ startPhase: 4, endPhase: 4, adapter });

        expect(events.slice(-2)).toEqual([
            { type: 'error', message: 'No cached analyses found. Run Analysis first.' },
            { type: 'done', success: false, error: 'Missing prerequisite: Analysis' },
        ]);
    });

    it('drops cached analyses whose component is no longer in the graph', async () => {
        const adapter = createFakeAdapter();
        adapter.calls.cache.getCachedGraphAny.mockReturnValue({ graph: makeGraph(['auth']) });
        adapter.calls.cache.getCachedAnalyses.mockReturnValue([
            { componentId: 'auth' },
            { componentId: 'stale' },
        ]);

        const { events, adapter: used } = await run({ startPhase: 4, endPhase: 4, adapter });

        expect(events.some((e) => e.type === 'log' && e.message === 'Loaded 1 cached analyses')).toBe(true);
        expect(used.calls.phases.runPhase4Writing.mock.calls[0][2]).toEqual([{ componentId: 'auth' }]);
    });

    it('fails phase 1 when discovery returns no graph', async () => {
        const adapter = createFakeAdapter({
            phases: { runPhase1: vi.fn(async () => ({ graph: undefined })) },
        });
        const { events } = await run({ startPhase: 1, endPhase: 1, adapter });

        expect(events.filter((e) => e.type === 'error')[0]).toMatchObject({ type: 'error', phase: 1 });
        expect(last(events)).toEqual({ type: 'done', success: false, error: 'Phase 1 failed' });
    });
});

describe('runWikiGeneration — cancellation', () => {
    it.each([
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
    ])('cancels before phase %i without emitting a status event', async (startPhase) => {
        const adapter = createFakeAdapter();
        adapter.calls.cache.getCachedGraphAny.mockReturnValue({ graph: makeGraph(['auth']) });
        adapter.calls.cache.getCachedAnalyses.mockReturnValue([{ componentId: 'auth' }]);

        const handle = createFakeHandle(true);
        const { events } = await run({ startPhase, endPhase: 5, adapter, handle });

        expect(last(events)).toEqual({ type: 'done', success: false, error: 'Cancelled' });
        expect(events.some((e) => e.type === 'status')).toBe(false);
    });

    it('stops mid-run when cancelled after phase 1', async () => {
        const handle = createFakeHandle();
        const adapter = createFakeAdapter({
            phases: {
                runPhase1: vi.fn(async () => {
                    handle.cancel();
                    return { graph: makeGraph(['auth']) };
                }),
            },
        });

        const { events } = await run({ startPhase: 1, endPhase: 5, adapter, handle });

        expect(types(events)).toEqual(['status', 'phase-complete', 'done']);
        expect(last(events)).toEqual({ type: 'done', success: false, error: 'Cancelled' });
        expect(adapter.calls.phases.runPhase2Consolidation).not.toHaveBeenCalled();
    });

    it('does not reload wiki data when cancelled', async () => {
        const handle = createFakeHandle(true);
        const { wiki } = await run({ startPhase: 1, endPhase: 5, handle });
        expect(wiki.wikiData.reload).not.toHaveBeenCalled();
    });
});

describe('runWikiGeneration — phase failures', () => {
    it.each([
        [1, 'runPhase1', 'Discovery failed (exit code 2)', 'Phase 1 failed'],
        [3, 'runPhase3Analysis', 'Analysis failed (exit code 2)', 'Phase 3 failed'],
        [4, 'runPhase4Writing', 'Writing failed (exit code 2)', 'Phase 4 failed'],
    ])('treats a non-undefined exitCode from phase %i as failure', async (phase, fn, message, doneError) => {
        const adapter = createFakeAdapter({ phases: { [fn]: vi.fn(async () => ({ exitCode: 2 })) } });
        const { events } = await run({ startPhase: 1, endPhase: 5, adapter });

        expect(events.slice(-2)).toEqual([
            { type: 'error', phase, message },
            { type: 'done', success: false, error: doneError },
        ]);
    });

    it.each([
        [1, 'runPhase1', 'Phase 1 failed'],
        [2, 'runPhase2Consolidation', 'Phase 2 failed'],
        [3, 'runPhase3Analysis', 'Phase 3 failed'],
        [4, 'runPhase4Writing', 'Phase 4 failed'],
    ])('surfaces a thrown error from phase %i', async (phase, fn, doneError) => {
        const adapter = createFakeAdapter({
            phases: { [fn]: vi.fn(async () => { throw new Error('boom'); }) },
        });
        const { events } = await run({ startPhase: 1, endPhase: 5, adapter });

        expect(events.slice(-2)).toEqual([
            { type: 'error', phase, message: 'boom' },
            { type: 'done', success: false, error: doneError },
        ]);
    });

    it('reports a failed website build without failing the run', async () => {
        const adapter = createFakeAdapter({ phases: { runPhase5Website: vi.fn(() => ({ success: false })) } });
        const { events } = await run({ startPhase: 1, endPhase: 5, adapter });

        expect(events.some((e) => e.type === 'error' && e.phase === 5)).toBe(true);
        expect(last(events)).toMatchObject({ type: 'done', success: true });
    });

    it('reports a thrown website error without failing the run', async () => {
        const adapter = createFakeAdapter({
            phases: { runPhase5Website: vi.fn(() => { throw new Error('vite exploded'); }) },
        });
        const { events } = await run({ startPhase: 1, endPhase: 5, adapter });

        expect(events.some((e) => e.type === 'error' && e.phase === 5 && e.message === 'vite exploded')).toBe(true);
        expect(last(events)).toMatchObject({ type: 'done', success: true });
    });

    it('errors when the writing phase runs with no analyses in memory', async () => {
        const adapter = createFakeAdapter();
        adapter.calls.cache.getCachedGraphAny.mockReturnValue({ graph: makeGraph([]) });

        // startPhase 4 with an empty graph skips the analyses cache branch
        // (endPhase >= 4 is satisfied, but the graph has no components).
        adapter.calls.cache.getCachedAnalyses.mockReturnValue(undefined);

        const { events } = await run({ startPhase: 4, endPhase: 4, adapter });

        expect(events.slice(-2)).toEqual([
            { type: 'error', message: 'No cached analyses found. Run Analysis first.' },
            { type: 'done', success: false, error: 'Missing prerequisite: Analysis' },
        ]);
    });
});

describe('runWikiGeneration — wiki reload', () => {
    it('reloads wiki data when phase 4 or later ran', async () => {
        const { events, wiki } = await run({ startPhase: 1, endPhase: 4 });

        expect(wiki.wikiData.reload).toHaveBeenCalledTimes(1);
        expect(events.some((e) => e.type === 'log' && e.message === 'Wiki data reloaded')).toBe(true);
    });

    it('does not reload for a discovery-only run', async () => {
        const { wiki } = await run({ startPhase: 1, endPhase: 3 });
        expect(wiki.wikiData.reload).not.toHaveBeenCalled();
    });

    it('downgrades a reload failure to a log warning and still succeeds', async () => {
        const wiki = createFakeWiki(wikiDir, {
            reload: () => { throw new Error('graph missing'); },
        });
        const { events } = await run({ startPhase: 1, endPhase: 4, wiki });

        expect(events.some((e) => e.type === 'log' && e.message === 'Warning: Failed to reload wiki data: graph missing')).toBe(true);
        expect(last(events)).toMatchObject({ type: 'done', success: true });
    });
});
