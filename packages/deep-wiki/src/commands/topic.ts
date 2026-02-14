/**
 * Topic Command
 *
 * Implements the `deep-wiki topic <repo-path> [topic-name]` command.
 * Orchestrates the full topic generation pipeline:
 *   Phase A: Topic Probe       → EnrichedProbeResult
 *   Phase B: Topic Outline     → TopicOutline
 *   Phase C: Topic Analysis    → TopicAnalysis
 *   Phase D: Article Generation→ TopicArticle[]
 *   Phase E: File Writing & Wiki Integration
 *   Phase F: Website Regeneration (optional)
 *
 * Also handles --list and --check sub-flows.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type {
    TopicCommandOptions,
    TopicRequest,
    TopicOutline,
    TopicAnalysis,
    TopicArticle,
    TopicAreaMeta,
} from '../types';
import { checkAIAvailability } from '../ai-invoker';
import {
    getFolderHeadHash,
} from '../cache';
import {
    getCachedTopicProbe,
    saveTopicProbe,
    getCachedTopicOutline,
    saveTopicOutline,
    getCachedTopicAnalysis,
    saveTopicAnalysis,
    getCachedTopicArticles,
    saveTopicArticle,
    isTopicCacheValid,
} from '../cache/topic-cache';
import {
    loadWikiGraph,
    listTopicAreas,
    checkTopicCoverage,
    runSingleTopicProbe,
    generateTopicOutline,
    runTopicAnalysis,
    generateTopicArticles,
    writeTopicArticles,
    integrateTopicIntoWiki,
} from '../topic';
import { generateWebsite } from '../writing';
import {
    Spinner,
    printSuccess,
    printError,
    printWarning,
    printInfo,
    printHeader,
    printKeyValue,
    bold,
    gray,
} from '../logger';
import { EXIT_CODES } from '../cli';

// ============================================================================
// Execute Topic Command
// ============================================================================

/**
 * Execute the topic command — full topic generation pipeline.
 *
 * @param repoPath - Path to the local git repository
 * @param topicName - Topic to generate (optional for --list)
 * @param options - Command options
 * @returns Exit code
 */
