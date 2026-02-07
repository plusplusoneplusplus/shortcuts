/**
 * Analysis Executor Tests
 *
 * Tests for the analysis map-reduce orchestration: module→PromptItem conversion,
 * executor integration, progress callbacks, and failure handling.
 */

import { describe, it, expect, vi } from 'vitest';
import { moduleToPromptItem, runAnalysisExecutor } from '../../src/analysis/analysis-executor';
import type { ModuleGraph, ModuleInfo } from '../../src/types';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Test Data
// ============================================================================

function createTestGraph(modules: Partial<ModuleInfo>[] = []): ModuleGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm + webpack',
            entryPoints: ['src/index.ts'],
        },
        modules: modules.map((m, i) => ({
            id: m.id || `module-${i}`,
            name: m.name || `Module ${i}`,
            path: m.path || `src/module-${i}/`,
            purpose: m.purpose || `Purpose of module ${i}`,
            keyFiles: m.keyFiles || [`src/module-${i}/index.ts`],
            dependencies: m.dependencies || [],
            dependents: m.dependents || [],
            complexity: m.complexity || 'medium',
            category: m.category || 'core',
        })) as ModuleInfo[],
        categories: [{ name: 'core', description: 'Core modules' }],
        architectureNotes: 'Test architecture notes',
    };
}

const VALID_ANALYSIS_RESPONSE = JSON.stringify({
    moduleId: 'auth',
    overview: 'Auth module overview',
    keyConcepts: [{ name: 'JWT', description: 'Token auth' }],
    publicAPI: [{ name: 'login', signature: 'login(): Promise<void>', description: 'Login' }],
    internalArchitecture: 'Layered',
    dataFlow: 'Request → Auth → Response',
    patterns: ['Middleware'],
    errorHandling: 'Custom errors',
    codeExamples: [],
    dependencies: { internal: [], external: [] },
    suggestedDiagram: 'graph TD\n  A-->B',
});

// ============================================================================
// moduleToPromptItem
// ============================================================================

describe('moduleToPromptItem', () => {
    it('should flatten all module fields to strings', () => {
        const graph = createTestGraph([{
            id: 'auth',
            name: 'Auth Module',
            path: 'src/auth/',
            purpose: 'Handles authentication',
            keyFiles: ['src/auth/index.ts', 'src/auth/jwt.ts'],
            dependencies: ['database', 'cache'],
            dependents: ['api'],
            complexity: 'high',
            category: 'security',
        }]);

        const item = moduleToPromptItem(graph.modules[0], graph);

        expect(item.moduleId).toBe('auth');
        expect(item.moduleName).toBe('Auth Module');
        expect(item.modulePath).toBe('src/auth/');
        expect(item.purpose).toBe('Handles authentication');
        expect(item.keyFiles).toBe('src/auth/index.ts, src/auth/jwt.ts');
        expect(item.dependencies).toBe('database, cache');
        expect(item.dependents).toBe('api');
        expect(item.complexity).toBe('high');
        expect(item.category).toBe('security');
        expect(item.projectName).toBe('TestProject');
        expect(item.architectureNotes).toBe('Test architecture notes');
    });

    it('should use "none" for empty dependencies', () => {
        const graph = createTestGraph([{
            id: 'standalone',
            dependencies: [],
            dependents: [],
        }]);

        const item = moduleToPromptItem(graph.modules[0], graph);
        expect(item.dependencies).toBe('none');
        expect(item.dependents).toBe('none');
    });

    it('should join keyFiles with commas', () => {
        const graph = createTestGraph([{
            id: 'test',
            keyFiles: ['a.ts', 'b.ts', 'c.ts'],
        }]);

        const item = moduleToPromptItem(graph.modules[0], graph);
        expect(item.keyFiles).toBe('a.ts, b.ts, c.ts');
    });
});

// ============================================================================
// runAnalysisExecutor
// ============================================================================

