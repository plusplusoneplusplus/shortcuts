/**
 * ModelMetadataStore warm-up at server startup
 *
 * Verifies that createExecutionServer() warms model metadata before listening,
 * passes the resolved AI service, and still starts when initialization rejects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// Mock modelMetadataStore before importing the server
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        modelMetadataStore: {
            initialize: vi.fn().mockResolvedValue(undefined),
        },
        sdkServiceRegistry: {
            getOrThrow: () => ({ sendMessage: vi.fn(), isAvailable: vi.fn().mockResolvedValue({ available: false }) }),
        },
    };
});

import { createExecutionServer } from '../../src/server/index';
import { modelMetadataStore } from '@plusplusoneplusplus/forge';

const mockInitialize = modelMetadataStore.initialize as ReturnType<typeof vi.fn>;

describe('ModelMetadataStore warm-up at server startup', () => {
    let executionServer: ExecutionServer | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        mockInitialize.mockResolvedValue(undefined);
    });

    afterEach(async () => {
        if (executionServer) {
            await executionServer.close();
            executionServer = undefined;
        }
    });

    it('calls initialize() once before startServer resolves', async () => {
        executionServer = await createExecutionServer({ port: 0, host: 'localhost' });

        expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it('passes resolvedAiService to initialize()', async () => {
        const mockAiService = { listModels: vi.fn().mockResolvedValue([]) } as any;
        executionServer = await createExecutionServer({ port: 0, host: 'localhost', aiService: mockAiService });

        expect(mockInitialize).toHaveBeenCalledWith(mockAiService);
    });

    it('server starts successfully even if initialize() rejects', async () => {
        mockInitialize.mockRejectedValue(new Error('SDK unavailable'));

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            executionServer = await createExecutionServer({ port: 0, host: 'localhost' });

            expect(executionServer.server.listening).toBe(true);
        } finally {
            stderrSpy.mockRestore();
        }
    });

    it('writes error message to stderr when initialize() rejects', async () => {
        mockInitialize.mockRejectedValue(new Error('token expired'));

        const stderrWrites: string[] = [];
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
            stderrWrites.push(String(chunk));
            return true;
        });

        try {
            executionServer = await createExecutionServer({ port: 0, host: 'localhost' });

            const combined = stderrWrites.join('');
            expect(combined).toContain('[ModelMetadataStore]');
            expect(combined).toContain('token expired');
        } finally {
            stderrSpy.mockRestore();
        }
    });
});
