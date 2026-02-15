/**
 * Discover Command Tests
 *
 * Tests for the discover command's path validation, header output,
 * and exit code behavior. SDK calls are mocked to avoid timeouts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EXIT_CODES } from '../../src/cli';

// Mock the discovery component to avoid actual SDK calls
vi.mock('../../src/discovery', () => ({
    discoverComponentGraph: vi.fn().mockRejectedValue(new Error('SDK not available in test')),
    runIterativeDiscovery: vi.fn(),
    DiscoveryError: class DiscoveryError extends Error {
        code: string;
        constructor(message: string, code: string) {
            super(message);
            this.name = 'DiscoveryError';
            this.code = code;
        }
    },
}));

// Mock the seeds module
vi.mock('../../src/seeds', () => ({
    generateThemeSeeds: vi.fn(),
    parseSeedFile: vi.fn(),
}));

// Mock the cache module
vi.mock('../../src/cache', () => ({
    getCachedGraph: vi.fn().mockResolvedValue(null),
    getCachedGraphAny: vi.fn().mockReturnValue(null),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getRepoHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getFolderHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getGitRoot: vi.fn().mockResolvedValue('/mock/git/root'),
    saveSeedsCache: vi.fn(),
    getCachedSeeds: vi.fn().mockReturnValue(null),
    getCachedSeedsAny: vi.fn().mockReturnValue(null),
    clearDiscoveryCache: vi.fn().mockReturnValue(false),
    // Probe/area cache functions (used by iterative discovery and large-repo handler)
    saveProbeResult: vi.fn(),
    getCachedProbeResult: vi.fn().mockReturnValue(null),
    scanCachedProbes: vi.fn().mockImplementation(
        (themes: string[]) => ({ found: new Map(), missing: [...themes] })
    ),
    scanCachedProbesAny: vi.fn().mockImplementation(
        (themes: string[]) => ({ found: new Map(), missing: [...themes] })
    ),
    saveStructuralScan: vi.fn(),
    getCachedStructuralScan: vi.fn().mockReturnValue(null),
    getCachedStructuralScanAny: vi.fn().mockReturnValue(null),
    saveDomainSubGraph: vi.fn(),
    getCachedDomainSubGraph: vi.fn().mockReturnValue(null),
    scanCachedDomains: vi.fn().mockImplementation(
        (domainIds: string[]) => ({ found: new Map(), missing: [...domainIds] })
    ),
    scanCachedDomainsAny: vi.fn().mockImplementation(
        (domainIds: string[]) => ({ found: new Map(), missing: [...domainIds] })
    ),
    saveDiscoveryMetadata: vi.fn(),
    getDiscoveryMetadata: vi.fn().mockReturnValue(null),
    getDiscoveryCacheDir: vi.fn().mockReturnValue('/mock/.wiki-cache/discovery'),
}));

let tmpDir: string;
let stderrOutput: string;
let stdoutOutput: string;
const originalStderrWrite = process.stderr.write;
const originalStdoutWrite = process.stdout.write;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-discover-test-'));
    stderrOutput = '';
    stdoutOutput = '';

    process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrOutput += typeof chunk === 'string' ? chunk : chunk.toString();
        return true;
    }) as typeof process.stderr.write;

    process.stdout.write = ((chunk: string | Uint8Array) => {
        stdoutOutput += typeof chunk === 'string' ? chunk : chunk.toString();
        return true;
    }) as typeof process.stdout.write;
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
    vi.restoreAllMocks();
});

describe('Discover Command', () => {
    // ========================================================================
    // Path Validation
    // ========================================================================

    describe('path validation', () => {
        it('should return CONFIG_ERROR for non-existent path', async () => {
            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover('/nonexistent/path/that/doesnt/exist', {
                output: path.join(tmpDir, 'output'),
                force: false,
                useCache: false,
                verbose: false,
            });
            expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
            expect(stderrOutput).toContain('does not exist');
        });

        it('should return CONFIG_ERROR for file path (not directory)', async () => {
            const filePath = path.join(tmpDir, 'not-a-dir.txt');
            fs.writeFileSync(filePath, 'hello', 'utf-8');

            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover(filePath, {
                output: path.join(tmpDir, 'output'),
                force: false,
                useCache: false,
                verbose: false,
            });
            expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
            expect(stderrOutput).toContain('not a directory');
        });
    });

    // ========================================================================
    // Header Output
    // ========================================================================

    describe('header output', () => {
        it('should print header with repository path', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                force: true,
                useCache: false,
                verbose: false,
            });

            expect(stderrOutput).toContain('Discovery Phase');
            expect(stderrOutput).toContain(repoDir);
        });

        it('should print focus in header when specified', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                focus: 'src/',
                force: true,
                useCache: false,
                verbose: false,
            });

            expect(stderrOutput).toContain('src/');
        });

        it('should print model in header when specified', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                model: 'claude-sonnet',
                force: true,
                useCache: false,
                verbose: false,
            });

            expect(stderrOutput).toContain('claude-sonnet');
        });
    });

    // ========================================================================
    // Exit Codes
    // ========================================================================

    describe('exit codes', () => {
        it('should return EXECUTION_ERROR when discovery fails', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                force: true,
                useCache: false,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        });

        it('should return AI_UNAVAILABLE for DiscoveryError with sdk-unavailable code', async () => {
            // Override the mock for this specific test
            const discovery = await import('../../src/discovery');
            const DiscoveryError = discovery.DiscoveryError;
            vi.mocked(discovery.discoverComponentGraph).mockRejectedValueOnce(
                new DiscoveryError('SDK not available', 'sdk-unavailable')
            );

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                force: true,
                useCache: false,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.AI_UNAVAILABLE);
        });

        it('should return EXECUTION_ERROR for timeout error', async () => {
            const discovery = await import('../../src/discovery');
            const DiscoveryError = discovery.DiscoveryError;
            vi.mocked(discovery.discoverComponentGraph).mockRejectedValueOnce(
                new DiscoveryError('Timed out', 'timeout')
            );

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                force: true,
                useCache: false,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        });
    });

    // ========================================================================
    // Successful Discovery (Mocked)
    // ========================================================================

    describe('successful discovery', () => {
        it('should write component-graph.json and return SUCCESS', async () => {
            const discovery = await import('../../src/discovery');
            vi.mocked(discovery.discoverComponentGraph).mockResolvedValueOnce({
                graph: {
                    project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                    components: [
                        { id: 'core', name: 'Core', path: 'src/', purpose: 'Core', keyFiles: [], dependencies: [], dependents: [], complexity: 'medium', category: 'core' },
                    ],
                    categories: [{ name: 'core', description: 'Core' }],
                    architectureNotes: 'Simple',
                },
                duration: 5000,
            });

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);
            const outputDir = path.join(tmpDir, 'output');

            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover(repoDir, {
                output: outputDir,
                force: true,
                useCache: false,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.SUCCESS);

            // Check output file
            const graphFile = path.join(outputDir, 'component-graph.json');
            expect(fs.existsSync(graphFile)).toBe(true);
            const content = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
            expect(content.project.name).toBe('test');
            expect(content.components).toHaveLength(1);
        });

        it('should print summary to stderr', async () => {
            const discovery = await import('../../src/discovery');
            vi.mocked(discovery.discoverComponentGraph).mockResolvedValueOnce({
                graph: {
                    project: { name: 'my-project', description: '', language: 'TypeScript', buildSystem: 'npm', entryPoints: [] },
                    components: [
                        { id: 'mod1', name: 'Mod1', path: 'a/', purpose: '', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' },
                        { id: 'mod2', name: 'Mod2', path: 'b/', purpose: '', keyFiles: [], dependencies: [], dependents: [], complexity: 'high', category: 'core' },
                    ],
                    categories: [{ name: 'core', description: 'Core' }],
                    architectureNotes: '',
                },
                duration: 12345,
            });

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                force: true,
                useCache: false,
                verbose: false,
            });

            expect(stderrOutput).toContain('my-project');
            expect(stderrOutput).toContain('TypeScript');
            expect(stderrOutput).toContain('2'); // 2 components
        });

        it('should output JSON to stdout', async () => {
            const discovery = await import('../../src/discovery');
            vi.mocked(discovery.discoverComponentGraph).mockResolvedValueOnce({
                graph: {
                    project: { name: 'stdout-test', description: '', language: 'JS', buildSystem: 'npm', entryPoints: [] },
                    components: [],
                    categories: [],
                    architectureNotes: '',
                },
                duration: 100,
            });

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                force: true,
                useCache: false,
                verbose: false,
            });

            const parsed = JSON.parse(stdoutOutput.trim());
            expect(parsed.project.name).toBe('stdout-test');
        });

        it('should print verbose component list when verbose is true', async () => {
            const discovery = await import('../../src/discovery');
            vi.mocked(discovery.discoverComponentGraph).mockResolvedValueOnce({
                graph: {
                    project: { name: 'verbose-test', description: '', language: 'Go', buildSystem: 'go mod', entryPoints: [] },
                    components: [
                        { id: 'auth', name: 'Auth', path: 'pkg/auth/', purpose: 'Authentication', keyFiles: [], dependencies: [], dependents: [], complexity: 'high', category: 'core' },
                    ],
                    categories: [{ name: 'core', description: '' }],
                    architectureNotes: '',
                },
                duration: 3000,
            });

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                force: true,
                useCache: false,
                verbose: true,
            });

            expect(stderrOutput).toContain('auth');
            expect(stderrOutput).toContain('Authentication');
        });
    });

    // ========================================================================
    // Cache Integration
    // ========================================================================

    describe('cache integration', () => {
        it('should use cached graph when available and force is false', async () => {
            const cache = await import('../../src/cache');
            vi.mocked(cache.getCachedGraph).mockResolvedValueOnce({
                metadata: { gitHash: 'abc', timestamp: Date.now(), version: '1.0.0' },
                graph: {
                    project: { name: 'cached-project', description: '', language: 'Rust', buildSystem: 'cargo', entryPoints: [] },
                    components: [
                        { id: 'cached-mod', name: 'Cached', path: 'src/', purpose: 'cached', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' },
                    ],
                    categories: [{ name: 'core', description: '' }],
                    architectureNotes: '',
                },
            });

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                force: false,
                useCache: false,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('cached');

            // Should output the cached graph
            const parsed = JSON.parse(stdoutOutput.trim());
            expect(parsed.project.name).toBe('cached-project');
        });

        it('--use-cache should use getCachedGraphAny (skip hash validation)', async () => {
            const cache = await import('../../src/cache');
            vi.mocked(cache.getCachedGraphAny).mockReturnValue({
                metadata: { gitHash: 'stale-hash', timestamp: Date.now(), version: '1.0.0' },
                graph: {
                    project: { name: 'stale-cached', description: '', language: 'Go', buildSystem: 'go mod', entryPoints: [] },
                    components: [
                        { id: 'stale-mod', name: 'Stale', path: 'src/', purpose: 'stale', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' },
                    ],
                    categories: [{ name: 'core', description: '' }],
                    architectureNotes: '',
                },
            });

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover(repoDir, {
                output: path.join(tmpDir, 'output'),
                force: false,
                useCache: true,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.SUCCESS);

            // Should output the stale cached graph
            const parsed = JSON.parse(stdoutOutput.trim());
            expect(parsed.project.name).toBe('stale-cached');
        });
    });

    // ========================================================================
    // Seeds Option (Iterative Discovery)
    // ========================================================================

    describe('--seeds option', () => {
        it('should trigger seed generation then iterative discovery when --seeds auto', async () => {
            const discovery = await import('../../src/discovery');
            const seeds = await import('../../src/seeds');

            const mockSeeds = [
                { theme: 'auth', description: 'Auth', hints: ['auth'] },
                { theme: 'db', description: 'DB', hints: ['db'] },
            ];

            vi.mocked(seeds.generateThemeSeeds).mockResolvedValueOnce(mockSeeds);

            const mockGraph = {
                project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                components: [
                    { id: 'auth-service', name: 'Auth Service', path: 'src/auth/', purpose: 'Auth', keyFiles: [], dependencies: [], dependents: [], complexity: 'medium', category: 'core' },
                ],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: 'Iterative discovery',
            };

            vi.mocked(discovery.runIterativeDiscovery).mockResolvedValueOnce(mockGraph);

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);
            const outputDir = path.join(tmpDir, 'output');

            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover(repoDir, {
                output: outputDir,
                force: true,
                useCache: false,
                verbose: false,
                seeds: 'auto',
            });

            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(vi.mocked(seeds.generateThemeSeeds)).toHaveBeenCalledOnce();
            expect(vi.mocked(discovery.runIterativeDiscovery)).toHaveBeenCalledOnce();
            expect(vi.mocked(discovery.discoverComponentGraph)).not.toHaveBeenCalled();
        });

        it('should parse seed file and run iterative discovery when --seeds with file path', async () => {
            const discovery = await import('../../src/discovery');
            const seeds = await import('../../src/seeds');

            const seedFile = path.join(tmpDir, 'seeds.json');
            fs.writeFileSync(seedFile, JSON.stringify({
                themes: [
                    { theme: 'auth', description: 'Auth', hints: ['auth'] },
                ],
            }), 'utf-8');

            const mockSeeds = [
                { theme: 'auth', description: 'Auth', hints: ['auth'] },
            ];

            vi.mocked(seeds.parseSeedFile).mockReturnValueOnce(mockSeeds);

            const mockGraph = {
                project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                components: [],
                categories: [],
                architectureNotes: '',
            };

            vi.mocked(discovery.runIterativeDiscovery).mockResolvedValueOnce(mockGraph);

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);
            const outputDir = path.join(tmpDir, 'output');

            const { executeDiscover } = await import('../../src/commands/discover');
            const exitCode = await executeDiscover(repoDir, {
                output: outputDir,
                force: true,
                useCache: false,
                verbose: false,
                seeds: seedFile,
            });

            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(vi.mocked(seeds.parseSeedFile)).toHaveBeenCalledWith(seedFile);
            expect(vi.mocked(discovery.runIterativeDiscovery)).toHaveBeenCalledOnce();
            expect(vi.mocked(discovery.discoverComponentGraph)).not.toHaveBeenCalled();
        });
    });
});
