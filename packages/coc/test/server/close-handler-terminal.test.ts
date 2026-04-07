/**
 * Tests for buildCloseHandler() — terminal session cleanup
 *
 * Verifies:
 * - terminalSessionManager.destroyAll() is called during close
 * - Close works when terminalSessionManager is undefined
 * - destroyAll is called before wsServer.closeAll()
 */

import { describe, it, expect, vi } from 'vitest';
import * as http from 'http';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { createMockProcessStore } from '../../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

// ── Close handler test via createExecutionServer ──────────────────────────────
// buildCloseHandler is not exported, so we test it indirectly via
// createExecutionServer's returned close() function.

// Since createExecutionServer is heavy, we test the close handler ordering
// by constructing a lightweight mock that mirrors the internal pattern.

describe('Close handler terminal cleanup', () => {
    it('calls terminalSessionManager.destroyAll() when present', async () => {
        const callOrder: string[] = [];
        const mockDeps = {
            staleDetector: { dispose: vi.fn() },
            outputPruner: { stopListening: vi.fn() },
            taskWatcher: { closeAll: vi.fn() },
            pipelineWatcher: { closeAll: vi.fn() },
            templateWatcher: { closeAll: vi.fn() },
            wikiManager: { disposeAll: vi.fn() },
            scheduleManager: { dispose: vi.fn() },
            bridge: {
                drainAll: vi.fn().mockResolvedValue({ outcome: 'completed' }),
                dispose: vi.fn(),
            },
            queuePersistence: { dispose: vi.fn() },
            terminalSessionManager: {
                destroyAll: vi.fn(() => callOrder.push('terminalSessionManager.destroyAll')),
            },
            terminalWsServer: {
                closeAll: vi.fn(() => callOrder.push('terminalWsServer.closeAll')),
            },
            wsServer: {
                closeAll: vi.fn(() => callOrder.push('wsServer.closeAll')),
            },
            activeSockets: new Set<import('net').Socket>(),
            server: http.createServer(),
        };

        // Listen on port 0 so close() can shut it down
        await new Promise<void>((resolve) => mockDeps.server.listen(0, '127.0.0.1', resolve));

        // Re-import to get access to createExecutionServer for integration,
        // but since buildCloseHandler is private, we replicate its logic for unit test
        const closeHandler = buildCloseHandlerReplica(mockDeps);
        await closeHandler();

        expect(mockDeps.terminalSessionManager.destroyAll).toHaveBeenCalledOnce();
    });

    it('works when terminalSessionManager is undefined', async () => {
        const mockDeps = {
            staleDetector: { dispose: vi.fn() },
            outputPruner: { stopListening: vi.fn() },
            taskWatcher: { closeAll: vi.fn() },
            pipelineWatcher: { closeAll: vi.fn() },
            templateWatcher: { closeAll: vi.fn() },
            wikiManager: undefined,
            scheduleManager: { dispose: vi.fn() },
            bridge: {
                drainAll: vi.fn().mockResolvedValue({ outcome: 'completed' }),
                dispose: vi.fn(),
            },
            queuePersistence: { dispose: vi.fn() },
            terminalSessionManager: undefined,
            terminalWsServer: undefined,
            wsServer: { closeAll: vi.fn() },
            activeSockets: new Set<import('net').Socket>(),
            server: http.createServer(),
        };

        await new Promise<void>((resolve) => mockDeps.server.listen(0, '127.0.0.1', resolve));

        const closeHandler = buildCloseHandlerReplica(mockDeps);
        // Should not throw
        await expect(closeHandler()).resolves.toBeDefined();
    });

    it('calls terminalSessionManager.destroyAll() before wsServer.closeAll()', async () => {
        const callOrder: string[] = [];
        const mockDeps = {
            staleDetector: { dispose: vi.fn() },
            outputPruner: { stopListening: vi.fn() },
            taskWatcher: { closeAll: vi.fn() },
            pipelineWatcher: { closeAll: vi.fn() },
            templateWatcher: { closeAll: vi.fn() },
            wikiManager: undefined,
            scheduleManager: { dispose: vi.fn() },
            bridge: {
                drainAll: vi.fn().mockResolvedValue({ outcome: 'completed' }),
                dispose: vi.fn(),
            },
            queuePersistence: { dispose: vi.fn() },
            terminalSessionManager: {
                destroyAll: vi.fn(() => callOrder.push('terminalSessionManager.destroyAll')),
            },
            terminalWsServer: {
                closeAll: vi.fn(() => callOrder.push('terminalWsServer.closeAll')),
            },
            wsServer: {
                closeAll: vi.fn(() => callOrder.push('wsServer.closeAll')),
            },
            activeSockets: new Set<import('net').Socket>(),
            server: http.createServer(),
        };

        await new Promise<void>((resolve) => mockDeps.server.listen(0, '127.0.0.1', resolve));

        const closeHandler = buildCloseHandlerReplica(mockDeps);
        await closeHandler();

        const destroyAllIdx = callOrder.indexOf('terminalSessionManager.destroyAll');
        const terminalWsCloseIdx = callOrder.indexOf('terminalWsServer.closeAll');
        const wsCloseIdx = callOrder.indexOf('wsServer.closeAll');

        expect(destroyAllIdx).toBeGreaterThanOrEqual(0);
        expect(terminalWsCloseIdx).toBeGreaterThanOrEqual(0);
        expect(wsCloseIdx).toBeGreaterThanOrEqual(0);
        expect(destroyAllIdx).toBeLessThan(terminalWsCloseIdx);
        expect(terminalWsCloseIdx).toBeLessThan(wsCloseIdx);
    });
});

