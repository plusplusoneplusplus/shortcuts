import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ThemeRequest, ThemeOutline } from '../../src/types';
import type { ProbeFoundComponent } from '../../src/discovery/iterative/types';
import type { EnrichedProbeResult } from '../../src/theme/theme-probe';

// ─── Mock SDK ──────────────────────────────────────────────────────────

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => ({
            sendMessage: mockSendMessage,
            isAvailable: mockIsAvailable,
        }),
    };
});

vi.mock('../../src/logger', () => ({
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    gray: (s: string) => s,
}));

import {
    generateThemeOutline,
    buildFallbackOutline,
    parseOutlineResponse,
    type OutlineGeneratorOptions,
} from '../../src/theme/outline-generator';
import { buildOutlinePrompt } from '../../src/theme/outline-prompts';

// ─── Helpers ───────────────────────────────────────────────────────────

function makeModule(overrides: Partial<ProbeFoundComponent> = {}): ProbeFoundComponent {
    return {
        id: 'mod-a',
        name: 'Module A',
        path: 'src/mod-a',
        purpose: 'Does A things',
        keyFiles: ['src/mod-a/index.ts'],
        evidence: 'found references',
        ...overrides,
    };
}

function makeProbeResult(modules: ProbeFoundComponent[]): EnrichedProbeResult {
    return {
        probeResult: {
            theme: 'test-theme',
            foundComponents: modules,
            discoveredThemes: [],
            dependencies: [],
            confidence: 0.8,
        },
        existingModuleIds: [],
        newModuleIds: modules.map(m => m.id),
        allKeyFiles: modules.flatMap(m => m.keyFiles),
    };
}

function makeTheme(overrides: Partial<ThemeRequest> = {}): ThemeRequest {
    return {
        theme: 'compaction',
        description: 'Log compaction and cleanup',
        hints: ['compact', 'merge'],
        ...overrides,
    };
}

