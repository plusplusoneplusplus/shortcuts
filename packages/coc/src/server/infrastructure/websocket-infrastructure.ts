/**
 * Creates the ProcessWebSocketServer and wires all event sources
 * (drain events, process-store changes, queue changes, schedule changes)
 * to it. Extracted from createExecutionServer to keep index.ts focused
 * on composition.
 */

import * as http from 'http';
import { ProcessWebSocketServer, toProcessSummary, attachWebSocketUpgradeHandler } from '../streaming/websocket';
import { gitInfoCache } from '../git/git-info-cache';
import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { RepoQueueRegistry, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ScheduleManager } from '../schedule/schedule-manager';
import type { TerminalWebSocketServer } from '../terminal/index';
import type { LanguageServerWebSocketServer } from '../language-servers/ws-bridge';
import { projectQueueTaskBotControl } from '../processes/bot-control-read-model';
import { getServerLogger } from '../logging/server-logger';

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a ProcessWebSocketServer, attaches it to the HTTP server, and wires
 * all event sources to it.
 *
 * @param store           - Process store whose changes are forwarded over WS.
 * @param bridge          - Multi-repo bridge for drain and queue-change events.
 * @param registry        - Queue registry used to build aggregate queue snapshots.
 * @param scheduleManager - Schedule manager for schedule-change events.
 */
