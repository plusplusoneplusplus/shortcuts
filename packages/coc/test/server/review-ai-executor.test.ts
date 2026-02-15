/**
 * Review AI Executor Tests
 *
 * Unit tests for the prompt builder, AI executor, and task executor factory.
 * Mocks CopilotSDKService to avoid real AI calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    buildClarificationPrompt,
    executeAIClarification,
    createReviewTaskExecutor,
} from '../../src/server/review-ai-executor';
import type { ReviewAIClarificationRequest } from '../../src/server/review-ai-executor';

// ============================================================================
// Mock SDK Service
// ============================================================================

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => ({
            isAvailable: mockIsAvailable,
            sendMessage: mockSendMessage,
        }),
        approveAllPermissions: () => ({ kind: 'approved' }),
    };
});

// ============================================================================
// Mock Store
// ============================================================================

function createMockStore() {
    const processes = new Map<string, any>();
    return {
        addProcess: vi.fn(async (p: any) => { processes.set(p.id, { ...p }); }),
        updateProcess: vi.fn(async (id: string, updates: any) => {
            const existing = processes.get(id);
            if (existing) processes.set(id, { ...existing, ...updates });
        }),
        getProcess: vi.fn(async (id: string) => processes.get(id)),
        getAllProcesses: vi.fn(async () => Array.from(processes.values())),
        removeProcess: vi.fn(),
        clearProcesses: vi.fn(async () => 0),
        getWorkspaces: vi.fn(async () => []),
        registerWorkspace: vi.fn(),
        removeWorkspace: vi.fn(async () => false),
        updateWorkspace: vi.fn(async () => undefined),
        getWikis: vi.fn(async () => []),
        registerWiki: vi.fn(),
        removeWiki: vi.fn(async () => false),
        updateWiki: vi.fn(async () => undefined),
        onProcessOutput: vi.fn(() => () => {}),
        emitProcessOutput: vi.fn(),
        emitProcessComplete: vi.fn(),
        _processes: processes,
    };
}

// ============================================================================
// buildClarificationPrompt Tests
// ============================================================================

describe('buildClarificationPrompt', () => {
    const baseRequest: ReviewAIClarificationRequest = {
        filePath: 'docs/guide.md',
        selectedText: 'Some markdown text',
        startLine: 5,
        endLine: 8,
        instructionType: 'clarify',
    };

    it('produces a prompt with file, lines, and selected text', () => {
        const prompt = buildClarificationPrompt(baseRequest);
        expect(prompt).toContain('File: docs/guide.md');
        expect(prompt).toContain('Lines: 5-8');
        expect(prompt).toContain('Some markdown text');
        expect(prompt).toContain('Please clarify and explain the selected text.');
    });

    it('includes nearest heading when provided', () => {
        const prompt = buildClarificationPrompt({ ...baseRequest, nearestHeading: '## Installation' });
        expect(prompt).toContain('Section: ## Installation');
    });

    it('uses go-deeper instruction type', () => {
        const prompt = buildClarificationPrompt({ ...baseRequest, instructionType: 'go-deeper' });
        expect(prompt).toContain('deep analysis');
        expect(prompt).toContain('implications, edge cases');
    });

    it('uses custom instruction', () => {
        const prompt = buildClarificationPrompt({
            ...baseRequest,
            instructionType: 'custom',
            customInstruction: 'Translate to French.',
        });
        expect(prompt).toContain('Translate to French.');
    });

    it('falls back for custom without customInstruction', () => {
        const prompt = buildClarificationPrompt({ ...baseRequest, instructionType: 'custom' });
        expect(prompt).toContain('Please help me understand the selected text.');
    });

    it('prepends promptFileContent when provided', () => {
        const prompt = buildClarificationPrompt({
            ...baseRequest,
            promptFileContent: '# My Template\nDo something special.',
        });
        expect(prompt).toContain('--- Instructions from template ---');
        expect(prompt).toContain('# My Template');
        expect(prompt).toContain('--- Document context ---');
        // template before document context
        const templateIdx = prompt.indexOf('--- Instructions from template ---');
        const contextIdx = prompt.indexOf('--- Document context ---');
        expect(templateIdx).toBeLessThan(contextIdx);
    });

    it('appends surrounding context when provided', () => {
        const prompt = buildClarificationPrompt({
            ...baseRequest,
            surroundingLines: 'line before\nline after',
        });
        expect(prompt).toContain('Surrounding context:');
        expect(prompt).toContain('line before\nline after');
    });

    it('handles unknown instructionType by falling back to clarify', () => {
        const prompt = buildClarificationPrompt({
            ...baseRequest,
            instructionType: 'unknown' as any,
        });
        expect(prompt).toContain('Please clarify and explain the selected text.');
    });
});

// ============================================================================
// executeAIClarification Tests
// ============================================================================

describe('executeAIClarification', () => {
    let store: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        store = createMockStore();
        mockIsAvailable.mockReset();
        mockSendMessage.mockReset();
    });

    const request: ReviewAIClarificationRequest = {
        filePath: 'README.md',
        selectedText: 'Hello world',
        startLine: 1,
        endLine: 1,
        instructionType: 'clarify',
    };

    it('completes successfully and creates/updates process', async () => {
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'This means hello.',
            tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, turnCount: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        });

        const result = await executeAIClarification(request, store as any, '/project');

        expect(result.success).toBe(true);
        expect(result.clarification).toBe('This means hello.');
        expect(result.processId).toMatch(/^ai-review-/);
        expect(result.tokenUsage).toBeDefined();

        // Process was created
        expect(store.addProcess).toHaveBeenCalledOnce();
        const addedProcess = store.addProcess.mock.calls[0][0];
        expect(addedProcess.status).toBe('running');
        expect(addedProcess.type).toBe('clarification');

        // Process was updated to completed
        expect(store.updateProcess).toHaveBeenCalledOnce();
        const [id, updates] = store.updateProcess.mock.calls[0];
        expect(id).toBe(result.processId);
        expect(updates.status).toBe('completed');
    });

    it('marks process as failed on SDK error', async () => {
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockRejectedValue(new Error('SDK timeout'));

        const result = await executeAIClarification(request, store as any, '/project');

        expect(result.success).toBe(false);
        expect(result.error).toBe('SDK timeout');

        // Process updated to failed
        expect(store.updateProcess).toHaveBeenCalledOnce();
        const [, updates] = store.updateProcess.mock.calls[0];
        expect(updates.status).toBe('failed');
        expect(updates.error).toBe('SDK timeout');
    });

    it('throws when SDK is unavailable', async () => {
        mockIsAvailable.mockResolvedValue({ available: false, error: 'No SDK' });

        await expect(executeAIClarification(request, store as any, '/project'))
            .rejects.toThrow('Copilot SDK not available');
    });

    it('stores review metadata on the process', async () => {
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

        await executeAIClarification(request, store as any, '/project');

        const addedProcess = store.addProcess.mock.calls[0][0];
        expect(addedProcess.metadata).toEqual({
            type: 'clarification',
            source: 'review-editor',
            filePath: 'README.md',
            startLine: 1,
            endLine: 1,
            instructionType: 'clarify',
        });
    });

    it('handles sendMessage returning unsuccessful result', async () => {
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({ success: false, error: 'Rate limited' });

        const result = await executeAIClarification(request, store as any, '/project');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Rate limited');
    });
});

// ============================================================================
// createReviewTaskExecutor Tests
// ============================================================================

describe('createReviewTaskExecutor', () => {
    let store: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        store = createMockStore();
        mockIsAvailable.mockReset();
        mockSendMessage.mockReset();
    });

    it('implements TaskExecutor interface', () => {
        const executor = createReviewTaskExecutor(store as any, '/project');
        expect(typeof executor.execute).toBe('function');
    });

    it('delegates to executeAIClarification and returns result', async () => {
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({ success: true, response: 'Answer' });

        const executor = createReviewTaskExecutor(store as any, '/project');
        const task = {
            id: 'task-1',
            type: 'ai-clarification' as any,
            priority: 'normal' as any,
            status: 'running' as any,
            createdAt: Date.now(),
            payload: {
                filePath: 'README.md',
                selectedText: 'text',
                startLine: 1,
                endLine: 1,
                instructionType: 'clarify',
            },
            config: {},
        };

        const result = await executor.execute(task as any);
        expect(result.success).toBe(true);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns failure when SDK unavailable', async () => {
        mockIsAvailable.mockResolvedValue({ available: false, error: 'gone' });

        const executor = createReviewTaskExecutor(store as any, '/project');
        const task = {
            id: 'task-2',
            type: 'ai-clarification' as any,
            priority: 'normal' as any,
            status: 'running' as any,
            createdAt: Date.now(),
            payload: {
                filePath: 'README.md',
                selectedText: 'text',
                startLine: 1,
                endLine: 1,
                instructionType: 'clarify',
            },
            config: {},
        };

        const result = await executor.execute(task as any);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});
