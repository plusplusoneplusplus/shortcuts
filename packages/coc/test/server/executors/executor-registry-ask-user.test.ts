/**
 * ExecutorRegistry.getAskUserHandles — followUpExecutor regression
 *
 * Regression: ask-user questions raised during a follow-up turn lived in
 * followUpExecutor.sessions but getAskUserHandles only searched chatExecutor.
 * The fix adds followUpExecutor to the lookup chain so that
 * POST /api/processes/:id/ask-user-response returns 200 instead of 404 when
 * the user answers a question in a second (or later) turn.
 */

import { describe, it, expect, vi } from 'vitest';
import { ExecutorRegistry } from '../../../src/server/executors/executor-registry';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(false),
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

function createRegistry() {
    const store = createMockProcessStore();
    const registry = new ExecutorRegistry(store, {
        approvePermissions: true,
        aiService: sdkMocks.service as any,
        dataDir: '/data',
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        resolveSkillConfig: vi.fn().mockResolvedValue({}),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-1'),
        onTitleNeeded: vi.fn(),
        getWsServer: () => undefined,
    });
    return { store, registry };
}

const fakeHandles = {
    answerQuestion: vi.fn(() => true),
    skipQuestion: vi.fn(() => true),
    answerQuestions: vi.fn(() => true),
    cancelAll: vi.fn(),
    hasPending: vi.fn(() => true),
};

// ============================================================================
// Tests
// ============================================================================

describe('ExecutorRegistry.getAskUserHandles', () => {
    it('returns handles from chatExecutor when question lives there', () => {
        const { registry } = createRegistry();
        vi.spyOn((registry as any).chatExecutor, 'getAskUserHandles').mockReturnValue(fakeHandles);
        vi.spyOn((registry as any).followUpExecutor, 'getAskUserHandles').mockReturnValue(undefined);

        expect(registry.getAskUserHandles('queue_task-1')).toBe(fakeHandles);
        expect((registry as any).followUpExecutor.getAskUserHandles).not.toHaveBeenCalled();
    });

    it('returns handles from followUpExecutor when question lives there (regression: second turn)', () => {
        const { registry } = createRegistry();
        vi.spyOn((registry as any).chatExecutor, 'getAskUserHandles').mockReturnValue(undefined);
        vi.spyOn((registry as any).followUpExecutor, 'getAskUserHandles').mockReturnValue(fakeHandles);

        // Before the fix this returned undefined, causing 404 on /ask-user-response
        expect(registry.getAskUserHandles('queue_task-3')).toBe(fakeHandles);
    });

    it('returns undefined when no executor has a handle', () => {
        const { registry } = createRegistry();
        vi.spyOn((registry as any).chatExecutor, 'getAskUserHandles').mockReturnValue(undefined);
        vi.spyOn((registry as any).followUpExecutor, 'getAskUserHandles').mockReturnValue(undefined);

        expect(registry.getAskUserHandles('queue_task-none')).toBeUndefined();
    });
});