function makeOptions(
    componentCount: number,
    overrides: Partial<OutlineGeneratorOptions> = {}
): OutlineGeneratorOptions {
    const modules = Array.from({ length: componentCount }, (_, i) =>
        makeModule({
            id: `mod-${i}`,
            name: `Module ${i}`,
            path: `src/mod-${i}`,
            keyFiles: [`src/mod-${i}/index.ts`],
        })
    );
    return {
        repoPath: '/repo',
        theme: makeTheme(),
        probeResult: makeProbeResult(modules),
        depth: 'normal',
        ...overrides,
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('outline-prompts', () => {
    describe('buildOutlinePrompt', () => {
        it('should include theme name and description', () => {
            const theme = makeTheme();
            const probe = makeProbeResult([makeModule()]);
            const prompt = buildOutlinePrompt(theme, probe, 'normal');

            expect(prompt).toContain('compaction');
            expect(prompt).toContain('Log compaction and cleanup');
        });

        it('should include search hints', () => {
            const theme = makeTheme({ hints: ['compact', 'merge'] });
            const probe = makeProbeResult([makeModule()]);
            const prompt = buildOutlinePrompt(theme, probe, 'normal');

            expect(prompt).toContain('compact, merge');
        });

        it('should include module information', () => {
            const mod = makeModule({ name: 'Compactor', purpose: 'Handles compaction' });
            const probe = makeProbeResult([mod]);
            const prompt = buildOutlinePrompt(makeTheme(), probe, 'normal');

            expect(prompt).toContain('Compactor');
            expect(prompt).toContain('Handles compaction');
            expect(prompt).toContain('src/mod-a/index.ts');
        });

        it('should include module count', () => {
            const modules = [
                makeModule({ id: 'mod-1', name: 'M1' }),
                makeModule({ id: 'mod-2', name: 'M2' }),
                makeModule({ id: 'mod-3', name: 'M3' }),
            ];
            const probe = makeProbeResult(modules);
            const prompt = buildOutlinePrompt(makeTheme(), probe, 'normal');

            expect(prompt).toContain('3 found');
        });

        it('should use shallow depth instruction', () => {
            const probe = makeProbeResult([makeModule()]);
            const prompt = buildOutlinePrompt(makeTheme(), probe, 'shallow');

            expect(prompt).toContain('SHALLOW');
            expect(prompt).toContain('fewer articles');
        });

        it('should use normal depth instruction', () => {
            const probe = makeProbeResult([makeModule()]);
            const prompt = buildOutlinePrompt(makeTheme(), probe, 'normal');

            expect(prompt).toContain('NORMAL');
            expect(prompt).toContain('Balanced');
        });

        it('should use deep depth instruction', () => {
            const probe = makeProbeResult([makeModule()]);
            const prompt = buildOutlinePrompt(makeTheme(), probe, 'deep');

            expect(prompt).toContain('DEEP');
            expect(prompt).toContain('Fine-grained');
        });

        it('should suggest single-article layout for few modules', () => {
            const probe = makeProbeResult([makeModule()]);
            const prompt = buildOutlinePrompt(makeTheme(), probe, 'normal');

            expect(prompt).toContain('single-article layout');
        });

        it('should suggest area layout for medium module count', () => {
            const modules = Array.from({ length: 4 }, (_, i) =>
                makeModule({ id: `mod-${i}`, name: `M${i}` })
            );
            const probe = makeProbeResult(modules);
            const prompt = buildOutlinePrompt(makeTheme(), probe, 'normal');

            expect(prompt).toContain('area layout');
        });

        it('should suggest area layout for large module count', () => {
            const modules = Array.from({ length: 8 }, (_, i) =>
                makeModule({ id: `mod-${i}`, name: `M${i}` })
            );
            const probe = makeProbeResult(modules);
            const prompt = buildOutlinePrompt(makeTheme(), probe, 'normal');

            expect(prompt).toContain('large theme');
        });

        it('should handle theme without description or hints', () => {
            const theme: ThemeRequest = { theme: 'auth' };
            const probe = makeProbeResult([makeModule()]);
            const prompt = buildOutlinePrompt(theme, probe, 'normal');

            expect(prompt).toContain('auth');
            expect(prompt).not.toContain('Description:');
            expect(prompt).not.toContain('Search hints:');
        });

        it('should handle empty modules', () => {
            const probe = makeProbeResult([]);
            const prompt = buildOutlinePrompt(makeTheme(), probe, 'normal');

            expect(prompt).toContain('0 found');
            expect(prompt).toContain('no modules discovered');
        });
    });
});

describe('outline-generator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('parseOutlineResponse', () => {
        const theme = makeTheme();
        const probe = makeProbeResult([makeModule()]);

        it('should parse a valid single-article response', () => {
            const response = JSON.stringify({
                title: 'Compaction',
                layout: 'single',
                articles: [{
                    slug: 'index',
                    title: 'Compaction Guide',
                    description: 'Full guide',
                    isIndex: true,
                    coveredComponentIds: ['mod-a'],
                    coveredFiles: ['src/mod-a/index.ts'],
                }],
            });

            const outline = parseOutlineResponse(response, theme, probe);

            expect(outline.themeId).toBe('compaction');
            expect(outline.title).toBe('Compaction');
            expect(outline.layout).toBe('single');
            expect(outline.articles).toHaveLength(1);
            expect(outline.articles[0].isIndex).toBe(true);
            expect(outline.articles[0].coveredComponentIds).toEqual(['mod-a']);
        });

        it('should parse a valid area-layout response', () => {
            const response = JSON.stringify({
                title: 'Compaction',
                layout: 'area',
                articles: [
                    { slug: 'index', title: 'Overview', description: 'Intro', isIndex: true, coveredComponentIds: ['mod-a'], coveredFiles: [] },
                    { slug: 'details', title: 'Details', description: 'Deep dive', isIndex: false, coveredComponentIds: ['mod-a'], coveredFiles: ['file.ts'] },
                ],
            });

            const outline = parseOutlineResponse(response, theme, probe);

            expect(outline.layout).toBe('area');
            expect(outline.articles).toHaveLength(2);
            expect(outline.articles[0].isIndex).toBe(true);
            expect(outline.articles[1].isIndex).toBe(false);
        });

        it('should default layout to single for invalid value', () => {
            const response = JSON.stringify({
                title: 'Test',
                layout: 'unknown',
                articles: [{ slug: 'x', title: 'X', description: '', isIndex: false, coveredComponentIds: [], coveredFiles: [] }],
            });

            const outline = parseOutlineResponse(response, theme, probe);
            expect(outline.layout).toBe('single');
        });

        it('should generate fallback article when articles array is empty', () => {
            const response = JSON.stringify({
                title: 'Compaction',
                layout: 'single',
                articles: [],
            });

            const outline = parseOutlineResponse(response, theme, probe);

            expect(outline.articles).toHaveLength(1);
            expect(outline.articles[0].slug).toBe('index');
            expect(outline.articles[0].isIndex).toBe(true);
            expect(outline.articles[0].coveredComponentIds).toEqual(['mod-a']);
        });

        it('should skip articles missing required fields', () => {
            const response = JSON.stringify({
                title: 'Test',
                layout: 'single',
                articles: [
                    { slug: 'valid', title: 'Valid', description: '', isIndex: false, coveredComponentIds: [], coveredFiles: [] },
                    { title: 'No Slug' },  // missing slug
                    { slug: 'no-title' },  // missing title
                    null,
                    42,
                ],
            });

            const outline = parseOutlineResponse(response, theme, probe);
            expect(outline.articles).toHaveLength(1);
            expect(outline.articles[0].slug).toBe('valid');
        });

        it('should use theme name as title when title is missing', () => {
            const response = JSON.stringify({
                layout: 'single',
                articles: [{ slug: 'x', title: 'X', description: '', isIndex: false, coveredComponentIds: [], coveredFiles: [] }],
            });

            const outline = parseOutlineResponse(response, theme, probe);
            expect(outline.title).toBe('Compaction');
        });

        it('should handle JSON embedded in markdown fences', () => {
            const response = 'Here is the outline:\n```json\n' + JSON.stringify({
                title: 'Test',
                layout: 'single',
                articles: [{ slug: 'x', title: 'X', description: 'desc', isIndex: true, coveredComponentIds: [], coveredFiles: [] }],
            }) + '\n```';

            const outline = parseOutlineResponse(response, theme, probe);
            expect(outline.title).toBe('Test');
            expect(outline.articles).toHaveLength(1);
        });

        it('should throw on completely invalid response', () => {
            expect(() => parseOutlineResponse('not json at all', theme, probe)).toThrow();
        });

        it('should throw on empty response', () => {
            expect(() => parseOutlineResponse('', theme, probe)).toThrow();
        });

        it('should populate involvedModules from probe results', () => {
            const response = JSON.stringify({
                title: 'Test',
                layout: 'single',
                articles: [{ slug: 'x', title: 'X', description: '', isIndex: true, coveredComponentIds: [], coveredFiles: [] }],
            });

            const outline = parseOutlineResponse(response, theme, probe);

            expect(outline.involvedComponents).toHaveLength(1);
            expect(outline.involvedComponents[0].componentId).toBe('mod-a');
            expect(outline.involvedComponents[0].keyFiles).toEqual(['src/mod-a/index.ts']);
        });

        it('should handle missing coveredModuleIds and coveredFiles gracefully', () => {
            const response = JSON.stringify({
                title: 'Test',
                layout: 'single',
                articles: [{ slug: 'x', title: 'X', description: '' }],
            });

            const outline = parseOutlineResponse(response, theme, probe);
            expect(outline.articles[0].coveredComponentIds).toEqual([]);
            expect(outline.articles[0].coveredFiles).toEqual([]);
            expect(outline.articles[0].isIndex).toBe(false);
        });
    });

    describe('buildFallbackOutline', () => {
        it('should produce single layout for 1-2 modules', () => {
            const theme = makeTheme();
            const probe = makeProbeResult([makeModule()]);

            const outline = buildFallbackOutline(theme, probe);

            expect(outline.themeId).toBe('compaction');
            expect(outline.layout).toBe('single');
            expect(outline.articles).toHaveLength(1);
            expect(outline.articles[0].isIndex).toBe(true);
            expect(outline.articles[0].coveredComponentIds).toEqual(['mod-a']);
        });

        it('should produce single layout for 2 modules', () => {
            const modules = [
                makeModule({ id: 'mod-1', name: 'M1', keyFiles: ['a.ts'] }),
                makeModule({ id: 'mod-2', name: 'M2', keyFiles: ['b.ts'] }),
            ];
            const outline = buildFallbackOutline(makeTheme(), makeProbeResult(modules));

            expect(outline.layout).toBe('single');
            expect(outline.articles).toHaveLength(1);
            expect(outline.articles[0].coveredComponentIds).toEqual(['mod-1', 'mod-2']);
        });

        it('should produce area layout for 3+ modules', () => {
            const modules = Array.from({ length: 4 }, (_, i) =>
                makeModule({ id: `mod-${i}`, name: `Module ${i}`, keyFiles: [`src/${i}.ts`] })
            );

            const outline = buildFallbackOutline(makeTheme(), makeProbeResult(modules));

            expect(outline.layout).toBe('area');
            // index + 4 per-module articles
            expect(outline.articles).toHaveLength(5);
            expect(outline.articles[0].isIndex).toBe(true);
            expect(outline.articles[0].slug).toBe('index');
            expect(outline.articles[1].slug).toBe('mod-0');
            expect(outline.articles[1].isIndex).toBe(false);
        });

        it('should produce area layout for 7+ modules', () => {
            const modules = Array.from({ length: 8 }, (_, i) =>
                makeModule({ id: `mod-${i}`, name: `Module ${i}` })
            );

            const outline = buildFallbackOutline(makeTheme(), makeProbeResult(modules));

            expect(outline.layout).toBe('area');
            expect(outline.articles).toHaveLength(9); // index + 8
        });

        it('should handle zero modules', () => {
            const outline = buildFallbackOutline(makeTheme(), makeProbeResult([]));

            expect(outline.layout).toBe('single');
            expect(outline.articles).toHaveLength(1);
            expect(outline.articles[0].coveredComponentIds).toEqual([]);
        });

        it('should format theme title from kebab-case', () => {
            const theme = makeTheme({ theme: 'log-compaction-engine' });
            const outline = buildFallbackOutline(theme, makeProbeResult([]));

            expect(outline.title).toBe('Log Compaction Engine');
        });

        it('should populate involvedModules', () => {
            const mod = makeModule({ id: 'mod-x', purpose: 'Core compactor' });
            const outline = buildFallbackOutline(makeTheme(), makeProbeResult([mod]));

            expect(outline.involvedComponents).toHaveLength(1);
            expect(outline.involvedComponents[0].componentId).toBe('mod-x');
            expect(outline.involvedComponents[0].role).toBe('Core compactor');
        });
    });

    describe('generateThemeOutline', () => {
        it('should return AI-generated outline on success', async () => {
            mockIsAvailable.mockResolvedValue(true);
            mockSendMessage.mockResolvedValue({
                success: true,
                response: JSON.stringify({
                    title: 'Compaction',
                    layout: 'area',
                    articles: [
                        { slug: 'index', title: 'Overview', description: 'Intro', isIndex: true, coveredComponentIds: ['mod-0'], coveredFiles: [] },
                        { slug: 'details', title: 'Details', description: 'Deep', isIndex: false, coveredComponentIds: ['mod-0'], coveredFiles: ['f.ts'] },
                    ],
                }),
            });

            const opts = makeOptions(1);
            const outline = await generateThemeOutline(opts);

            expect(outline.layout).toBe('area');
            expect(outline.articles).toHaveLength(2);
            expect(mockSendMessage).toHaveBeenCalledOnce();
        });

        it('should fall back when SDK is unavailable', async () => {
            mockIsAvailable.mockResolvedValue(false);

            const opts = makeOptions(4);
            const outline = await generateThemeOutline(opts);

            // Fallback: 4 modules → area layout
            expect(outline.layout).toBe('area');
            expect(mockSendMessage).not.toHaveBeenCalled();
        });

        it('should fall back when AI returns failure', async () => {
            mockIsAvailable.mockResolvedValue(true);
            mockSendMessage.mockResolvedValue({ success: false, error: 'timeout' });

            const opts = makeOptions(1);
            const outline = await generateThemeOutline(opts);

            expect(outline.layout).toBe('single');
            expect(outline.articles).toHaveLength(1);
        });

        it('should fall back when AI returns empty response', async () => {
            mockIsAvailable.mockResolvedValue(true);
            mockSendMessage.mockResolvedValue({ success: true, response: '' });

            const outline = await generateThemeOutline(makeOptions(1));
            expect(outline.layout).toBe('single');
        });

        it('should fall back when sendMessage throws', async () => {
            mockIsAvailable.mockResolvedValue(true);
            mockSendMessage.mockRejectedValue(new Error('network error'));

            const outline = await generateThemeOutline(makeOptions(3));

            expect(outline.layout).toBe('area');
            expect(outline.articles.length).toBeGreaterThan(1);
        });

        it('should pass model and timeout options to SDK', async () => {
            mockIsAvailable.mockResolvedValue(true);
            mockSendMessage.mockResolvedValue({
                success: true,
                response: JSON.stringify({
                    title: 'T', layout: 'single',
                    articles: [{ slug: 'x', title: 'X', description: '', isIndex: true, coveredComponentIds: [], coveredFiles: [] }],
                }),
            });

            await generateThemeOutline(makeOptions(1, { model: 'gpt-4', timeout: 30000 }));

            const call = mockSendMessage.mock.calls[0][0];
            expect(call.model).toBe('gpt-4');
            expect(call.timeoutMs).toBe(30000);
        });

        it('should use default timeout when not specified', async () => {
            mockIsAvailable.mockResolvedValue(true);
            mockSendMessage.mockResolvedValue({
                success: true,
                response: JSON.stringify({
                    title: 'T', layout: 'single',
                    articles: [{ slug: 'x', title: 'X', description: '', isIndex: true, coveredComponentIds: [], coveredFiles: [] }],
                }),
            });

            await generateThemeOutline(makeOptions(1));

            const call = mockSendMessage.mock.calls[0][0];
            expect(call.timeoutMs).toBe(60_000);
        });

        it('should use direct session (usePool: false)', async () => {
            mockIsAvailable.mockResolvedValue(true);
            mockSendMessage.mockResolvedValue({
                success: true,
                response: JSON.stringify({
                    title: 'T', layout: 'single',
                    articles: [{ slug: 'x', title: 'X', description: '', isIndex: true, coveredComponentIds: [], coveredFiles: [] }],
                }),
            });

            await generateThemeOutline(makeOptions(1));

            const call = mockSendMessage.mock.calls[0][0];
            expect(call.usePool).toBe(false);
        });

        it('should handle depth=shallow producing fewer articles via AI', async () => {
            mockIsAvailable.mockResolvedValue(true);
            mockSendMessage.mockResolvedValue({
                success: true,
                response: JSON.stringify({
                    title: 'Compaction',
                    layout: 'single',
                    articles: [{
                        slug: 'index', title: 'Compaction', description: 'All-in-one',
                        isIndex: true, coveredComponentIds: ['mod-0', 'mod-1', 'mod-2'], coveredFiles: [],
                    }],
                }),
            });

            const opts = makeOptions(3, { depth: 'shallow' });
            const outline = await generateThemeOutline(opts);

            expect(outline.articles).toHaveLength(1);
        });

        it('should handle depth=deep producing more articles via AI', async () => {
            mockIsAvailable.mockResolvedValue(true);
            mockSendMessage.mockResolvedValue({
                success: true,
                response: JSON.stringify({
                    title: 'Compaction',
                    layout: 'area',
                    articles: [
                        { slug: 'index', title: 'Overview', description: '', isIndex: true, coveredComponentIds: [], coveredFiles: [] },
                        { slug: 'core', title: 'Core', description: '', isIndex: false, coveredComponentIds: ['mod-0'], coveredFiles: [] },
                        { slug: 'strategies', title: 'Strategies', description: '', isIndex: false, coveredComponentIds: ['mod-1'], coveredFiles: [] },
                        { slug: 'internals', title: 'Internals', description: '', isIndex: false, coveredComponentIds: ['mod-2'], coveredFiles: [] },
                        { slug: 'tuning', title: 'Tuning', description: '', isIndex: false, coveredComponentIds: [], coveredFiles: [] },
                    ],
                }),
            });

            const opts = makeOptions(3, { depth: 'deep' });
            const outline = await generateThemeOutline(opts);

            expect(outline.articles).toHaveLength(5);
        });
    });
});
