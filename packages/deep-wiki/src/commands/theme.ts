/**
 * Theme Command
 *
 * Implements the `deep-wiki theme <repo-path> [theme-name]` command.
 * Orchestrates the full theme generation pipeline:
 *   Phase A: Theme Probe       → EnrichedProbeResult
 *   Phase B: Theme Outline     → ThemeOutline
 *   Phase C: Theme Analysis    → ThemeAnalysis
 *   Phase D: Article Generation→ ThemeArticle[]
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
    ThemeCommandOptions,
    ThemeRequest,
    ThemeOutline,
    ThemeAnalysis,
    ThemeArticle,
    ThemeMeta,
} from '../types';
import { checkAIAvailability } from '../ai-invoker';
import {
    getFolderHeadHash,
} from '../cache';
import {
    getCachedThemeProbe,
    saveThemeProbe,
    getCachedThemeOutline,
    saveThemeOutline,
    getCachedThemeAnalysis,
    saveThemeAnalysis,
    getCachedThemeArticles,
    saveThemeArticle,
    isThemeCacheValid,
} from '../cache/theme-cache';
import {
    loadWikiGraph,
    listThemeAreas,
    checkThemeCoverage,
    runSingleThemeProbe,
    generateThemeOutline,
    runThemeAnalysis,
    generateThemeArticles,
    writeThemeArticles,
    integrateThemeIntoWiki,
} from '../theme';
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
// Execute Theme Command
// ============================================================================

/**
 * Execute the theme command — full theme generation pipeline.
 *
 * @param repoPath - Path to the local git repository
 * @param themeName - Theme to generate (optional for --list)
 * @param options - Command options
 * @returns Exit code
 */
