/**
 * Regenerates a single component article. Shares the registry, adapter, event
 * sink, AI availability check and wiki-reload policy with full generation so
 * the two paths cannot drift apart.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from 'path';
import * as fs from 'fs';
import type { GenerateWiki } from '../wiki-backend';
import type { GenerationEventSink } from './events';
import type { GenerationHandle } from './generation-registry';
import { defaultDeepWikiAdapter, type DeepWikiAdapter } from './deep-wiki-adapter';
import { reloadWikiData } from './generation-runner';

export interface RunComponentRegenerationOptions {
    wiki: GenerateWiki;
    componentId: string;
    componentInfo: any;
    analysis: any;
    graph: any;
    emit: GenerationEventSink;
    handle: GenerationHandle;
    adapter?: DeepWikiAdapter;
}

/**
 * Write one component article: prompt → AI → cache + markdown file → reload.
 * The caller has already resolved the analysis and claimed the wiki.
 */
export async function runComponentRegeneration(options: RunComponentRegenerationOptions): Promise<void> {
    const { wiki, componentId, componentInfo, analysis, graph, emit, handle } = options;
    const adapter = options.adapter ?? defaultDeepWikiAdapter;

    const repoPath = path.resolve(wiki.registration.repoPath!);
    const outputDir = wiki.registration.wikiDir;
    const startTime = Date.now();
    const componentName = componentInfo.name || componentId;

    emit({ type: 'status', state: 'running', componentId, message: `Generating article for ${componentName}...` });

    if (handle.isCancelled()) {
        emit({ type: 'done', success: false, componentId, error: 'Cancelled' });
        return;
    }

    const availability = await adapter.checkAIAvailability();
    if (!availability.available) {
        emit({ type: 'error', message: `Copilot SDK not available: ${availability.reason || 'Unknown'}` });
        emit({ type: 'done', success: false, componentId, error: 'AI service unavailable' });
        return;
    }

    const prompt = await adapter.buildComponentArticlePrompt(analysis, graph, 'normal');

    emit({ type: 'log', message: 'Sending to AI model...' });

    const invoker = await adapter.createWritingInvoker({ repoPath });
    const aiResult = await invoker(prompt);

    if (!aiResult.success || !aiResult.response) {
        const errMsg = aiResult.error || 'AI returned empty response';
        emit({ type: 'error', message: errMsg });
        emit({ type: 'done', success: false, componentId, error: errMsg });
        return;
    }

    emit({ type: 'log', message: 'Article generated, saving...' });

    const { normalizeComponentId, saveArticle, getFolderHeadHash, getArticleFilePath, normalizeLineEndings } =
        await adapter.loadArticleWriter();

    const article = {
        type: 'component' as const,
        slug: normalizeComponentId(componentId),
        title: componentName,
        content: aiResult.response,
        componentId,
        domainId: componentInfo.domain,
    };

    const gitHash = await getFolderHeadHash(repoPath) || 'unknown';
    saveArticle(componentId, article, outputDir, gitHash);

    const resolvedDir = path.resolve(outputDir);
    const filePath = getArticleFilePath(article, resolvedDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, normalizeLineEndings(article.content), 'utf-8');

    reloadWikiData(wiki, emit);

    emit({ type: 'done', success: true, componentId, duration: Date.now() - startTime, message: 'Article regenerated' });
}