export async function executeTopic(
    repoPath: string,
    topicName: string | undefined,
    options: TopicCommandOptions
): Promise<number> {
    const startTime = Date.now();

    // Resolve to absolute path
    const absoluteRepoPath = path.resolve(repoPath);

    // ====================================================================
    // 1. Validate inputs
    // ====================================================================
    if (!fs.existsSync(absoluteRepoPath)) {
        printError(`Repository path does not exist: ${absoluteRepoPath}`);
        return EXIT_CODES.CONFIG_ERROR;
    }

    if (!fs.statSync(absoluteRepoPath).isDirectory()) {
        printError(`Repository path is not a directory: ${absoluteRepoPath}`);
        return EXIT_CODES.CONFIG_ERROR;
    }

    const wikiDir = path.resolve(options.wiki);

    // ====================================================================
    // 2. Handle --list sub-flow
    // ====================================================================
    if (options.list) {
        const topics = listTopicAreas(wikiDir);
        printTopicList(topics);
        return EXIT_CODES.SUCCESS;
    }

    // Require topic name for all other flows
    if (!topicName) {
        printError('Topic name is required. Usage: deep-wiki topic <repo-path> <topic-name>');
        return EXIT_CODES.CONFIG_ERROR;
    }

    const topicId = topicName.toLowerCase().replace(/\s+/g, '-');
    const topicRequest: TopicRequest = {
        topic: topicId,
        description: options.description,
    };

    // ====================================================================
    // 3. Load existing wiki (if available)
    // ====================================================================
    const graph = loadWikiGraph(wikiDir);

    // ====================================================================
    // 4. Handle --check sub-flow
    // ====================================================================
    if (graph) {
        const coverage = checkTopicCoverage(topicRequest, graph, wikiDir);

        if (options.check) {
            printCoverageResult(topicId, coverage);
            return EXIT_CODES.SUCCESS;
        }

        // 5. Check coverage (with --force override)
        if (coverage.status === 'exists' && !options.force) {
            printInfo(`Topic "${topicId}" already covered in wiki.`);
            if (coverage.existingArticlePath) {
                printInfo(`  Existing article: ${coverage.existingArticlePath}`);
            }
            printInfo('Use --force to regenerate.');
            return EXIT_CODES.SUCCESS;
        }
    } else if (options.check) {
        printInfo(`No wiki found at ${wikiDir}. Topic "${topicId}" is new.`);
        return EXIT_CODES.SUCCESS;
    }

    // ====================================================================
    // Print header
    // ====================================================================
    printHeader('Deep Wiki — Topic Generation');
    process.stderr.write(`${'─'.repeat(35)}\n`);
    printKeyValue('Repository', absoluteRepoPath);
    printKeyValue('Topic', topicId);
    if (options.description) { printKeyValue('Description', options.description); }
    printKeyValue('Wiki', wikiDir);
    printKeyValue('Depth', options.depth);
    process.stderr.write('\n');

    // ====================================================================
    // Check AI availability
    // ====================================================================
    const availability = await checkAIAvailability();
    if (!availability.available) {
        printError(`Copilot SDK is not available: ${availability.reason || 'Unknown reason'}`);
        printInfo('Setup instructions:');
        printInfo('  1. Install GitHub Copilot extension');
        printInfo('  2. Sign in with your GitHub account');
        printInfo('  3. Ensure Copilot has SDK access');
        return EXIT_CODES.AI_UNAVAILABLE;
    }

    // ====================================================================
    // 6. Get git hash for caching
    // ====================================================================
    const gitHash = await getFolderHeadHash(absoluteRepoPath) ?? 'unknown';

    const spinner = new Spinner();

    try {
        // ================================================================
        // Phase A: Topic Probe
        // ================================================================
        spinner.start('Probing codebase for topic...');

        let probeResult;
        const useCache = !options.force && isTopicCacheValid(topicId, wikiDir, gitHash);

        if (useCache) {
            probeResult = getCachedTopicProbe(topicId, wikiDir);
        }

        if (!probeResult) {
            probeResult = await runSingleTopicProbe({
                repoPath: absoluteRepoPath,
                topic: topicRequest,
                existingGraph: graph ?? undefined,
                model: options.model,
                timeout: options.timeout,
            });
            saveTopicProbe(topicId, probeResult, wikiDir, gitHash);
        }

        const moduleCount = probeResult.probeResult.foundModules.length;
        const fileCount = probeResult.allKeyFiles.length;

        if (moduleCount === 0) {
            spinner.fail('Probe found no related modules');
            printWarning(`No code related to "${topicId}" was found in the repository.`);
            printInfo('Suggestions:');
            printInfo('  • Try a different topic name or add --description');
            printInfo('  • Check that the repository path is correct');
            return EXIT_CODES.EXECUTION_ERROR;
        }

        spinner.succeed(`Found ${moduleCount} modules, ${fileCount} files`);

        // ================================================================
        // Phase B: Topic Outline
        // ================================================================
        spinner.start('Planning article structure...');

        let outline: TopicOutline;
        if (useCache) {
            const cachedOutline = getCachedTopicOutline(topicId, wikiDir);
            outline = cachedOutline ?? await generateTopicOutline({
                repoPath: absoluteRepoPath,
                topic: topicRequest,
                probeResult,
                depth: options.depth,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
            });
        } else {
            outline = await generateTopicOutline({
                repoPath: absoluteRepoPath,
                topic: topicRequest,
                probeResult,
                depth: options.depth,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
            });
        }
        saveTopicOutline(topicId, outline, wikiDir, gitHash);

        const layoutDesc = outline.layout === 'single'
            ? '1 article'
            : `index + ${outline.articles.filter(a => !a.isIndex).length} sub-articles`;
        spinner.succeed(`${outline.layout} layout: ${layoutDesc}`);

        // ================================================================
        // Phase C: Topic Analysis
        // ================================================================
        spinner.start('Analyzing topic code...');

        let analysis: TopicAnalysis;
        if (useCache) {
            const cachedAnalysis = getCachedTopicAnalysis(topicId, wikiDir);
            analysis = cachedAnalysis ?? await runTopicAnalysis({
                repoPath: absoluteRepoPath,
                outline,
                probeResult,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
                concurrency: options.concurrency,
                depth: options.depth,
            });
        } else {
            analysis = await runTopicAnalysis({
                repoPath: absoluteRepoPath,
                outline,
                probeResult,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
                concurrency: options.concurrency,
                depth: options.depth,
            });
        }
        saveTopicAnalysis(topicId, analysis, wikiDir, gitHash);

        spinner.succeed(`${analysis.perArticle.length + 1}/${outline.articles.length} analyses complete`);

        // ================================================================
        // Phase D: Article Generation
        // ================================================================
        spinner.start('Generating articles...');

        let articles: TopicArticle[];
        if (useCache) {
            const cachedArticles = getCachedTopicArticles(topicId, wikiDir);
            if (cachedArticles && cachedArticles.length === outline.articles.length) {
                articles = cachedArticles;
            } else {
                const genResult = await generateTopicArticles({
                    topicId,
                    outline,
                    analysis,
                    depth: options.depth,
                    model: options.model,
                    timeout: options.timeout ? options.timeout * 1000 : undefined,
                    concurrency: options.concurrency,
                    onArticleComplete: (article) => {
                        saveTopicArticle(topicId, article, wikiDir, gitHash);
                    },
                });
                articles = genResult.articles;
                if (genResult.failedSlugs && genResult.failedSlugs.length > 0) {
                    printWarning(`  ${genResult.failedSlugs.length} article(s) failed: ${genResult.failedSlugs.join(', ')}`);
                }
            }
        } else {
            const genResult = await generateTopicArticles({
                topicId,
                outline,
                analysis,
                depth: options.depth,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
                concurrency: options.concurrency,
                onArticleComplete: (article) => {
                    saveTopicArticle(topicId, article, wikiDir, gitHash);
                },
            });
            articles = genResult.articles;
            if (genResult.failedSlugs && genResult.failedSlugs.length > 0) {
                printWarning(`  ${genResult.failedSlugs.length} article(s) failed: ${genResult.failedSlugs.join(', ')}`);
            }
        }

        spinner.succeed(`${articles.length}/${outline.articles.length} articles generated`);

        // ================================================================
        // Phase E: File Writing & Wiki Integration
        // ================================================================
        spinner.start('Writing to wiki...');

        const integrationResult = integrateTopicIntoWiki({
            wikiDir,
            topicId,
            outline,
            articles,
            noCrossLink: options.noCrossLink,
        });

        spinner.succeed(`${integrationResult.writtenFiles.length} files written`);

        if (integrationResult.updatedFiles.length > 0 && !options.noCrossLink) {
            printSuccess(`Cross-linked ${integrationResult.updatedFiles.length} module article(s)`);
        }

        // ================================================================
        // Phase F: Website Regeneration (optional)
        // ================================================================
        if (!options.noWebsite && fs.existsSync(path.join(wikiDir, 'index.html'))) {
            spinner.start('Regenerating website...');
            try {
                generateWebsite(wikiDir, {});
                spinner.succeed('Website updated');
            } catch {
                spinner.warn('Website regeneration failed');
            }
        }

        // ================================================================
        // Summary
        // ================================================================
        const totalDuration = Date.now() - startTime;
        process.stderr.write('\n');
        const topicDir = outline.layout === 'single'
            ? `${wikiDir}/topics/${topicId}.md`
            : `${wikiDir}/topics/${topicId}/`;
        printSuccess(`Topic area generated: ${bold(topicDir)}`);
        printInfo(`   📄 ${articles.length} articles (${layoutDesc})`);
        printInfo(`   📊 ${moduleCount} modules, ${fileCount} key files`);
        printInfo(`   ⏱  ${formatDuration(totalDuration)}`);

        return EXIT_CODES.SUCCESS;

    } catch (error) {
        spinner.fail('Topic generation failed');
        printError(`${error instanceof Error ? error.message : String(error)}`);
        return EXIT_CODES.EXECUTION_ERROR;
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Print the list of existing topic areas.
 */
function printTopicList(topics: TopicAreaMeta[]): void {
    if (topics.length === 0) {
        printInfo('No topic areas found in wiki.');
        return;
    }

    printHeader('Topic Areas');
    for (const topic of topics) {
        const articleCount = topic.articles.length;
        const layout = topic.layout === 'single' ? 'single' : `${articleCount} articles`;
        process.stderr.write(`  ${bold(topic.title)} ${gray(`(${topic.id})`)}  ${layout}\n`);
        if (topic.description) {
            process.stderr.write(`    ${gray(topic.description)}\n`);
        }
    }
    process.stderr.write('\n');
    printInfo(`${topics.length} topic area(s) found.`);
}

/**
 * Print coverage check result.
 */
function printCoverageResult(
    topicId: string,
    coverage: { status: string; existingArticlePath?: string; relatedModules: { moduleId: string; relevance: string }[] }
): void {
    if (coverage.status === 'exists') {
        printSuccess(`Topic "${topicId}" is fully covered.`);
        if (coverage.existingArticlePath) {
            printInfo(`  Article: ${coverage.existingArticlePath}`);
        }
    } else if (coverage.status === 'partial') {
        printWarning(`Topic "${topicId}" is partially covered.`);
        const relatedHigh = coverage.relatedModules.filter(m => m.relevance === 'high');
        if (relatedHigh.length > 0) {
            printInfo(`  Related modules: ${relatedHigh.map(m => m.moduleId).join(', ')}`);
        }
    } else {
        printInfo(`Topic "${topicId}" is new — not covered in wiki.`);
    }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}