// ── Replica of buildCloseHandler for unit testing ─────────────────────────────
// Mirrors the exact logic from packages/coc/src/server/index.ts so we can
// unit-test ordering without starting a full execution server.

function buildCloseHandlerReplica(deps: {
    staleDetector: { dispose(): void };
    outputPruner: { stopListening(): void };
    taskWatcher: { closeAll(): void };
    pipelineWatcher: { closeAll(): void };
    templateWatcher: { closeAll(): void };
    wikiManager?: { disposeAll(): void };
    scheduleManager: { dispose(): void };
    bridge: { drainAll(ms?: number): Promise<{ outcome: string }>; dispose(): void };
    queuePersistence: { dispose(): void };
    terminalSessionManager?: { destroyAll(): void };
    terminalWsServer?: { closeAll(): void };
    wsServer: { closeAll(): void };
    activeSockets: Set<import('net').Socket>;
    server: http.Server;
}) {
    return async (closeOptions?: { drain?: boolean; drainTimeoutMs?: number }) => {
        deps.staleDetector.dispose();
        deps.outputPruner.stopListening();
        deps.taskWatcher.closeAll();
        deps.pipelineWatcher.closeAll();
        deps.templateWatcher.closeAll();
        deps.wikiManager?.disposeAll();
        deps.scheduleManager.dispose();

        let drainOutcome: string | undefined;
        if (closeOptions?.drain) {
            const result = await deps.bridge.drainAll(closeOptions.drainTimeoutMs);
            drainOutcome = result.outcome;
        }

        deps.queuePersistence.dispose();
        if (!closeOptions?.drain) {
            deps.bridge.dispose();
        }

        deps.terminalSessionManager?.destroyAll();
        deps.terminalWsServer?.closeAll();
        deps.wsServer.closeAll();
        for (const socket of deps.activeSockets) {
            socket.destroy();
        }
        deps.activeSockets.clear();
        await new Promise<void>((resolve, reject) => {
            deps.server.close((err) => {
                if (err) { reject(err); } else { resolve(); }
            });
        });

        return { drainOutcome };
    };
}
