/**
 * Core store snapshot domain.
 *
 * Owns export/import/wipe for the process store's processes, workspaces, and
 * wikis (plus generated wiki output directories on disk).
 */

import * as fs from 'fs';
import type { WikiInfo } from '@plusplusoneplusplus/forge';
import type { StorageSnapshotDomain } from './types';
import { getErrorMessage, isDirectory } from './snapshot-fs';

export function createCoreStoreDomain(): StorageSnapshotDomain<{ wikiDirs: string[] }> {
    return {
        id: 'core-store',
        async collect(ctx) {
            const [processes, workspaces, wikis] = await Promise.all([
                ctx.store.getAllProcesses(),
                ctx.store.getWorkspaces(),
                ctx.store.getWikis(),
            ]);

            return {
                data: { processes, workspaces, wikis },
                metadata: {
                    processCount: processes.length,
                    workspaceCount: workspaces.length,
                    wikiCount: wikis.length,
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

            for (const wiki of payload.wikis) {
                try {
                    await ctx.store.registerWiki(wiki);
                    result.importedWikis++;
                } catch (err) {
                    result.errors.push(`Failed to add wiki ${wiki.id}: ${getErrorMessage(err)}`);
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

            const existingWikis = await ctx.store.getWikis();
            const existingWikiIds = new Set(existingWikis.map(w => w.id));
            for (const wiki of payload.wikis) {
                if (existingWikiIds.has(wiki.id)) { continue; }
                try {
                    await ctx.store.registerWiki(wiki);
                    result.importedWikis++;
                } catch (err) {
                    result.errors.push(`Failed to add wiki ${wiki.id}: ${getErrorMessage(err)}`);
                }
            }
        },
        async planWipe(ctx) {
            const errors: string[] = [];
            let deletedProcesses = 0;
            let deletedWorkspaces = 0;
            let deletedWikis = 0;
            let wikiDirs: string[] = [];

            try {
                const stats = await ctx.store.getStorageStats();
                deletedProcesses = stats.totalProcesses;
                deletedWikis = stats.totalWikis;
            } catch (err) {
                errors.push(`Failed to count process store data: ${getErrorMessage(err)}`);
            }

            try {
                deletedWorkspaces = (await ctx.store.getWorkspaces()).length;
            } catch (err) {
                errors.push(`Failed to count workspaces: ${getErrorMessage(err)}`);
            }

            if (ctx.includeWikis) {
                try {
                    const wikis = await ctx.store.getWikis();
                    wikiDirs = wikis
                        .map((w: WikiInfo) => w.wikiDir)
                        .filter((dir: string) => typeof dir === 'string' && dir.length > 0);
                } catch (err) {
                    errors.push(`Failed to collect wiki directories: ${getErrorMessage(err)}`);
                }
            }

            return {
                plan: { wikiDirs },
                counts: {
                    deletedProcesses,
                    deletedWorkspaces,
                    deletedWikis,
                    deletedWikiDirs: wikiDirs,
                },
                errors,
            };
        },
        async executeWipe(ctx, plan, result) {
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

            try {
                await ctx.store.clearAllWikis();
            } catch (err) {
                result.errors.push(`Failed to clear wikis: ${getErrorMessage(err)}`);
            }

            if (!ctx.includeWikis) { return; }
            for (const dir of plan?.wikiDirs ?? []) {
                try {
                    if (isDirectory(dir)) {
                        fs.rmSync(dir, { recursive: true, force: true });
                    }
                } catch (err) {
                    result.errors.push(`Failed to delete wiki directory ${dir}: ${getErrorMessage(err)}`);
                }
            }
        },
    };
}
