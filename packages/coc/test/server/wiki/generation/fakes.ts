/**
 * Test doubles for the wiki generation domain layer.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { vi } from 'vitest';
import type {
    DeepWikiAdapter,
    GenerationHandle,
} from '../../../../src/server/wiki/generation';

export interface FakeAdapterOverrides {
    phases?: Partial<Record<string, any>>;
    cache?: Partial<Record<string, any>>;
    aiAvailable?: { available: boolean; reason?: string };
    prompt?: string;
    invokeResult?: { success: boolean; response?: string; error?: string };
    articleWriter?: Partial<Record<string, any>>;
}

export interface FakeAdapter extends DeepWikiAdapter {
    calls: {
        phases: Record<string, any>;
        cache: Record<string, any>;
        articleWriter: Record<string, any>;
        usageTracker: { addUsage: ReturnType<typeof vi.fn> };
        invoker: ReturnType<typeof vi.fn>;
    };
}

/** Adapter whose deep-wiki surface is fully stubbed — no dynamic imports. */
export function createFakeAdapter(overrides: FakeAdapterOverrides = {}): FakeAdapter {
    const usageTracker = { addUsage: vi.fn() };

    const phases: Record<string, any> = {
        runPhase1: vi.fn(async () => ({ graph: makeGraph(['auth', 'db']), tokenUsage: { total: 10 } })),
        runPhase2Consolidation: vi.fn(async () => ({ graph: makeGraph(['auth']) })),
        runPhase3Analysis: vi.fn(async () => ({
            analyses: [{ componentId: 'auth' }],
            reanalyzedComponentIds: ['auth'],
        })),
        runPhase4Writing: vi.fn(async () => ({ articlesWritten: 1 })),
        runPhase5Website: vi.fn(() => ({ success: true })),
        ...overrides.phases,
    };

    const cache: Record<string, any> = {
        getCachedGraphAny: vi.fn(() => null),
        getCachedGraph: vi.fn(async () => null),
        getCachedAnalyses: vi.fn(() => []),
        getCachedConsolidationAny: vi.fn(() => null),
        getCachedConsolidation: vi.fn(async () => null),
        getCachedAnalysis: vi.fn(() => null),
        ...overrides.cache,
    };

    const articleWriter: Record<string, any> = {
        normalizeComponentId: vi.fn((id: string) => id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()),
        saveArticle: vi.fn(),
        getFolderHeadHash: vi.fn(async () => 'abc123'),
        getArticleFilePath: vi.fn((article: any, dir: string) => `${dir}/${article.slug}.md`),
        normalizeLineEndings: vi.fn((content: string) => content),
        ...overrides.articleWriter,
    };

    const invoker = vi.fn(async () => overrides.invokeResult ?? { success: true, response: '# Article' });

    return {
        calls: { phases, cache, articleWriter, usageTracker, invoker },
        loadPhases: vi.fn(async () => phases as any),
        loadCache: vi.fn(async () => cache as any),
        createUsageTracker: vi.fn(async () => usageTracker),
        checkAIAvailability: vi.fn(async () => overrides.aiAvailable ?? { available: true }),
        buildComponentArticlePrompt: vi.fn(async () => overrides.prompt ?? 'PROMPT'),
        createWritingInvoker: vi.fn(async () => invoker as any),
        loadArticleWriter: vi.fn(async () => articleWriter as any),
    };
}

/** Handle with a cancellation flag the test controls directly. */
export function createFakeHandle(initiallyCancelled = false): GenerationHandle & {
    cancel(): void;
    phases: number[];
    finished: boolean;
} {
    let cancelled = initiallyCancelled;
    const phases: number[] = [];
    const handle = {
        wikiId: 'w1',
        phases,
        finished: false,
        isCancelled: () => cancelled,
        setPhase: (phase: number) => { phases.push(phase); },
        finish: () => { handle.finished = true; },
        cancel: () => { cancelled = true; },
    };
    return handle;
}

export function makeGraph(componentIds: string[], extras: Record<string, any> = {}): any {
    return {
        components: componentIds.map((id) => ({ id, name: id.toUpperCase(), domain: 'core' })),
        categories: [],
        themes: [],
        domains: [],
        project: { name: 'Test', language: 'TypeScript' },
        ...extras,
    };
}

export interface FakeWiki {
    registration: { repoPath?: string; wikiDir: string };
    wikiData: {
        graph: any;
        reload: ReturnType<typeof vi.fn>;
        getComponentDetail: ReturnType<typeof vi.fn>;
    };
}

export function createFakeWiki(wikiDir: string, options: {
    repoPath?: string;
    graph?: any;
    reload?: () => void;
    componentDetail?: any;
} = {}): FakeWiki {
    // `repoPath: undefined` must stay undefined — several tests rely on the
    // "no repository configured" branch.
    const repoPath = 'repoPath' in options ? options.repoPath : '/repo';
    return {
        registration: { repoPath, wikiDir },
        wikiData: {
            graph: options.graph ?? makeGraph(['auth']),
            reload: vi.fn(options.reload ?? (() => { /* no-op */ })),
            getComponentDetail: vi.fn(() => options.componentDetail ?? null),
        },
    };
}
