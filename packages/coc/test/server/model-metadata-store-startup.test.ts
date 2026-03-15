/**
 * ModelMetadataStore warm-up at server startup
 *
 * Verifies that createExecutionServer() triggers modelMetadataStore.initialize()
 * as a fire-and-forget side-effect, passing the resolved AI service, and that
 * a rejection from initialize() never prevents the server from starting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// Mock modelMetadataStore before importing the server
vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        modelMetadataStore: {
            initialize: vi.fn().mockResolvedValue(undefined),
        },
    };
});

import { createExecutionServer } from '../../src/server/index';
import { modelMetadataStore } from '@plusplusoneplusplus/pipeline-core';

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

    it('calls initialize() once after startServer resolves', async () => {
        executionServer = await createExecutionServer({ port: 0, host: 'localhost' });

        // Allow the microtask queue to drain so the fire-and-forget call runs
        await Promise.resolve();

        expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it('passes resolvedAiService to initialize()', async () => {
        const mockAiService = { listModels: vi.fn().mockResolvedValue([]) } as any;
        executionServer = await createExecutionServer({ port: 0, host: 'localhost', aiService: mockAiService });

        await Promise.resolve();

        expect(mockInitialize).toHaveBeenCalledWith(mockAiService);
    });

    it('server starts successfully even if initialize() rejects', async () => {
        mockInitialize.mockRejectedValue(new Error('SDK unavailable'));

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            executionServer = await createExecutionServer({ port: 0, host: 'localhost' });

            // Let the rejection propagate through the .catch() handler
            await new Promise((r) => setTimeout(r, 10));

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

            await new Promise((r) => setTimeout(r, 10));

            const combined = stderrWrites.join('');
            expect(combined).toContain('[ModelMetadataStore]');
            expect(combined).toContain('token expired');
        } finally {
            stderrSpy.mockRestore();
        }
    });
});