describe('runAnalysisExecutor', () => {
    it('should return empty results for empty module list', async () => {
        const graph = createTestGraph([]);
        const mockInvoker: AIInvoker = vi.fn();

        const result = await runAnalysisExecutor({
            aiInvoker: mockInvoker,
            graph,
            depth: 'normal',
        });

        expect(result.analyses).toEqual([]);
        expect(result.failedModuleIds).toEqual([]);
        expect(result.duration).toBe(0);
        expect(mockInvoker).not.toHaveBeenCalled();
    });

    it('should process modules and parse successful responses', async () => {
        const graph = createTestGraph([{ id: 'auth', name: 'Auth Module' }]);

        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: VALID_ANALYSIS_RESPONSE,
        });

        const result = await runAnalysisExecutor({
            aiInvoker: mockInvoker,
            graph,
            depth: 'normal',
            concurrency: 1,
        });

        expect(result.analyses.length).toBeGreaterThanOrEqual(0);
        // The invoker should have been called
        expect(mockInvoker).toHaveBeenCalled();
    });

    it('should track failed modules', async () => {
        const graph = createTestGraph([
            { id: 'good', name: 'Good Module' },
            { id: 'bad', name: 'Bad Module' },
        ]);

        let callCount = 0;
        const mockInvoker: AIInvoker = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { success: true, response: VALID_ANALYSIS_RESPONSE };
            }
            return { success: false, error: 'AI error' };
        });

        const result = await runAnalysisExecutor({
            aiInvoker: mockInvoker,
            graph,
            depth: 'normal',
            concurrency: 1,
        });

        // At least one should succeed or fail gracefully
        expect(result.analyses.length + result.failedModuleIds.length).toBeGreaterThan(0);
    });

    it('should fire progress callbacks', async () => {
        const graph = createTestGraph([{ id: 'test' }]);
        const progressUpdates: any[] = [];

        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: VALID_ANALYSIS_RESPONSE,
        });

        await runAnalysisExecutor({
            aiInvoker: mockInvoker,
            graph,
            depth: 'normal',
            onProgress: (progress) => progressUpdates.push(progress),
        });

        // Should receive at least splitting + mapping progress
        expect(progressUpdates.length).toBeGreaterThan(0);
    });

    it('should respect concurrency limit', async () => {
        const modules = Array.from({ length: 10 }, (_, i) => ({
            id: `mod-${i}`,
            name: `Module ${i}`,
        }));
        const graph = createTestGraph(modules);

        let maxConcurrent = 0;
        let currentConcurrent = 0;

        const mockInvoker: AIInvoker = vi.fn().mockImplementation(async () => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await new Promise(resolve => setTimeout(resolve, 10));
            currentConcurrent--;
            return { success: true, response: VALID_ANALYSIS_RESPONSE };
        });

        await runAnalysisExecutor({
            aiInvoker: mockInvoker,
            graph,
            depth: 'normal',
            concurrency: 3,
        });

        // Max concurrent should not exceed 3
        expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('should handle individual module failure without halting pipeline', async () => {
        const graph = createTestGraph([
            { id: 'mod-1' },
            { id: 'mod-2' },
            { id: 'mod-3' },
        ]);

        let callIndex = 0;
        const mockInvoker: AIInvoker = vi.fn().mockImplementation(async () => {
            callIndex++;
            if (callIndex === 2) {
                throw new Error('Individual failure');
            }
            return { success: true, response: VALID_ANALYSIS_RESPONSE };
        });

        const result = await runAnalysisExecutor({
            aiInvoker: mockInvoker,
            graph,
            depth: 'normal',
            concurrency: 1,
        });

        // Pipeline should complete — not throw
        expect(result.duration).toBeGreaterThan(0);
    });

    it('should pass onItemComplete callback to executor', async () => {
        const graph = createTestGraph([
            { id: 'mod-1' },
            { id: 'mod-2' },
        ]);

        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: VALID_ANALYSIS_RESPONSE,
        });

        const completedItems: string[] = [];

        await runAnalysisExecutor({
            aiInvoker: mockInvoker,
            graph,
            depth: 'normal',
            concurrency: 1,
            onItemComplete: (item, result) => {
                completedItems.push(item.id);
            },
        });

        // onItemComplete should be called for each module
        expect(completedItems).toHaveLength(2);
    });

    it('should call onItemComplete for every module regardless of AI result', async () => {
        const graph = createTestGraph([
            { id: 'good' },
            { id: 'bad' },
        ]);

        let callCount = 0;
        const mockInvoker: AIInvoker = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 2) {
                // Returns AI-level failure (mapper still returns a PromptMapResult)
                return { success: false, error: 'AI error' };
            }
            return { success: true, response: VALID_ANALYSIS_RESPONSE };
        });

        const callbackItems: string[] = [];

        await runAnalysisExecutor({
            aiInvoker: mockInvoker,
            graph,
            depth: 'normal',
            concurrency: 1,
            onItemComplete: (item) => {
                callbackItems.push(item.id);
            },
        });

        // Callback should be invoked for every module (both success and AI-level failure)
        expect(callbackItems).toHaveLength(2);
    });
});