export function createWebSocketInfrastructure(
    server: http.Server,
    store: ProcessStore,
    bridge: MultiRepoQueueRouter,
    registry: RepoQueueRegistry,
    scheduleManager: ScheduleManager,
    terminalWsServer?: TerminalWebSocketServer,
    languageServerWsServer?: LanguageServerWebSocketServer,
    botManagedConversationsEnabled: () => boolean = () => false,
): ProcessWebSocketServer {
    const wsServer = new ProcessWebSocketServer();
    wsServer.attachConnectionHandler();
    attachWebSocketUpgradeHandler(server, wsServer, terminalWsServer, languageServerWsServer);

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
    const processControlSnapshots = new Map<string, string>();
    store.onProcessChange = (event) => {
        const enabled = botManagedConversationsEnabled();
        let controlChanged = false;
        switch (event.type) {
            case 'process-added':
            case 'process-updated':
                if (event.process) {
                    const summary = toProcessSummary(event.process, enabled);
                    const controlSnapshot = JSON.stringify([summary.workspaceId, summary.botControl ?? null]);
                    controlChanged = enabled && processControlSnapshots.get(summary.id) !== controlSnapshot;
                    if (enabled) processControlSnapshots.set(summary.id, controlSnapshot);
                    else processControlSnapshots.delete(summary.id);
                    wsServer.broadcastProcessEvent({ type: event.type, process: summary });
                }
                break;
            case 'process-removed':
                if (event.process) {
                    processControlSnapshots.delete(event.process.id);
                    wsServer.broadcastProcessEvent({
                        type: 'process-removed',
                        processId: event.process.id,
                    });
                }
                break;
            case 'processes-cleared':
                processControlSnapshots.clear();
                wsServer.broadcastProcessEvent({
                    type: 'processes-cleared',
                    count: 0,
                });
                break;
        }
        if (enabled && controlChanged && event.process
            && (event.type === 'process-added' || event.type === 'process-updated')) {
            const process = event.process;
            for (const [repoPath, manager] of registry.getAllQueues()) {
                const affectedRepoIds = new Set([...manager.getQueued(), ...manager.getRunning()]
                    .filter(task => task.payload.kind === 'chat'
                        && (task.payload.processId ?? task.processId ?? toQueueProcessId(task.id)) === process.id)
                    .map(task => task.repoId));
                for (const repoId of affectedRepoIds) {
                    if (repoId) broadcastQueueSnapshot({ repoPath, repoId, type: event.type });
                }
            }
        }
    };

    // Helper to map task arrays to WS-friendly summaries
    const mapQueued = (t: any) => ({
        id: t.id, repoId: t.repoId, type: t.type, priority: t.priority,
        status: t.status, displayName: t.displayName, createdAt: t.createdAt,
        // Freeze state has to ride along: this payload replaces the SPA's queue
        // wholesale on every change, so anything omitted here makes the frozen
        // badge and the Unfreeze menu item vanish until the next HTTP refetch.
        frozen: t.frozen, frozenUntil: t.frozenUntil,
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
    const taskKey = (task: { id: string; repoId?: string }) => JSON.stringify([task.repoId, task.id]);
    let queueRevision = 0;
    const repoRevisions = new Map<string, number>();
    // Bridge queue change events from all repos to WebSocket
    // History is NOT included — the HTTP /queue/history endpoint is the single
    // authoritative source. Clients detect task departures and refetch.
    function broadcastQueueSnapshot(event: { repoPath: string; repoId: string; type: string; taskId?: string }): void {
        // 1) Per-repo scoped broadcast
        const repoManager = registry.getQueueForRepo(event.repoPath);
        const repoStats = repoManager.getStats();
        const repoGate = repoManager.getRepoGate(event.repoId);
        const revision = ++queueRevision;
        repoRevisions.set(event.repoId, revision);
        const repoQueued = repoManager.getQueued();
        const repoRunning = repoManager.getRunning();
        const repoSnapshot = {
            type: 'queue-updated',
            queue: {
                repoId: event.repoId,
                queued: repoQueued.map(mapQueued),
                running: repoRunning.map(mapRunning),
                stats: {
                    queued: repoStats.queued,
                    running: repoStats.running,
                    total: repoStats.total,
                    isPaused: repoStats.isPaused,
                    isDraining: repoStats.isDraining,
                    ...(repoGate ? { repoGate } : {}),
                },
            },
        } as const;

        // 2) Global aggregate broadcast (no repoId) for top-level stats badge
        const allQueued: QueuedTask[] = [];
        const allRunning: QueuedTask[] = [];
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

        const aggregateSnapshot = {
            type: 'queue-updated',
            queue: {
                queued: allQueued.map(mapQueued),
                running: allRunning.map(mapRunning),
                stats: combinedStats,
            },
        } as const;

        // Keep disabled notifications synchronous, including the queue admission
        // boundary. Enabled ownership reads are async and must not revive an older snapshot.
        if (!botManagedConversationsEnabled()) {
            wsServer.broadcastProcessEvent(repoSnapshot);
            wsServer.broadcastProcessEvent(aggregateSnapshot);
            return;
        }
        const tasks = [...new Set([...repoQueued, ...repoRunning, ...allQueued, ...allRunning])];
        void Promise.all(tasks.map(async task => [
            taskKey(task), await projectQueueTaskBotControl(task, store, true),
        ] as const)).then(entries => {
            const controls = new Map(entries);
            const enabled = botManagedConversationsEnabled();
            const enrich = (task: ReturnType<typeof mapQueued>) => {
                const botControl = enabled ? controls.get(taskKey(task)) : undefined;
                return botControl ? { ...task, botControl } : task;
            };
            if (repoRevisions.get(event.repoId) === revision) {
                wsServer.broadcastProcessEvent({
                    ...repoSnapshot,
                    queue: {
                        ...repoSnapshot.queue,
                        queued: repoSnapshot.queue.queued.map(enrich),
                        running: repoSnapshot.queue.running.map(enrich),
                    },
                });
            }
            if (queueRevision === revision) {
                wsServer.broadcastProcessEvent({
                    ...aggregateSnapshot,
                    queue: {
                        ...aggregateSnapshot.queue,
                        queued: aggregateSnapshot.queue.queued.map(enrich),
                        running: aggregateSnapshot.queue.running.map(enrich),
                    },
                });
            }
        }).catch(() => {
            // An event observer cannot return a read failure to its caller. Do
            // not broadcast a success-shaped snapshot or log private store errors.
            getServerLogger().error('Unable to project bot control for queue WebSocket snapshot');
        });
    }
    bridge.on('queueChange', broadcastQueueSnapshot);

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
