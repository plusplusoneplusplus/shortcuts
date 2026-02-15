/**
 * Discovery Logging Tests
 *
 * Tests that the discovery phase emits informative log messages
 * at each key step: SDK check, prompt building, AI invocation,
 * response parsing, and iterative round progress.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pipeline-core SDK
vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: vi.fn(() => ({
            isAvailable: vi.fn().mockResolvedValue(true),
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({
                    project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                    components: [
                        { id: 'mod-a', name: 'ModA', path: 'src/a', purpose: 'A', keyFiles: ['a.ts'], dependencies: [], dependents: [], complexity: 'low', category: 'core' },
                    ],
                    categories: [{ name: 'core', description: 'Core modules' }],
                    architectureNotes: '',
                }),
            }),
        })),
    };
});

// Mock logger to capture calls
vi.mock('../../src/logger', () => ({
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printHeader: vi.fn(),
    printKeyValue: vi.fn(),
    gray: (s: string) => s,
    cyan: (s: string) => s,
    bold: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    Spinner: vi.fn(() => ({
        start: vi.fn(),
        update: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        warn: vi.fn(),
        stop: vi.fn(),
    })),
}));

import { printInfo, printWarning } from '../../src/logger';

describe('Discovery Phase Logging', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('runDiscoverySession', () => {
        it('should log SDK availability check', async () => {
            const { runDiscoverySession } = await import('../../src/discovery/discovery-session');
            await runDiscoverySession({ repoPath: '/test/repo' });

            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Checking Copilot SDK availability')
            );
        });

        it('should log prompt building step', async () => {
            const { runDiscoverySession } = await import('../../src/discovery/discovery-session');
            await runDiscoverySession({ repoPath: '/test/repo' });

            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Building discovery prompt')
            );
        });

        it('should log prompt building with focus when specified', async () => {
            const { runDiscoverySession } = await import('../../src/discovery/discovery-session');
            await runDiscoverySession({ repoPath: '/test/repo', focus: 'src/auth' });

            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('focus: src/auth')
            );
        });

        it('should log AI invocation with timeout info', async () => {
            const { runDiscoverySession } = await import('../../src/discovery/discovery-session');
            await runDiscoverySession({ repoPath: '/test/repo' });

            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Sending discovery prompt to AI')
            );
        });

        it('should log response parsing and result count', async () => {
            const { runDiscoverySession } = await import('../../src/discovery/discovery-session');
            await runDiscoverySession({ repoPath: '/test/repo' });

            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Parsing AI response')
            );
            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('1 components')
            );
        });

        it('should warn on parse failure before retry', async () => {
            const { getCopilotSDKService } = await import('@plusplusoneplusplus/pipeline-core');

            // Override the mock to return invalid JSON first, then valid JSON
            const mockSendMessage = vi.fn()
                .mockResolvedValueOnce({ success: true, response: 'not valid json here' })
                .mockResolvedValueOnce({
                    success: true,
                    response: JSON.stringify({
                        project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                        components: [],
                        categories: [],
                        architectureNotes: '',
                    }),
                });

            vi.mocked(getCopilotSDKService).mockReturnValue({
                isAvailable: vi.fn().mockResolvedValue(true),
                sendMessage: mockSendMessage,
            } as any);

            const { runDiscoverySession } = await import('../../src/discovery/discovery-session');
            await runDiscoverySession({ repoPath: '/test/repo' });

            expect(printWarning).toHaveBeenCalledWith(
                expect.stringContaining('Retrying with stricter prompt')
            );
        });
    });

    describe('discoverComponentGraph', () => {
        it('should log standard-size repo detection', async () => {
            // estimateFileCount uses the SDK mock, returns a small number
            const { getCopilotSDKService } = await import('@plusplusoneplusplus/pipeline-core');
            const service = getCopilotSDKService();
            // File count response, then discovery response
            vi.mocked(service.sendMessage)
                .mockResolvedValueOnce({ success: true, response: '100' })
                .mockResolvedValueOnce({
                    success: true,
                    response: JSON.stringify({
                        project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                        components: [],
                        categories: [],
                        architectureNotes: '',
                    }),
                });

            const { discoverComponentGraph } = await import('../../src/discovery/index');
            await discoverComponentGraph({ repoPath: '/test/repo' });

            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Standard-size repo')
            );
        });
    });

    describe('iterative discovery logging', () => {
        it('should log round progress with theme count', async () => {
            // Mock probe and merge at the component level
            const probeModule = await import('../../src/discovery/iterative/probe-session');
            const mergeModule = await import('../../src/discovery/iterative/merge-session');

            vi.spyOn(probeModule, 'runThemeProbe').mockResolvedValue({
                theme: 'auth',
                foundComponents: [{ id: 'auth-mod', name: 'Auth', path: 'src/auth', purpose: 'Auth', keyFiles: [], dependencies: [], dependents: [], complexity: 'low' as const, category: 'core' }],
                discoveredThemes: [],
                dependencies: [],
                confidence: 0.9,
            });

            vi.spyOn(mergeModule, 'mergeProbeResults').mockResolvedValue({
                graph: {
                    project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                    components: [{ id: 'auth-mod', name: 'Auth', path: 'src/auth', purpose: 'Auth', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' }],
                    categories: [],
                    architectureNotes: '',
                },
                newThemes: [],
                converged: true,
                coverage: 0.9,
                reason: 'High coverage',
            });

            const { runIterativeDiscovery } = await import('../../src/discovery/iterative/iterative-discovery');
            await runIterativeDiscovery({
                repoPath: '/test/repo',
                seeds: [{ theme: 'auth', description: 'Auth', hints: ['auth'] }],
                maxRounds: 3,
                concurrency: 5,
            });

            // Should log round number
            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Round 1/3')
            );

            // Should log probe results
            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Probes completed')
            );

            // Should log merge results
            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Merged graph')
            );

            // Should log convergence
            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Converged')
            );
        });

        it('should log coverage threshold when reached', async () => {
            const probeModule = await import('../../src/discovery/iterative/probe-session');
            const mergeModule = await import('../../src/discovery/iterative/merge-session');

            vi.spyOn(probeModule, 'runThemeProbe').mockResolvedValue({
                theme: 'auth',
                foundComponents: [],
                discoveredThemes: [],
                dependencies: [],
                confidence: 0.8,
            });

            vi.spyOn(mergeModule, 'mergeProbeResults').mockResolvedValue({
                graph: {
                    project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                    components: [],
                    categories: [],
                    architectureNotes: '',
                },
                newThemes: [],
                converged: false,
                coverage: 0.85,
                reason: '',
            });

            const { runIterativeDiscovery } = await import('../../src/discovery/iterative/iterative-discovery');
            await runIterativeDiscovery({
                repoPath: '/test/repo',
                seeds: [{ theme: 'auth', description: 'Auth', hints: [] }],
                coverageThreshold: 0.8,
            });

            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Coverage threshold reached')
            );
        });

        it('should log new themes discovered between rounds', async () => {
            const probeModule = await import('../../src/discovery/iterative/probe-session');
            const mergeModule = await import('../../src/discovery/iterative/merge-session');

            vi.spyOn(probeModule, 'runThemeProbe').mockResolvedValue({
                theme: 'auth',
                foundComponents: [],
                discoveredThemes: [],
                dependencies: [],
                confidence: 0.7,
            });

            vi.spyOn(mergeModule, 'mergeProbeResults')
                .mockResolvedValueOnce({
                    graph: {
                        project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                        components: [],
                        categories: [],
                        architectureNotes: '',
                    },
                    newThemes: [{ theme: 'database', description: 'DB layer', hints: ['db'] }],
                    converged: false,
                    coverage: 0.4,
                    reason: '',
                })
                .mockResolvedValueOnce({
                    graph: {
                        project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                        components: [],
                        categories: [],
                        architectureNotes: '',
                    },
                    newThemes: [],
                    converged: true,
                    coverage: 0.9,
                    reason: 'Done',
                });

            const { runIterativeDiscovery } = await import('../../src/discovery/iterative/iterative-discovery');
            await runIterativeDiscovery({
                repoPath: '/test/repo',
                seeds: [{ theme: 'auth', description: 'Auth', hints: [] }],
                maxRounds: 3,
            });

            expect(printInfo).toHaveBeenCalledWith(
                expect.stringContaining('Discovered 1 new themes')
            );
        });
    });
});
