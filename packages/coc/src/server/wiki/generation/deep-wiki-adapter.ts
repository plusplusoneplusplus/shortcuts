/**
 * The single place where CoC reaches into deep-wiki internals. Everything is
 * loaded through dynamic imports so coc keeps no compile-time dependency on
 * deep-wiki (it is not in coc's package.json dependencies).
 *
 * Runtime module paths stay `@plusplusoneplusplus/deep-wiki/dist/*` — packaged
 * and workspace-linked resolution both depend on those exact specifiers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================================
// Dynamic Import Helper
// ============================================================================

async function importDeepWiki(subpath: string): Promise<any> {
    // The template literal keeps TypeScript from resolving the module specifier
    // at compile time. At runtime the monorepo workspace link makes
    // `@plusplusoneplusplus/deep-wiki` resolvable.
    const modulePath = `@plusplusoneplusplus/deep-wiki/dist/${subpath}`;
    return import(modulePath);
}

// ============================================================================
// Types
// ============================================================================

export interface AIAvailability {
    available: boolean;
    reason?: string;
}

export interface PhaseModule {
    runPhase1: (repoPath: string, options: any, isCancelled: () => boolean) => Promise<any>;
    runPhase2Consolidation: (repoPath: string, graph: any, options: any, usageTracker: any) => Promise<any>;
    runPhase3Analysis: (repoPath: string, graph: any, options: any, isCancelled: () => boolean, usageTracker: any) => Promise<any>;
    runPhase4Writing: (repoPath: string, graph: any, analyses: any[], options: any, isCancelled: () => boolean, usageTracker: any, reanalyzedComponentIds?: string[]) => Promise<any>;
    runPhase5Website: (options: any) => { success: boolean };
}

export interface CacheModule {
    getCachedGraphAny: (outputDir: string) => any;
    getCachedGraph: (repoPath: string, outputDir: string) => Promise<any>;
    getCachedAnalyses: (outputDir: string) => any[] | undefined;
    getCachedConsolidationAny: (outputDir: string, componentCount: number) => any;
    getCachedConsolidation: (repoPath: string, outputDir: string, componentCount: number) => Promise<any>;
    getCachedAnalysis: (componentId: string, outputDir: string) => any;
}

export interface ArticleWriteModule {
    normalizeComponentId: (componentId: string) => string;
    saveArticle: (componentId: string, article: any, outputDir: string, gitHash: string) => void;
    getFolderHeadHash: (repoPath: string) => Promise<string | undefined>;
    getArticleFilePath: (article: any, resolvedDir: string) => string;
    normalizeLineEndings: (content: string) => string;
}

export interface AIInvokeResult {
    success: boolean;
    response?: string;
    error?: string;
}

/**
 * Stable contract for everything CoC needs from deep-wiki.
 * Tests substitute a fake instead of mocking dynamic imports at each call site.
 */
export interface DeepWikiAdapter {
    loadPhases(): Promise<PhaseModule>;
    loadCache(): Promise<CacheModule>;
    createUsageTracker(): Promise<any>;
    checkAIAvailability(): Promise<AIAvailability>;
    buildComponentArticlePrompt(analysis: any, graph: any, depth: string): Promise<string>;
    createWritingInvoker(options: { repoPath: string }): Promise<(prompt: string) => Promise<AIInvokeResult>>;
    loadArticleWriter(): Promise<ArticleWriteModule>;
}

// ============================================================================
// Default Implementation
// ============================================================================

class DynamicDeepWikiAdapter implements DeepWikiAdapter {
    async loadPhases(): Promise<PhaseModule> {
        const phases = await importDeepWiki('commands/phases');
        return {
            runPhase1: phases.runPhase1,
            runPhase2Consolidation: phases.runPhase2Consolidation,
            runPhase3Analysis: phases.runPhase3Analysis,
            runPhase4Writing: phases.runPhase4Writing,
            runPhase5Website: phases.runPhase5Website,
        };
    }

    async loadCache(): Promise<CacheModule> {
        const cache = await importDeepWiki('cache');
        return {
            getCachedGraphAny: cache.getCachedGraphAny,
            getCachedGraph: cache.getCachedGraph,
            getCachedAnalyses: cache.getCachedAnalyses,
            getCachedConsolidationAny: cache.getCachedConsolidationAny,
            getCachedConsolidation: cache.getCachedConsolidation,
            getCachedAnalysis: cache.getCachedAnalysis,
        };
    }

    async createUsageTracker(): Promise<any> {
        const { UsageTracker } = await importDeepWiki('usage-tracker');
        return new UsageTracker();
    }

    async checkAIAvailability(): Promise<AIAvailability> {
        const { checkAIAvailability } = await importDeepWiki('ai-invoker');
        return checkAIAvailability();
    }

    async buildComponentArticlePrompt(analysis: any, graph: any, depth: string): Promise<string> {
        const { buildComponentArticlePrompt } = await importDeepWiki('writing/prompts');
        return buildComponentArticlePrompt(analysis, graph, depth);
    }

    async createWritingInvoker(options: { repoPath: string }): Promise<(prompt: string) => Promise<AIInvokeResult>> {
        const { createWritingInvoker } = await importDeepWiki('ai-invoker');
        return createWritingInvoker(options);
    }

    async loadArticleWriter(): Promise<ArticleWriteModule> {
        const { normalizeComponentId } = await importDeepWiki('schemas');
        const { saveArticle } = await importDeepWiki('cache/article-cache');
        const { getFolderHeadHash } = await importDeepWiki('cache/git-utils');
        const { getArticleFilePath, normalizeLineEndings } = await importDeepWiki('writing/file-writer');
        return { normalizeComponentId, saveArticle, getFolderHeadHash, getArticleFilePath, normalizeLineEndings };
    }
}

/** Shared adapter used when no explicit adapter is injected. */
export const defaultDeepWikiAdapter: DeepWikiAdapter = new DynamicDeepWikiAdapter();
