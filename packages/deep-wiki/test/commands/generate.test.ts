/**
 * Generate Command Tests
 *
 * Tests for the full three-phase generate command orchestration:
 * Phase 1→2→3 flow, --phase skipping, --force bypass, and error handling.
 *
 * Uses extensive mocking since the actual AI calls are integration-tested separately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Mocks
// ============================================================================

// Mock AI invoker
vi.mock('../../src/ai-invoker', () => ({
    checkAIAvailability: vi.fn().mockResolvedValue({ available: true }),
    createAnalysisInvoker: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({
        success: true,
        response: JSON.stringify({
            moduleId: 'test-module',
            overview: 'Test overview',
            keyConcepts: [],
            publicAPI: [],
            internalArchitecture: '',
            dataFlow: '',
            patterns: [],
            errorHandling: '',
            codeExamples: [],
            dependencies: { internal: [], external: [] },
            suggestedDiagram: '',
        }),
    })),
    createWritingInvoker: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({
        success: true,
        response: '# Test Article\n\nContent here.',
    })),
}));

// Mock discovery
vi.mock('../../src/discovery', () => ({
    discoverModuleGraph: vi.fn().mockResolvedValue({
        graph: {
            project: {
                name: 'TestProject',
                description: 'Test',
                language: 'TypeScript',
                buildSystem: 'npm',
                entryPoints: ['src/index.ts'],
            },
            modules: [{
                id: 'test-module',
                name: 'Test Module',
                path: 'src/test/',
                purpose: 'Testing',
                keyFiles: ['src/test/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'medium',
                category: 'core',
            }],
            categories: [{ name: 'core', description: 'Core' }],
            architectureNotes: 'Test notes',
        },
        duration: 1000,
    }),
}));

// Mock cache
vi.mock('../../src/cache', () => ({
    getCachedGraph: vi.fn().mockResolvedValue(null),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getCachedAnalyses: vi.fn().mockReturnValue(null),
    saveAllAnalyses: vi.fn().mockResolvedValue(undefined),
    getModulesNeedingReanalysis: vi.fn().mockResolvedValue(null),
    getCachedAnalysis: vi.fn().mockReturnValue(null),
    getAnalysesCacheMetadata: vi.fn().mockReturnValue(null),
}));

// Suppress logger output during tests
vi.mock('../../src/logger', () => ({
    Spinner: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        update: vi.fn(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        warn: vi.fn(),
    })),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printInfo: vi.fn(),
    printHeader: vi.fn(),
    printKeyValue: vi.fn(),
    bold: (s: string) => s,
    green: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    gray: (s: string) => s,
}));

import { executeGenerate } from '../../src/commands/generate';
import { EXIT_CODES } from '../../src/cli';
import { checkAIAvailability } from '../../src/ai-invoker';
import { getCachedGraph, getCachedAnalyses } from '../../src/cache';
import { discoverModuleGraph } from '../../src/discovery';
import { printError } from '../../src/logger';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let repoDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-gen-test-'));
    repoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    vi.clearAllMocks();

    // Re-set default mocks
    vi.mocked(checkAIAvailability).mockResolvedValue({ available: true });
    vi.mocked(getCachedGraph).mockResolvedValue(null);
    vi.mocked(getCachedAnalyses).mockReturnValue(null);
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function defaultOptions(overrides: Record<string, any> = {}) {
    return {
        output: path.join(tempDir, 'wiki'),
        depth: 'normal' as const,
        force: false,
        verbose: false,
        ...overrides,
    };
}

// ============================================================================
// Basic Validation
// ============================================================================

describe('executeGenerate — validation', () => {
    it('should fail for non-existent repo path', async () => {
        const exitCode = await executeGenerate('/nonexistent/path', defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('should fail for file (not directory) repo path', async () => {
        const filePath = path.join(tempDir, 'file.txt');
        fs.writeFileSync(filePath, 'content');

        const exitCode = await executeGenerate(filePath, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('should fail for invalid --phase value', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 5 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('should fail when AI is unavailable', async () => {
        vi.mocked(checkAIAvailability).mockResolvedValue({
            available: false,
            reason: 'Not signed in',
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.AI_UNAVAILABLE);
    });
});

// ============================================================================
// Full Pipeline
// ============================================================================

describe('executeGenerate — full pipeline', () => {
    it('should run all three phases and return SUCCESS', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
    });

    it('should call discoverModuleGraph for Phase 1', async () => {
        await executeGenerate(repoDir, defaultOptions());
        expect(discoverModuleGraph).toHaveBeenCalled();
    });
});

// ============================================================================
// --phase option
// ============================================================================

describe('executeGenerate — --phase option', () => {
    it('--phase 2 should skip discovery and use cached graph', async () => {
        // Set up cached graph
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: {
                gitHash: 'abc123',
                timestamp: Date.now(),
                version: '1.0.0',
            },
            graph: {
                project: {
                    name: 'Cached',
                    description: 'Cached',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                modules: [{
                    id: 'cached-mod',
                    name: 'Cached Module',
                    path: 'src/cached/',
                    purpose: 'Cached',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'low',
                    category: 'core',
                }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: '',
            },
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 2 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(discoverModuleGraph).not.toHaveBeenCalled();
    });

    it('--phase 2 should error when no cached graph exists', async () => {
        vi.mocked(getCachedGraph).mockResolvedValue(null);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 2 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('--phase 3 should error when no cached analyses exist', async () => {
        // Set up cached graph but no analyses
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: { gitHash: 'abc', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: { name: 'T', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                modules: [],
                categories: [],
                architectureNotes: '',
            },
        });
        vi.mocked(getCachedAnalyses).mockReturnValue(null);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 3 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });
});

// ============================================================================
// --force option
// ============================================================================

describe('executeGenerate — --force option', () => {
    it('--force should bypass cache for Phase 1', async () => {
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: { gitHash: 'abc', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: { name: 'Cached', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                modules: [],
                categories: [],
                architectureNotes: '',
            },
        });

        await executeGenerate(repoDir, defaultOptions({ force: true }));

        // Should still call discover even though cache exists
        expect(discoverModuleGraph).toHaveBeenCalled();
    });
});