export async function executeTheme(
    repoPath: string,
    themeName: string | undefined,
    options: ThemeCommandOptions
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
        const themes = listThemeAreas(wikiDir);
        printThemeList(themes);
        return EXIT_CODES.SUCCESS;
    }

    // Require theme name for all other flows
    if (!themeName) {
        printError('Theme name is required. Usage: deep-wiki theme <repo-path> <theme-name>');
        return EXIT_CODES.CONFIG_ERROR;
    }

    const themeId = themeName.toLowerCase().replace(/\s+/g, '-');
    const themeRequest: ThemeRequest = {
        theme: themeId,
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
        const coverage = checkThemeCoverage(themeRequest, graph, wikiDir);

        if (options.check) {
            printCoverageResult(themeId, coverage);
            return EXIT_CODES.SUCCESS;
        }

        // 5. Check coverage (with --force override)
        if (coverage.status === 'exists' && !options.force) {
            printInfo(`Theme "${themeId}" already covered in wiki.`);
            if (coverage.existingArticlePath) {
                printInfo(`  Existing article: ${coverage.existingArticlePath}`);
            }
            printInfo('Use --force to regenerate.');
            return EXIT_CODES.SUCCESS;
        }
    } else if (options.check) {
        printInfo(`No wiki found at ${wikiDir}. Theme "${themeId}" is new.`);
        return EXIT_CODES.SUCCESS;
    }

    // ====================================================================
    // Print header
    // ====================================================================
    printHeader('Deep Wiki — Theme Generation');
    process.stderr.write(`${'─'.repeat(35)}\n`);
    printKeyValue('Repository', absoluteRepoPath);
    printKeyValue('Theme', themeId);
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
        // Phase A: Theme Probe
        // ================================================================
        spinner.start('Probing codebase for theme...');

        let probeResult;
        const useCache = !options.force && isThemeCacheValid(themeId, wikiDir, gitHash);

        if (useCache) {
            probeResult = getCachedThemeProbe(themeId, wikiDir);
        }

        if (!probeResult) {
            probeResult = await runSingleThemeProbe({
                repoPath: absoluteRepoPath,
                theme: themeRequest,
                existingGraph: graph ?? undefined,
                model: options.model,
                timeout: options.timeout,
            });
            saveThemeProbe(themeId, probeResult, wikiDir, gitHash);
        }

        const componentCount = probeResult.probeResult.foundComponents.length;
        const fileCount = probeResult.allKeyFiles.length;

        if (componentCount === 0) {
            spinner.fail('Probe found no related components');
            printWarning(`No code related to "${themeId}" was found in the repository.`);
            printInfo('Suggestions:');
            printInfo('  • Try a different theme name or add --description');
            printInfo('  • Check that the repository path is correct');
            return EXIT_CODES.EXECUTION_ERROR;
        }

        spinner.succeed(`Found ${componentCount} components, ${fileCount} files`);

        // ================================================================
        // Phase B: Theme Outline
        // ================================================================
        spinner.start('Planning article structure...');

        let outline: ThemeOutline;
        if (useCache) {
            const cachedOutline = getCachedThemeOutline(themeId, wikiDir);
            outline = cachedOutline ?? await generateThemeOutline({
                repoPath: absoluteRepoPath,
                theme: themeRequest,
                probeResult,
                depth: options.depth,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
            });
        } else {
            outline = await generateThemeOutline({
                repoPath: absoluteRepoPath,
                theme: themeRequest,
                probeResult,
                depth: options.depth,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
            });
        }
        saveThemeOutline(themeId, outline, wikiDir, gitHash);

        const layoutDesc = outline.layout === 'single'
            ? '1 article'
            : `index + ${outline.articles.filter(a => !a.isIndex).length} sub-articles`;
        spinner.succeed(`${outline.layout} layout: ${layoutDesc}`);

        // ================================================================
        // Phase C: Theme Analysis
        // ================================================================
        spinner.start('Analyzing theme code...');

        let analysis: ThemeAnalysis;
        if (useCache) {
            const cachedAnalysis = getCachedThemeAnalysis(themeId, wikiDir);
            analysis = cachedAnalysis ?? await runThemeAnalysis({
                repoPath: absoluteRepoPath,
                outline,
                probeResult,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
                concurrency: options.concurrency,
                depth: options.depth,
            });
        } else {
            analysis = await runThemeAnalysis({
                repoPath: absoluteRepoPath,
                outline,
                probeResult,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
                concurrency: options.concurrency,
                depth: options.depth,
            });
        }
        saveThemeAnalysis(themeId, analysis, wikiDir, gitHash);

        spinner.succeed(`${analysis.perArticle.length + 1}/${outline.articles.length} analyses complete`);

        // ================================================================
        // Phase D: Article Generation
        // ================================================================
        spinner.start('Generating articles...');

        let articles: ThemeArticle[];
        if (useCache) {
            const cachedArticles = getCachedThemeArticles(themeId, wikiDir);
            if (cachedArticles && cachedArticles.length === outline.articles.length) {
                articles = cachedArticles;
            } else {
                const genResult = await generateThemeArticles({
                    themeId,
                    outline,
                    analysis,
                    depth: options.depth,
                    model: options.model,
                    timeout: options.timeout ? options.timeout * 1000 : undefined,
                    concurrency: options.concurrency,
                    onArticleComplete: (article) => {
                        saveThemeArticle(themeId, article, wikiDir, gitHash);
                    },
                });
                articles = genResult.articles;
                if (genResult.failedSlugs && genResult.failedSlugs.length > 0) {
                    printWarning(`  ${genResult.failedSlugs.length} article(s) failed: ${genResult.failedSlugs.join(', ')}`);
                }
            }
        } else {
            const genResult = await generateThemeArticles({
                themeId,
                outline,
                analysis,
                depth: options.depth,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
                concurrency: options.concurrency,
                onArticleComplete: (article) => {
                    saveThemeArticle(themeId, article, wikiDir, gitHash);
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

        const integrationResult = integrateThemeIntoWiki({
            wikiDir,
            themeId,
            outline,
            articles,
            noCrossLink: options.noCrossLink,
        });

        spinner.succeed(`${integrationResult.writtenFiles.length} files written`);

        if (integrationResult.updatedFiles.length > 0 && !options.noCrossLink) {
            printSuccess(`Cross-linked ${integrationResult.updatedFiles.length} component article(s)`);
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
        const themeDir = outline.layout === 'single'
            ? `${wikiDir}/themes/${themeId}.md`
            : `${wikiDir}/themes/${themeId}/`;
        printSuccess(`Theme area generated: ${bold(themeDir)}`);
        printInfo(`   📄 ${articles.length} articles (${layoutDesc})`);
        printInfo(`   📊 ${componentCount} components, ${fileCount} key files`);
        printInfo(`   ⏱  ${formatDuration(totalDuration)}`);

        return EXIT_CODES.SUCCESS;

    } catch (error) {
        spinner.fail('Theme generation failed');
        printError(`${error instanceof Error ? error.message : String(error)}`);
        return EXIT_CODES.EXECUTION_ERROR;
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Print the list of existing theme areas.
 */
function printThemeList(themes: ThemeMeta[]): void {
    if (themes.length === 0) {
        printInfo('No theme areas found in wiki.');
        return;
    }

    printHeader('Theme Areas');
    for (const theme of themes) {
        const articleCount = theme.articles.length;
        const layout = theme.layout === 'single' ? 'single' : `${articleCount} articles`;
        process.stderr.write(`  ${bold(theme.title)} ${gray(`(${theme.id})`)}  ${layout}\n`);
        if (theme.description) {
            process.stderr.write(`    ${gray(theme.description)}\n`);
        }
    }
    process.stderr.write('\n');
    printInfo(`${themes.length} theme area(s) found.`);
}

/**
 * Print coverage check result.
 */
function printCoverageResult(
    themeId: string,
    coverage: { status: string; existingArticlePath?: string; relatedComponents: { componentId: string; relevance: string }[] }
): void {
    if (coverage.status === 'exists') {
        printSuccess(`Theme "${themeId}" is fully covered.`);
        if (coverage.existingArticlePath) {
            printInfo(`  Article: ${coverage.existingArticlePath}`);
        }
    } else if (coverage.status === 'partial') {
        printWarning(`Theme "${themeId}" is partially covered.`);
        const relatedHigh = coverage.relatedComponents.filter(m => m.relevance === 'high');
        if (relatedHigh.length > 0) {
            printInfo(`  Related modules: ${relatedHigh.map(m => m.componentId).join(', ')}`);
        }
    } else {
        printInfo(`Theme "${themeId}" is new — not covered in wiki.`);
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
