/**
 * Storage snapshot registry and orchestration.
 *
 * Declares the ordered set of snapshot domains and drives the public
 * collect/restore/wipe orchestration by delegating to each domain. Adding a
 * storage family means adding a domain module and registering it here — no
 * changes to the orchestration flow below.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    CoCExportPayload,
    ExportMetadata,
    ImportResult,
} from '../export-import-types';
import type {
    CollectedStorageSnapshot,
    RestoreSnapshotContext,
    StorageSnapshotContext,
    StorageSnapshotData,
    StorageSnapshotDomain,
    StorageWipePlan,
    WipeCounts,
} from './types';
import { createCoreStoreDomain } from './core-store-domain';
import { createQueueDomain } from './queue-domain';
import { createImageBlobDomain } from './image-blob-domain';
import { createPreferencesDomain } from './preferences-domain';
import { createScheduleDomain } from './schedule-domain';
import { createGitOpsDomain } from './git-ops-domain';

/** Build a fresh, ordered set of snapshot domains. */
export function createSnapshotDomains(): StorageSnapshotDomain[] {
    return [
        createCoreStoreDomain(),
        createQueueDomain(),
        createImageBlobDomain(),
        createPreferencesDomain(),
        createScheduleDomain(),
        createGitOpsDomain(),
    ];
}

let snapshotDomains: StorageSnapshotDomain[] | undefined;

function getSnapshotDomains(): StorageSnapshotDomain[] {
    snapshotDomains ??= createSnapshotDomains();
    return snapshotDomains;
}

export async function collectStorageSnapshot(ctx: StorageSnapshotContext): Promise<CollectedStorageSnapshot> {
    const snapshot: StorageSnapshotData = {
        processes: [],
        workspaces: [],
        wikis: [],
        queueHistory: [],
        preferences: {},
        imageBlobs: [],
        repoPreferences: [],
        scheduleHistory: [],
    };
    const metadata: ExportMetadata = {
        processCount: 0,
        workspaceCount: 0,
        wikiCount: 0,
        queueFileCount: 0,
        blobFileCount: 0,
        repoPreferenceCount: 0,
        scheduleFileCount: 0,
    };
    const warnings: string[] = [];

    for (const domain of getSnapshotDomains()) {
        const collected = await domain.collect(ctx);
        Object.assign(snapshot, collected.data);
        Object.assign(metadata, collected.metadata);
        warnings.push(...collected.warnings);
    }

    return { ...snapshot, metadata, warnings };
}

export async function restoreStorageSnapshotReplace(
    payload: CoCExportPayload,
    ctx: RestoreSnapshotContext,
    result: ImportResult,
): Promise<void> {
    for (const domain of getSnapshotDomains()) {
        await domain.restoreReplace(payload, ctx, result);
    }
}

export async function restoreStorageSnapshotMerge(
    payload: CoCExportPayload,
    ctx: RestoreSnapshotContext,
    result: ImportResult,
): Promise<void> {
    for (const domain of getSnapshotDomains()) {
        await domain.restoreMerge(payload, ctx, result);
    }
}

export async function buildStorageWipePlan(
    ctx: StorageSnapshotContext & { includeWikis: boolean },
): Promise<StorageWipePlan> {
    const plan: StorageWipePlan = {
        domainPlans: new Map<string, unknown>(),
        deletedProcesses: 0,
        deletedWorkspaces: 0,
        deletedWikis: 0,
        deletedQueues: 0,
        deletedSchedules: 0,
        deletedGitOps: 0,
        deletedRepoPreferences: 0,
        deletedPreferences: false,
        deletedWikiDirs: [],
        preservedFiles: listPreservedFiles(ctx.dataDir),
        errors: [],
    };

    for (const domain of getSnapshotDomains()) {
        const domainPlan = await domain.planWipe(ctx);
        plan.domainPlans.set(domain.id, domainPlan.plan);
        applyWipeCounts(plan, domainPlan.counts);
        plan.errors.push(...domainPlan.errors);
    }

    return plan;
}

export function applyStorageWipePlanSummary(
    result: Omit<StorageWipePlan, 'domainPlans'>,
    plan: StorageWipePlan,
): void {
    result.deletedProcesses = plan.deletedProcesses;
    result.deletedWorkspaces = plan.deletedWorkspaces;
    result.deletedWikis = plan.deletedWikis;
    result.deletedQueues = plan.deletedQueues;
    result.deletedSchedules = plan.deletedSchedules;
    result.deletedGitOps = plan.deletedGitOps;
    result.deletedRepoPreferences = plan.deletedRepoPreferences;
    result.deletedPreferences = plan.deletedPreferences;
    result.deletedWikiDirs = [...plan.deletedWikiDirs];
    result.preservedFiles = [...plan.preservedFiles];
    result.errors.push(...plan.errors);
}

export async function executeStorageWipePlan(
    ctx: StorageSnapshotContext & { includeWikis: boolean },
    plan: StorageWipePlan,
    result: { errors: string[] },
): Promise<void> {
    for (const domain of getSnapshotDomains()) {
        await domain.executeWipe(ctx, plan.domainPlans.get(domain.id), result);
    }
}

function listPreservedFiles(dataDir: string): string[] {
    const preservedFiles: string[] = [];
    const configYaml = path.join(dataDir, 'config.yaml');
    if (fs.existsSync(configYaml)) {
        preservedFiles.push(configYaml);
    }
    const skillsDir = path.join(dataDir, 'skills');
    if (fs.existsSync(skillsDir)) {
        preservedFiles.push(skillsDir);
    }
    return preservedFiles;
}

function applyWipeCounts(plan: StorageWipePlan, counts: Partial<WipeCounts>): void {
    if (counts.deletedProcesses !== undefined) { plan.deletedProcesses = counts.deletedProcesses; }
    if (counts.deletedWorkspaces !== undefined) { plan.deletedWorkspaces = counts.deletedWorkspaces; }
    if (counts.deletedWikis !== undefined) { plan.deletedWikis = counts.deletedWikis; }
    if (counts.deletedQueues !== undefined) { plan.deletedQueues = counts.deletedQueues; }
    if (counts.deletedSchedules !== undefined) { plan.deletedSchedules = counts.deletedSchedules; }
    if (counts.deletedGitOps !== undefined) { plan.deletedGitOps = counts.deletedGitOps; }
    if (counts.deletedRepoPreferences !== undefined) { plan.deletedRepoPreferences = counts.deletedRepoPreferences; }
    if (counts.deletedPreferences !== undefined) { plan.deletedPreferences = counts.deletedPreferences; }
    if (counts.deletedWikiDirs !== undefined) { plan.deletedWikiDirs = [...counts.deletedWikiDirs]; }
}
