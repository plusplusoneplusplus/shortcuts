/**
 * Seeds Command Tests
 *
 * Tests for the seeds command's path validation, header output,
 * and exit code behavior. SDK calls are mocked to avoid timeouts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EXIT_CODES } from '../../src/cli';

// Mock the seeds module to avoid actual SDK calls
const mockSeeds = [
    {
        theme: 'authentication',
        description: 'User authentication and authorization',
        hints: ['auth', 'login'],
    },
    {
        theme: 'database',
        description: 'Database layer',
        hints: ['db', 'sql'],
    },
];

vi.mock('../../src/seeds', () => ({
    generateThemeSeeds: vi.fn().mockResolvedValue(mockSeeds),
    SeedsError: class SeedsError extends Error {
        code: string;
        constructor(message: string, code: string) {
            super(message);
            this.name = 'SeedsError';
            this.code = code;
        }
    },
}));

let tmpDir: string;
let stderrOutput: string;
let stdoutOutput: string;
const originalStderrWrite = process.stderr.write;
const originalStdoutWrite = process.stdout.write;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-seeds-test-'));
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

    // Reset mock to default return value
    const seeds = await import('../../src/seeds');
    vi.mocked(seeds.generateThemeSeeds).mockResolvedValue(mockSeeds);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
    vi.clearAllMocks();
});

describe('Seeds Command', () => {
    // ========================================================================
    // Path Validation
    // ========================================================================

    describe('path validation', () => {
        it('should return CONFIG_ERROR for non-existent path', async () => {
            const { executeSeeds } = await import('../../src/commands/seeds');
            const exitCode = await executeSeeds('/nonexistent/path/that/doesnt/exist', {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
                verbose: false,
            });
            expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
            expect(stderrOutput).toContain('does not exist');
        });

        it('should return CONFIG_ERROR for file path (not directory)', async () => {
            const filePath = path.join(tmpDir, 'not-a-dir.txt');
            fs.writeFileSync(filePath, 'hello', 'utf-8');

            const { executeSeeds } = await import('../../src/commands/seeds');
            const exitCode = await executeSeeds(filePath, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
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

            const { executeSeeds } = await import('../../src/commands/seeds');
            await executeSeeds(repoDir, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
                verbose: false,
            });

            expect(stderrOutput).toContain('Seeds Generation');
            expect(stderrOutput).toContain(repoDir);
        });

        it('should print output file in header', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);
            const outputFile = path.join(tmpDir, 'custom-seeds.json');

            const { executeSeeds } = await import('../../src/commands/seeds');
            await executeSeeds(repoDir, {
                output: outputFile,
                maxThemes: 50,
                verbose: false,
            });

            expect(stderrOutput).toContain('custom-seeds.json');
        });

        it('should print max themes in header', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeSeeds } = await import('../../src/commands/seeds');
            await executeSeeds(repoDir, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 30,
                verbose: false,
            });

            expect(stderrOutput).toContain('30');
        });

        it('should print model in header when specified', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeSeeds } = await import('../../src/commands/seeds');
            await executeSeeds(repoDir, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
                model: 'claude-sonnet',
                verbose: false,
            });

            expect(stderrOutput).toContain('claude-sonnet');
        });
    });

    // ========================================================================
    // Exit Codes
    // ========================================================================

    describe('exit codes', () => {
        it('should return EXECUTION_ERROR when seeds generation fails', async () => {
            const seeds = await import('../../src/seeds');
            const SeedsError = seeds.SeedsError;
            vi.mocked(seeds.generateThemeSeeds).mockRejectedValueOnce(
                new SeedsError('Generation failed', 'ai-error')
            );

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeSeeds } = await import('../../src/commands/seeds');
            const exitCode = await executeSeeds(repoDir, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        });

        it('should return AI_UNAVAILABLE for SeedsError with sdk-unavailable code', async () => {
            const seeds = await import('../../src/seeds');
            const SeedsError = seeds.SeedsError;
            vi.mocked(seeds.generateThemeSeeds).mockRejectedValueOnce(
                new SeedsError('SDK not available', 'sdk-unavailable')
            );

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeSeeds } = await import('../../src/commands/seeds');
            const exitCode = await executeSeeds(repoDir, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.AI_UNAVAILABLE);
        });

        it('should return EXECUTION_ERROR for timeout error', async () => {
            const seeds = await import('../../src/seeds');
            const SeedsError = seeds.SeedsError;
            vi.mocked(seeds.generateThemeSeeds).mockRejectedValueOnce(
                new SeedsError('Timed out', 'timeout')
            );

            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeSeeds } = await import('../../src/commands/seeds');
            const exitCode = await executeSeeds(repoDir, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        });
    });

    // ========================================================================
    // Successful Seeds Generation
    // ========================================================================

    describe('successful seeds generation', () => {
        it('should write seeds.json and return SUCCESS', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);
            const outputFile = path.join(tmpDir, 'seeds.json');

            const { executeSeeds } = await import('../../src/commands/seeds');
            const exitCode = await executeSeeds(repoDir, {
                output: outputFile,
                maxThemes: 50,
                verbose: false,
            });

            expect(exitCode).toBe(EXIT_CODES.SUCCESS);

            // Check output file
            expect(fs.existsSync(outputFile)).toBe(true);
            const content = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
            expect(content.themes).toHaveLength(2);
            expect(content.themes[0].theme).toBe('authentication');
            expect(content.version).toBe('1.0.0');
            expect(content.repoPath).toBe(repoDir);
        });

        it('should print summary to stderr', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeSeeds } = await import('../../src/commands/seeds');
            await executeSeeds(repoDir, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
                verbose: false,
            });

            expect(stderrOutput).toContain('Themes Found');
            expect(stderrOutput).toContain('2');
        });

        it('should print theme list to stderr', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeSeeds } = await import('../../src/commands/seeds');
            await executeSeeds(repoDir, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
                verbose: false,
            });

            expect(stderrOutput).toContain('authentication');
            expect(stderrOutput).toContain('database');
        });

        it('should print verbose theme details when verbose is true', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);

            const { executeSeeds } = await import('../../src/commands/seeds');
            await executeSeeds(repoDir, {
                output: path.join(tmpDir, 'seeds.json'),
                maxThemes: 50,
                verbose: true,
            });

            expect(stderrOutput).toContain('User authentication and authorization');
            expect(stderrOutput).toContain('Database layer');
        });

        it('should create output directory if it does not exist', async () => {
            const repoDir = path.join(tmpDir, 'repo');
            fs.mkdirSync(repoDir);
            const outputDir = path.join(tmpDir, 'output', 'subdir');
            const outputFile = path.join(outputDir, 'seeds.json');

            const { executeSeeds } = await import('../../src/commands/seeds');
            await executeSeeds(repoDir, {
                output: outputFile,
                maxThemes: 50,
                verbose: false,
            });

            expect(fs.existsSync(outputFile)).toBe(true);
        });
    });
});
