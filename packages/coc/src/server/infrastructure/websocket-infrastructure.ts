/**
 * WebSocket Infrastructure Builder
 *
 * Creates the ProcessWebSocketServer and wires all event sources
 * (drain events, process-store changes, queue changes, schedule changes)
 * to it. Extracted from createExecutionServer to keep index.ts focused
 * on composition.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import { ProcessWebSocketServer, toProcessSummary, attachWebSocketUpgradeHandler } from '../streaming/websocket';
import { gitInfoCache } from '../git/git-info-cache';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { RepoQueueRegistry } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ScheduleManager } from '../schedule/schedule-manager';
import type { TerminalWebSocketServer } from '../terminal/index';

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a ProcessWebSocketServer, attaches it to the HTTP server, and wires
 * all event sources to it.
 *
 * @param server          - The HTTP server to attach the WebSocket server to.
 * @param store           - Process store whose changes are forwarded over WS.
 * @param bridge          - Multi-repo bridge for drain and queue-change events.
 * @param registry        - Queue registry used to build aggregate queue snapshots.
 * @param scheduleManager - Schedule manager for schedule-change events.
 * @returns The configured ProcessWebSocketServer instance.
 */
export function createWebSocketInfrastructure(
    server: http.Server,
    store: ProcessStore,
    bridge: MultiRepoQueueRouter,
    registry: RepoQueueRegistry,
    scheduleManager: ScheduleManager,
    terminalWsServer?: TerminalWebSocketServer,
): ProcessWebSocketServer {
    const wsServer = new ProcessWebSocketServer();
    wsServer.attachConnectionHandler();
    attachWebSocketUpgradeHandler(server, wsServer, terminalWsServer);

    // Invalidate the git-info cache whenever a git mutation event is broadcast
    wsServer.onGitChanged((workspaceId) => {
        gitInfoCache.invalidate(workspaceId);
    });

    // Wire drain events from multi-repo bridge to WebSocket
    bridge.on('drain-start', (event: { queued: number; running: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-start', queued: event.queued, running: event.running });
    });
    bridge.on('drain-progress', (event: { queued: number; running: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-progress', queued: event.queued, running: event.running });
    });
    bridge.on('drain-complete', (event: { outcome: 'completed'; queued: number; running: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-complete', outcome: event.outcome, queued: event.queued, running: event.running });
    });
    bridge.on('drain-timeout', (event: { queued: number; running: number; timeoutMs?: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-timeout', queued: event.queued, running: event.running, timeoutMs: event.timeoutMs });
    });

    // Store process change → WS broadcast
    store.onProcessChange = (event) => {
        switch (event.type) {
            case 'process-added':
                if (event.process) {
                    wsServer.broadcastProcessEvent({
                        type: 'process-added',
                        process: toProcessSummary(event.process),
                    });
                }
                break;
            case 'process-updated':
                if (event.process) {
                    wsServer.broadcastProcessEvent({
                        type: 'process-updated',
                        process: toProcessSummary(event.process),
                    });
                }
                break;
            case 'process-removed':
                if (event.process) {
                    wsServer.broadcastProcessEvent({
                        type: 'process-removed',
                        processId: event.process.id,
                    });
                }
                break;
            case 'processes-cleared':
                wsServer.broadcastProcessEvent({
                    type: 'processes-cleared',
                    count: 0,
                });
                break;
        }
    };

    // Helper to map task arrays to WS-friendly summaries
    const mapQueued = (t: any) => ({
        id: t.id, repoId: t.repoId, type: t.type, priority: t.priority,
        status: t.status, displayName: t.displayName, createdAt: t.createdAt,
        workingDirectory: (t.payload as any)?.workingDirectory,
        payload: {
            kind: (t.payload as any)?.kind,
            mode: (t.payload as any)?.mode,
            provider: (t.payload as any)?.provider,
            prompt: (t.payload as any)?.prompt,
            planFilePath: (t.payload as any)?.planFilePath,
            filePath: (t.payload as any)?.filePath,
            workingDirectory: (t.payload as any)?.workingDirectory,
            context: (t.payload as any)?.context?.files
                ? { files: (t.payload as any).context.files }
                : undefined,
            data: (t.payload as any)?.data ? {
                originalTaskPath: (t.payload as any)?.data?.originalTaskPath,
            } : undefined,
        },
    });
    const mapRunning = (t: any) => ({
        ...mapQueued(t), startedAt: t.startedAt,
    });
    // Bridge queue change events from all repos to WebSocket
    // History is NOT included — the HTTP /queue/history endpoint is the single
    // authoritative source. Clients detect task departures and refetch.
    bridge.on('queueChange', (event: { repoPath: string; repoId: string; type: string; taskId?: string }) => {
        // 1) Per-repo scoped broadcast
        const repoManager = registry.getQueueForRepo(event.repoPath);
        const repoStats = repoManager.getStats();
        wsServer.broadcastProcessEvent({
            type: 'queue-updated',
            queue: {
                repoId: event.repoId,
                queued: repoManager.getQueued().map(mapQueued),
                running: repoManager.getRunning().map(mapRunning),
                stats: { queued: repoStats.queued, running: repoStats.running, total: repoStats.total, isPaused: repoStats.isPaused, isDraining: repoStats.isDraining },
            },
        } as any);

        // 2) Global aggregate broadcast (no repoId) for top-level stats badge
        const allQueued: any[] = [];
        const allRunning: any[] = [];
        const combinedStats = { queued: 0, running: 0, total: 0, isPaused: false, isDraining: false };
        let allPaused = true;
        let anyManager = false;
        let anyDraining = false;

        for (const [, manager] of registry.getAllQueues()) {
            allQueued.push(...manager.getQueued());
            allRunning.push(...manager.getRunning());
            const s = manager.getStats();
            combinedStats.queued += s.queued;
            combinedStats.running += s.running;
            combinedStats.total += s.total;
            if (!s.isPaused) { allPaused = false; }
            if (s.isDraining) { anyDraining = true; }
            anyManager = true;
        }
        combinedStats.isPaused = anyManager && allPaused;
        combinedStats.isDraining = anyDraining;

        const taskInfo = event.taskId ? ` task=${event.taskId}` : '';
        process.stderr.write(`[Queue] ${event.type}${taskInfo} — queued=${combinedStats.queued} running=${combinedStats.running} ws_clients=${wsServer.clientCount}\n`);

        wsServer.broadcastProcessEvent({
            type: 'queue-updated',
            queue: {
                queued: allQueued.map(mapQueued),
                running: allRunning.map(mapRunning),
                stats: combinedStats,
            },
        } as any);
    });

    // Bridge schedule change events to WebSocket
    scheduleManager.on('change', (event: any) => {
        wsServer.broadcastProcessEvent({
            type: event.type,
            repoId: event.repoId,
            scheduleId: event.scheduleId,
            schedule: event.schedule,
            run: event.run,
        } as any);
    });

    return wsServer;
}
