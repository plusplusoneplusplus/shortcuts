/**
 * Core store snapshot domain.
 *
 * Owns export/import/wipe for the process store's processes and workspaces.
 */

import type { StorageSnapshotDomain } from './types';
import { getErrorMessage } from './snapshot-fs';

export function createCoreStoreDomain(): StorageSnapshotDomain<undefined> {
    return {
        id: 'core-store',
        async collect(ctx) {
            const [processes, workspaces] = await Promise.all([
                ctx.store.getAllProcesses(),
                ctx.store.getWorkspaces(),
            ]);

            return {
                data: { processes, workspaces },
                metadata: {
                    processCount: processes.length,
                    workspaceCount: workspaces.length,
                },
                warnings: [],
            };
        },
        async restoreReplace(payload, ctx, result) {
            for (const proc of payload.processes) {
                try {
                    await ctx.store.addProcess(proc);
                    result.importedProcesses++;
                } catch (err) {
                    result.errors.push(`Failed to add process ${proc.id}: ${getErrorMessage(err)}`);
                }
            }

            for (const ws of payload.workspaces) {
                try {
                    await ctx.store.registerWorkspace(ws);
                    result.importedWorkspaces++;
                } catch (err) {
                    result.errors.push(`Failed to add workspace ${ws.id}: ${getErrorMessage(err)}`);
                }
            }
        },
        async restoreMerge(payload, ctx, result) {
            const existingProcesses = await ctx.store.getAllProcesses();
            const existingProcessIds = new Set(existingProcesses.map(p => p.id));
            for (const proc of payload.processes) {
                if (existingProcessIds.has(proc.id)) { continue; }
                try {
                    await ctx.store.addProcess(proc);
                    result.importedProcesses++;
                } catch (err) {
                    result.errors.push(`Failed to add process ${proc.id}: ${getErrorMessage(err)}`);
                }
            }

            const existingWorkspaces = await ctx.store.getWorkspaces();
            const existingWorkspaceIds = new Set(existingWorkspaces.map(w => w.id));
            for (const ws of payload.workspaces) {
                if (existingWorkspaceIds.has(ws.id)) { continue; }
                try {
                    await ctx.store.registerWorkspace(ws);
                    result.importedWorkspaces++;
                } catch (err) {
                    result.errors.push(`Failed to add workspace ${ws.id}: ${getErrorMessage(err)}`);
                }
            }
        },
        async planWipe(ctx) {
            const errors: string[] = [];
            let deletedProcesses = 0;
            let deletedWorkspaces = 0;

            try {
                const stats = await ctx.store.getStorageStats();
                deletedProcesses = stats.totalProcesses;
            } catch (err) {
                errors.push(`Failed to count process store data: ${getErrorMessage(err)}`);
            }

            try {
                deletedWorkspaces = (await ctx.store.getWorkspaces()).length;
            } catch (err) {
                errors.push(`Failed to count workspaces: ${getErrorMessage(err)}`);
            }

            return {
                plan: undefined,
                counts: {
                    deletedProcesses,
                    deletedWorkspaces,
                },
                errors,
            };
        },
        async executeWipe(ctx, _plan, result) {
            try {
                await ctx.store.clearProcesses();
            } catch (err) {
                result.errors.push(`Failed to clear processes: ${getErrorMessage(err)}`);
            }

            try {
                await ctx.store.clearAllWorkspaces();
            } catch (err) {
                result.errors.push(`Failed to clear workspaces: ${getErrorMessage(err)}`);
            }

        },
    };
}
