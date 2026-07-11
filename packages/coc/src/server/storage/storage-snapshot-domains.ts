/**
 * Storage snapshot domains.
 *
 * Keeps export, import, and wipe behavior aligned for each persisted data
 * family. Public payload shapes remain defined in export-import-types.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
    AIProcess,
    ProcessStore,
    TaskQueueManager,
    WikiInfo,
    WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type {
    CoCExportPayload,
    ExportMetadata,
    ImageBlobEntry,
    ImportResult,
    QueuePersistence,
    QueueSnapshot,
    RepoPreferencesSnapshot,
    ScheduleSnapshot,
} from './export-import-types';
import { getRepoDataPath } from '../paths';
import {
    PREFERENCES_FILE_NAME,
    readRepoPreferences,
    writePreferences,
    writeRepoPreferences,
} from '../preferences/repository';
import {
    validatePerRepoPreferences,
} from '../preferences/schema';
import {
    applyRepoPreferencesPatch,
} from '../preferences/merge-policy';
import { atomicWriteJson } from '../shared/fs-utils';

interface StorageSnapshotContext {
    dataDir: string;
    store: ProcessStore;
}

interface RestoreSnapshotContext extends StorageSnapshotContext {
    getQueueManager?: () => TaskQueueManager | undefined;
    getQueuePersistence?: () => QueuePersistence | undefined;
}

interface CollectResult {
    data: Partial<StorageSnapshotData>;
    metadata: Partial<ExportMetadata>;
    warnings: string[];
}

interface StorageSnapshotData {
    processes: AIProcess[];
    workspaces: WorkspaceInfo[];
    wikis: WikiInfo[];
    queueHistory: QueueSnapshot[];
    preferences: Record<string, unknown>;
    imageBlobs: ImageBlobEntry[];
    repoPreferences: RepoPreferencesSnapshot[];
    scheduleHistory: ScheduleSnapshot[];
}

interface WipeCounts {
    deletedProcesses: number;
    deletedWorkspaces: number;
    deletedWikis: number;
    deletedQueues: number;
    deletedSchedules: number;
    deletedGitOps: number;
    deletedRepoPreferences: number;
    deletedPreferences: boolean;
    deletedWikiDirs: string[];
}

interface WipePlanResult<TPlan> {
    plan: TPlan;
    counts: Partial<WipeCounts>;
    errors: string[];
}

interface StorageSnapshotDomain<TPlan = unknown> {
    readonly id: string;
    collect(ctx: StorageSnapshotContext): Promise<CollectResult> | CollectResult;
    restoreReplace(payload: CoCExportPayload, ctx: RestoreSnapshotContext, result: ImportResult): Promise<void> | void;
    restoreMerge(payload: CoCExportPayload, ctx: RestoreSnapshotContext, result: ImportResult): Promise<void> | void;
    planWipe(ctx: StorageSnapshotContext & { includeWikis: boolean }): Promise<WipePlanResult<TPlan>> | WipePlanResult<TPlan>;
    executeWipe(ctx: StorageSnapshotContext & { includeWikis: boolean }, plan: TPlan, result: { errors: string[] }): Promise<void> | void;
}

export interface CollectedStorageSnapshot extends StorageSnapshotData {
    metadata: ExportMetadata;
    warnings: string[];
}

export interface StorageWipePlan {
    domainPlans: Map<string, unknown>;
    deletedProcesses: number;
    deletedWorkspaces: number;
    deletedWikis: number;
    deletedQueues: number;
    deletedSchedules: number;
    deletedGitOps: number;
    deletedRepoPreferences: number;
    deletedPreferences: boolean;
    deletedWikiDirs: string[];
    preservedFiles: string[];
    errors: string[];
}

interface RepoDir {
    repoId: string;
    dir: string;
}

const EMPTY_COLLECT_RESULT: CollectResult = {
    data: {},
    metadata: {},
    warnings: [],
};

let snapshotDomains: StorageSnapshotDomain[] | undefined;

function getSnapshotDomains(): StorageSnapshotDomain[] {
    snapshotDomains ??= [
        createCoreStoreDomain(),
        createQueueDomain(),
        createImageBlobDomain(),
        createPreferencesDomain(),
        createScheduleDomain(),
        createGitOpsDomain(),
    ];
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

function createCoreStoreDomain(): StorageSnapshotDomain<{
    wikiDirs: string[];
}> {
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

function createQueueDomain(): StorageSnapshotDomain<{
    queueFiles: string[];
}> {
    return {
        id: 'queue',
        collect(ctx) {
            const snapshots: QueueSnapshot[] = [];
            const warnings: string[] = [];

            for (const repo of listRepoDirs(ctx.dataDir)) {
                const filePath = path.join(repo.dir, 'queues.json');
                if (!fs.existsSync(filePath)) { continue; }
                const parsed = readJsonFile<Record<string, unknown>>(filePath);
                if (!parsed.ok) {
                    warnings.push(skippedWarning('queue file', filePath, parsed.error));
                    continue;
                }

                snapshots.push({
                    repoRootPath: typeof parsed.value.repoRootPath === 'string' ? parsed.value.repoRootPath : '',
                    repoId: typeof parsed.value.repoId === 'string' ? parsed.value.repoId : '',
                    pending: Array.isArray(parsed.value.pending) ? parsed.value.pending as QueueSnapshot['pending'] : [],
                    history: Array.isArray(parsed.value.history) ? parsed.value.history as QueueSnapshot['history'] : [],
                    isPaused: parsed.value.isPaused === true ? true : undefined,
                });
            }

            return {
                data: { queueHistory: snapshots },
                metadata: { queueFileCount: snapshots.length },
                warnings,
            };
        },
        restoreReplace(payload, ctx, result) {
            result.importedQueueFiles = writeQueueFiles(ctx.dataDir, payload.queueHistory, result.errors);
        },
        restoreMerge(payload, ctx, result) {
            result.importedQueueFiles = mergeQueueFiles(ctx.dataDir, payload.queueHistory, result.errors);
        },
        planWipe(ctx) {
            const queueFiles = listRepoFiles(ctx.dataDir, 'queues.json');
            return {
                plan: { queueFiles },
                counts: { deletedQueues: countQueueRows(ctx.store) + queueFiles.length },
                errors: [],
            };
        },
        executeWipe(ctx, plan, result) {
            try {
                deleteQueueRows(ctx.store);
            } catch (err) {
                result.errors.push(`Failed to clear queue tables: ${getErrorMessage(err)}`);
            }

            for (const filePath of plan?.queueFiles ?? []) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    result.errors.push(`Failed to delete queue file ${filePath}: ${getErrorMessage(err)}`);
                }
            }
        },
    };
}

function createImageBlobDomain(): StorageSnapshotDomain<{
    blobFiles: string[];
}> {
    return {
        id: 'image-blobs',
        collect(ctx) {
            const blobsDir = path.join(ctx.dataDir, 'blobs');
            const entries: ImageBlobEntry[] = [];
            const warnings: string[] = [];

            if (!isDirectory(blobsDir)) {
                return { data: { imageBlobs: entries }, metadata: { blobFileCount: 0 }, warnings };
            }

            const files = fs.readdirSync(blobsDir)
                .filter(f => f.endsWith('.images.json'))
                .sort();

            for (const file of files) {
                const filePath = path.join(blobsDir, file);
                const parsed = readJsonFile<unknown>(filePath);
                if (!parsed.ok) {
                    warnings.push(skippedWarning('image blob file', filePath, parsed.error));
                    continue;
                }

                entries.push({
                    taskId: file.replace(/\.images\.json$/, ''),
                    images: Array.isArray(parsed.value) ? parsed.value : [],
                });
            }

            return {
                data: { imageBlobs: entries },
                metadata: { blobFileCount: entries.length },
                warnings,
            };
        },
        restoreReplace(payload, ctx, result) {
            result.importedBlobFiles = writeBlobFiles(ctx.dataDir, payload.imageBlobs ?? [], result.errors);
        },
        restoreMerge(payload, ctx, result) {
            result.importedBlobFiles = mergeBlobFiles(ctx.dataDir, payload.imageBlobs ?? [], result.errors);
        },
        planWipe(ctx) {
            return {
                plan: { blobFiles: listBlobFiles(ctx.dataDir) },
                counts: {},
                errors: [],
            };
        },
        executeWipe(_ctx, plan, result) {
            for (const filePath of plan?.blobFiles ?? []) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    result.errors.push(`Failed to delete blob file ${filePath}: ${getErrorMessage(err)}`);
                }
            }
        },
    };
}

function createPreferencesDomain(): StorageSnapshotDomain<{
    repoPreferenceFiles: string[];
    globalPreferenceFile?: string;
}> {
    return {
        id: 'preferences',
        collect(ctx) {
            const { preferences, warnings: globalWarnings } = readGlobalPreferencesSnapshot(ctx.dataDir);
            const repoResult = readRepoPreferenceSnapshots(ctx.dataDir);

            return {
                data: {
                    preferences,
                    repoPreferences: repoResult.snapshots,
                },
                metadata: { repoPreferenceCount: repoResult.snapshots.length },
                warnings: [...globalWarnings, ...repoResult.warnings],
            };
        },
        restoreReplace(payload, ctx, result) {
            if (payload.repoPreferences) {
                result.importedRepoPreferenceFiles = writeRepoPreferenceSnapshots(ctx.dataDir, payload.repoPreferences, result.errors);
            }
            writeGlobalPreferencesSnapshot(ctx.dataDir, payload.preferences, result.errors);
        },
        restoreMerge(payload, ctx, result) {
            if (payload.repoPreferences) {
                result.importedRepoPreferenceFiles = mergeRepoPreferenceSnapshots(ctx.dataDir, payload.repoPreferences, result.errors);
            }
            mergeGlobalPreferencesSnapshot(ctx.dataDir, payload.preferences, result.errors);
        },
        planWipe(ctx) {
            const repoPreferenceFiles = listRepoFiles(ctx.dataDir, PREFERENCES_FILE_NAME);
            const globalPreferenceFile = path.join(ctx.dataDir, PREFERENCES_FILE_NAME);
            const hasGlobalPreferences = fs.existsSync(globalPreferenceFile);

            return {
                plan: {
                    repoPreferenceFiles,
                    globalPreferenceFile: hasGlobalPreferences ? globalPreferenceFile : undefined,
                },
                counts: {
                    deletedRepoPreferences: repoPreferenceFiles.length,
                    deletedPreferences: hasGlobalPreferences || repoPreferenceFiles.length > 0,
                },
                errors: [],
            };
        },
        executeWipe(_ctx, plan, result) {
            for (const filePath of plan?.repoPreferenceFiles ?? []) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    result.errors.push(`Failed to delete repo preferences ${filePath}: ${getErrorMessage(err)}`);
                }
            }

            if (!plan?.globalPreferenceFile) { return; }
            try {
                fs.unlinkSync(plan.globalPreferenceFile);
            } catch (err) {
                result.errors.push(`Failed to delete preferences: ${getErrorMessage(err)}`);
            }
        },
    };
}

function createScheduleDomain(): StorageSnapshotDomain<{
    scheduleFiles: string[];
    scheduleDirs: string[];
}> {
    const repository = new ScheduleSnapshotRepository();

    return {
        id: 'schedules',
        collect(ctx) {
            const result = repository.collect(ctx.dataDir, ctx.store);
            return {
                data: { scheduleHistory: result.snapshots },
                metadata: { scheduleFileCount: result.snapshots.length },
                warnings: result.warnings,
            };
        },
        restoreReplace(payload, ctx, result) {
            if (!payload.scheduleHistory) { return; }
            result.importedScheduleFiles = repository.writeReplace(ctx.dataDir, ctx.store, payload.scheduleHistory, result.errors);
        },
        restoreMerge(payload, ctx, result) {
            if (!payload.scheduleHistory) { return; }
            result.importedScheduleFiles = repository.writeMerge(ctx.dataDir, ctx.store, payload.scheduleHistory, result.errors);
        },
        planWipe(ctx) {
            const plan = repository.planWipe(ctx.dataDir);
            return {
                plan,
                counts: { deletedSchedules: plan.scheduleFiles.length + repository.countScheduleRuns(ctx.store) },
                errors: [],
            };
        },
        executeWipe(ctx, plan, result) {
            try {
                repository.deleteScheduleRuns(ctx.store);
            } catch (err) {
                result.errors.push(`Failed to clear schedule_runs table: ${getErrorMessage(err)}`);
            }
            repository.executeWipe(plan, result.errors);
        },
    };
}

function createGitOpsDomain(): StorageSnapshotDomain<{
    gitOpsFiles: string[];
}> {
    return {
        id: 'git-ops',
        collect() {
            return EMPTY_COLLECT_RESULT;
        },
        restoreReplace() {
            // Git operation records are wiped but are not part of the export schema.
        },
        restoreMerge() {
            // Git operation records are wiped but are not part of the export schema.
        },
        planWipe(ctx) {
            const gitOpsFiles = listRepoFiles(ctx.dataDir, 'git-ops.json');
            return {
                plan: { gitOpsFiles },
                counts: { deletedGitOps: gitOpsFiles.length },
                errors: [],
            };
        },
        executeWipe(_ctx, plan, result) {
            for (const filePath of plan?.gitOpsFiles ?? []) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    result.errors.push(`Failed to delete ${filePath}: ${getErrorMessage(err)}`);
                }
            }
        },
    };
}

class ScheduleSnapshotRepository {
    collect(dataDir: string, store: ProcessStore): { snapshots: ScheduleSnapshot[]; warnings: string[] } {
        const warnings: string[] = [];
        const runsByRepo = this.readScheduleRunsByRepo(store);
        const repoDirs = listRepoDirs(dataDir);
        const repoDirsById = new Map(repoDirs.map(repo => [repo.repoId, repo.dir]));
        const repoIds = new Set<string>([...repoDirs.map(repo => repo.repoId), ...runsByRepo.keys()]);
        const snapshots: ScheduleSnapshot[] = [];

        for (const repoId of [...repoIds].sort()) {
            const repoDir = repoDirsById.get(repoId) ?? path.join(dataDir, 'repos', repoId);
            const schedulesDir = getRepoDataPath(dataDir, repoId, 'schedules');
            const scheduleRuns = runsByRepo.get(repoId) ?? [];
            const schedules: unknown[] = [];

            if (isDirectory(schedulesDir)) {
                const yamlFiles = fs.readdirSync(schedulesDir)
                    .filter(f => f.endsWith('.yaml'))
                    .sort();

                for (const file of yamlFiles) {
                    const filePath = path.join(schedulesDir, file);
                    try {
                        const parsed = yaml.load(fs.readFileSync(filePath, 'utf-8'));
                        if (parsed && typeof parsed === 'object') {
                            schedules.push(parsed);
                        }
                    } catch (err) {
                        warnings.push(skippedWarning('schedule file', filePath, err));
                    }
                }
            }

            if (schedules.length > 0 || scheduleRuns.length > 0) {
                snapshots.push({
                    repoId,
                    repoRootPath: readRepoRootPathFromQueueFile(repoDir),
                    schedules,
                    scheduleRuns,
                });
            }
        }

        return { snapshots, warnings };
    }

    writeReplace(dataDir: string, store: ProcessStore, snapshots: ScheduleSnapshot[], errors: string[]): number {
        let written = 0;
        for (const snap of snapshots) {
            if (!snap.repoId) { continue; }
            try {
                const schedulesDir = getRepoDataPath(dataDir, snap.repoId, 'schedules');
                fs.mkdirSync(schedulesDir, { recursive: true });

                for (const schedule of snap.schedules) {
                    const id = (schedule as { id?: unknown })?.id;
                    if (typeof id !== 'string' || !id) { continue; }
                    writeYamlFileAtomic(path.join(schedulesDir, `${id}.yaml`), schedule);
                }

                this.writeScheduleRuns(store, snap.repoId, snap.scheduleRuns);
                written++;
            } catch (err) {
                errors.push(`Failed to write schedule files for ${snap.repoId}: ${getErrorMessage(err)}`);
            }
        }
        return written;
    }

    writeMerge(dataDir: string, store: ProcessStore, snapshots: ScheduleSnapshot[], errors: string[]): number {
        let written = 0;
        for (const snap of snapshots) {
            if (!snap.repoId) { continue; }
            try {
                const schedulesDir = getRepoDataPath(dataDir, snap.repoId, 'schedules');
                fs.mkdirSync(schedulesDir, { recursive: true });
                const existingIds = this.readExistingScheduleIds(schedulesDir);

                for (const schedule of snap.schedules) {
                    const id = (schedule as { id?: unknown })?.id;
                    if (typeof id !== 'string' || !id || existingIds.has(id)) { continue; }
                    writeYamlFileAtomic(path.join(schedulesDir, `${id}.yaml`), schedule);
                    existingIds.add(id);
                }

                this.writeScheduleRuns(store, snap.repoId, snap.scheduleRuns);
                written++;
            } catch (err) {
                errors.push(`Failed to merge schedule files for ${snap.repoId}: ${getErrorMessage(err)}`);
            }
        }
        return written;
    }

    planWipe(dataDir: string): { scheduleFiles: string[]; scheduleDirs: string[] } {
        const scheduleFiles: string[] = [];
        const scheduleDirs: string[] = [];

        for (const repo of listRepoDirs(dataDir)) {
            const schedulesDir = path.join(repo.dir, 'schedules');
            if (!isDirectory(schedulesDir)) { continue; }
            const files = fs.readdirSync(schedulesDir)
                .filter(f => f.endsWith('.yaml'))
                .sort()
                .map(f => path.join(schedulesDir, f));
            scheduleFiles.push(...files);
            scheduleDirs.push(schedulesDir);
        }

        return { scheduleFiles, scheduleDirs };
    }

    executeWipe(plan: { scheduleFiles: string[]; scheduleDirs: string[] } | undefined, errors: string[]): void {
        for (const filePath of plan?.scheduleFiles ?? []) {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                errors.push(`Failed to delete ${filePath}: ${getErrorMessage(err)}`);
            }
        }

        for (const dir of plan?.scheduleDirs ?? []) {
            try {
                if (fs.existsSync(dir)) {
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            } catch (err) {
                errors.push(`Failed to delete schedules dir ${dir}: ${getErrorMessage(err)}`);
            }
        }
    }

    countScheduleRuns(store: ProcessStore): number {
        if (!(store instanceof SqliteProcessStore)) { return 0; }
        try {
            return (store.getDatabase().prepare('SELECT COUNT(*) as cnt FROM schedule_runs').get() as { cnt: number }).cnt;
        } catch {
            return 0;
        }
    }

    deleteScheduleRuns(store: ProcessStore): void {
        if (!(store instanceof SqliteProcessStore)) { return; }
        try {
            store.getDatabase().prepare('DELETE FROM schedule_runs').run();
        } catch {
            // The table may not exist for older stores.
        }
    }

    private readScheduleRunsByRepo(store: ProcessStore): Map<string, unknown[]> {
        const runsByRepo = new Map<string, unknown[]>();
        if (!(store instanceof SqliteProcessStore)) { return runsByRepo; }

        try {
            const rows = store.getDatabase()
                .prepare('SELECT * FROM schedule_runs ORDER BY started_at DESC')
                .all() as ScheduleRunRow[];

            for (const row of rows) {
                const repoId = stringColumn(row, 'repo_id');
                if (!repoId) { continue; }
                if (!runsByRepo.has(repoId)) {
                    runsByRepo.set(repoId, []);
                }
                runsByRepo.get(repoId)!.push(scheduleRunRowToSnapshot(row));
            }
        } catch {
            // The table may not exist for older stores.
        }

        return runsByRepo;
    }

    private readExistingScheduleIds(schedulesDir: string): Set<string> {
        const existingIds = new Set<string>();
        if (!isDirectory(schedulesDir)) { return existingIds; }

        for (const file of fs.readdirSync(schedulesDir).filter(f => f.endsWith('.yaml'))) {
            try {
                const parsed = yaml.load(fs.readFileSync(path.join(schedulesDir, file), 'utf-8')) as { id?: unknown };
                if (typeof parsed?.id === 'string' && parsed.id) {
                    existingIds.add(parsed.id);
                }
            } catch {
                // Existing corrupt schedule files do not block merge import.
            }
        }

        return existingIds;
    }

    private writeScheduleRuns(store: ProcessStore, repoId: string, runs: unknown[]): void {
        if (!(store instanceof SqliteProcessStore) || runs.length === 0) { return; }

        const db = store.getDatabase();
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO schedule_runs (id, schedule_id, repo_id, started_at, completed_at, status, error, duration_ms, process_id, task_id)
            VALUES (@id, @scheduleId, @repoId, @startedAt, @completedAt, @status, @error, @durationMs, @processId, @taskId)
        `);
        const batch = db.transaction(() => {
            for (const run of runs) {
                const r = run as Record<string, unknown>;
                if (typeof r?.id !== 'string' || !r.id) { continue; }
                stmt.run({
                    id: r.id,
                    scheduleId: typeof r.scheduleId === 'string' ? r.scheduleId : '',
                    repoId: typeof r.repoId === 'string' ? r.repoId : repoId,
                    startedAt: typeof r.startedAt === 'string' ? r.startedAt : '',
                    completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
                    status: typeof r.status === 'string' ? r.status : 'completed',
                    error: typeof r.error === 'string' ? r.error : null,
                    durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
                    processId: typeof r.processId === 'string' ? r.processId : null,
                    taskId: typeof r.taskId === 'string' ? r.taskId : null,
                });
            }
        });
        batch();
    }
}

type ScheduleRunRow = Record<string, unknown>;

function scheduleRunRowToSnapshot(row: ScheduleRunRow): Record<string, unknown> {
    return {
        id: stringColumn(row, 'id') ?? '',
        scheduleId: stringColumn(row, 'schedule_id') ?? '',
        repoId: stringColumn(row, 'repo_id') ?? '',
        startedAt: stringColumn(row, 'started_at') ?? '',
        completedAt: stringColumn(row, 'completed_at') ?? undefined,
        status: stringColumn(row, 'status') ?? '',
        error: stringColumn(row, 'error') ?? undefined,
        durationMs: numberColumn(row, 'duration_ms') ?? undefined,
        processId: stringColumn(row, 'process_id') ?? undefined,
        taskId: stringColumn(row, 'task_id') ?? undefined,
    };
}

function stringColumn(row: ScheduleRunRow, key: string): string | undefined {
    const value = row[key];
    return typeof value === 'string' ? value : undefined;
}

function numberColumn(row: ScheduleRunRow, key: string): number | undefined {
    const value = row[key];
    return typeof value === 'number' ? value : undefined;
}

function writeQueueFiles(dataDir: string, snapshots: QueueSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoRootPath || !snap.repoId) { continue; }
        try {
            atomicWriteJson(getRepoDataPath(dataDir, snap.repoId, 'queues.json'), {
                version: 3,
                savedAt: new Date().toISOString(),
                repoRootPath: snap.repoRootPath,
                repoId: snap.repoId,
                pending: snap.pending,
                history: snap.history,
                isPaused: snap.isPaused ?? false,
            });
            written++;
        } catch (err) {
            errors.push(`Failed to write queue file for ${snap.repoRootPath}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function mergeQueueFiles(dataDir: string, snapshots: QueueSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoRootPath || !snap.repoId) { continue; }
        const filePath = getRepoDataPath(dataDir, snap.repoId, 'queues.json');
        try {
            let existingPending: unknown[] = [];
            let existingHistory: unknown[] = [];
            let existingIsPaused = false;
            if (fs.existsSync(filePath)) {
                const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
                existingPending = Array.isArray(existing.pending) ? existing.pending : [];
                existingHistory = Array.isArray(existing.history) ? existing.history : [];
                existingIsPaused = existing.isPaused === true;
            }

            const existingPendingIds = new Set(existingPending.map(taskId));
            const existingHistoryIds = new Set(existingHistory.map(taskId));
            const mergedPending = [...existingPending];
            const mergedHistory = [...existingHistory];

            for (const task of snap.pending) {
                if (!existingPendingIds.has(taskId(task))) {
                    mergedPending.push(task);
                }
            }
            for (const task of snap.history) {
                if (!existingHistoryIds.has(taskId(task))) {
                    mergedHistory.push(task);
                }
            }

            atomicWriteJson(filePath, {
                version: 3,
                savedAt: new Date().toISOString(),
                repoRootPath: snap.repoRootPath,
                repoId: snap.repoId,
                pending: mergedPending,
                history: mergedHistory,
                isPaused: existingIsPaused || (snap.isPaused ?? false),
            });
            written++;
        } catch (err) {
            errors.push(`Failed to merge queue file for ${snap.repoRootPath}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function writeBlobFiles(dataDir: string, blobs: ImageBlobEntry[], errors: string[]): number {
    let written = 0;
    for (const entry of blobs) {
        if (!entry.taskId) { continue; }
        try {
            atomicWriteJson(path.join(dataDir, 'blobs', `${entry.taskId}.images.json`), entry.images);
            written++;
        } catch (err) {
            errors.push(`Failed to write blob file for task ${entry.taskId}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function mergeBlobFiles(dataDir: string, blobs: ImageBlobEntry[], errors: string[]): number {
    let written = 0;
    for (const entry of blobs) {
        if (!entry.taskId) { continue; }
        const filePath = path.join(dataDir, 'blobs', `${entry.taskId}.images.json`);
        if (fs.existsSync(filePath)) { continue; }
        try {
            atomicWriteJson(filePath, entry.images);
            written++;
        } catch (err) {
            errors.push(`Failed to write blob file for task ${entry.taskId}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function readGlobalPreferencesSnapshot(dataDir: string): { preferences: Record<string, unknown>; warnings: string[] } {
    const prefFile = path.join(dataDir, PREFERENCES_FILE_NAME);
    if (!fs.existsSync(prefFile)) {
        return { preferences: {}, warnings: [] };
    }

    const parsed = readJsonFile<Record<string, unknown>>(prefFile);
    if (!parsed.ok) {
        return { preferences: {}, warnings: [skippedWarning('global preferences file', prefFile, parsed.error)] };
    }

    return {
        preferences: parsed.value.global !== undefined ? { global: parsed.value.global } : {},
        warnings: [],
    };
}

function writeGlobalPreferencesSnapshot(dataDir: string, preferences: Record<string, unknown>, errors: string[]): void {
    try {
        const globalData: Record<string, unknown> = {};
        if (isPlainRecord(preferences.global)) {
            globalData.global = preferences.global;
        }
        writePreferences(dataDir, globalData as any);
    } catch (err) {
        errors.push(`Failed to write preferences: ${getErrorMessage(err)}`);
    }
}

function mergeGlobalPreferencesSnapshot(dataDir: string, preferences: Record<string, unknown>, errors: string[]): void {
    try {
        if (isPlainRecord(preferences.global)) {
            const existingGlobal = readRawGlobalPreferences(dataDir);
            writePreferences(dataDir, {
                global: {
                    ...existingGlobal,
                    ...preferences.global,
                },
            } as any);
        }
    } catch (err) {
        errors.push(`Failed to merge preferences: ${getErrorMessage(err)}`);
    }
}

function readRawGlobalPreferences(dataDir: string): Record<string, unknown> {
    const prefFile = path.join(dataDir, PREFERENCES_FILE_NAME);
    if (!fs.existsSync(prefFile)) {
        return {};
    }

    const parsed = readJsonFile<Record<string, unknown>>(prefFile);
    if (!parsed.ok || !isPlainRecord(parsed.value.global)) {
        return {};
    }
    return parsed.value.global;
}

function readRepoPreferenceSnapshots(dataDir: string): { snapshots: RepoPreferencesSnapshot[]; warnings: string[] } {
    const snapshots: RepoPreferencesSnapshot[] = [];
    const warnings: string[] = [];

    for (const repo of listRepoDirs(dataDir)) {
        const filePath = path.join(repo.dir, PREFERENCES_FILE_NAME);
        if (!fs.existsSync(filePath)) { continue; }

        const parsed = readJsonFile<unknown>(filePath);
        if (!parsed.ok) {
            warnings.push(skippedWarning('repo preferences file', filePath, parsed.error));
            continue;
        }

        snapshots.push({
            repoId: repo.repoId,
            repoRootPath: readRepoRootPathFromQueueFile(repo.dir),
            preferences: validatePerRepoPreferences(parsed.value) as Record<string, unknown>,
        });
    }

    return { snapshots, warnings };
}

function writeRepoPreferenceSnapshots(dataDir: string, snapshots: RepoPreferencesSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoId) { continue; }
        try {
            writeRepoPreferences(dataDir, snap.repoId, validatePerRepoPreferences(snap.preferences));
            written++;
        } catch (err) {
            errors.push(`Failed to write repo preferences for ${snap.repoId}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function mergeRepoPreferenceSnapshots(dataDir: string, snapshots: RepoPreferencesSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoId) { continue; }
        try {
            const existing = readRepoPreferences(dataDir, snap.repoId);
            const { preferences: merged } = applyRepoPreferencesPatch(existing, snap.preferences);
            writeRepoPreferences(dataDir, snap.repoId, merged);
            written++;
        } catch (err) {
            errors.push(`Failed to merge repo preferences for ${snap.repoId}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function countQueueRows(store: ProcessStore): number {
    if (!(store instanceof SqliteProcessStore)) { return 0; }
    const db = store.getDatabase();
    try {
        const taskCount = (db.prepare('SELECT COUNT(*) as cnt FROM queue_tasks').get() as { cnt: number }).cnt;
        const stateCount = (db.prepare('SELECT COUNT(*) as cnt FROM queue_repo_state').get() as { cnt: number }).cnt;
        return taskCount + stateCount;
    } catch {
        return 0;
    }
}

function deleteQueueRows(store: ProcessStore): void {
    if (!(store instanceof SqliteProcessStore)) { return; }
    const db = store.getDatabase();
    db.prepare('DELETE FROM queue_tasks').run();
    db.prepare('DELETE FROM queue_repo_state').run();
    try {
        db.prepare('DELETE FROM queue_repo_paths').run();
    } catch {
        // The optional table is created lazily by SqliteQueuePersistence.
    }
}

function listRepoDirs(dataDir: string): RepoDir[] {
    const reposDir = path.join(dataDir, 'repos');
    if (!isDirectory(reposDir)) { return []; }

    return fs.readdirSync(reposDir)
        .sort()
        .map(name => ({ repoId: name, dir: path.join(reposDir, name) }))
        .filter(repo => isDirectory(repo.dir));
}

function listRepoFiles(dataDir: string, filename: string): string[] {
    return listRepoDirs(dataDir)
        .map(repo => path.join(repo.dir, filename))
        .filter(filePath => fs.existsSync(filePath));
}

function listBlobFiles(dataDir: string): string[] {
    const blobsDir = path.join(dataDir, 'blobs');
    if (!isDirectory(blobsDir)) { return []; }
    return fs.readdirSync(blobsDir)
        .filter(f => f.endsWith('.images.json'))
        .sort()
        .map(f => path.join(blobsDir, f));
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
    if (counts.deletedProcesses !== undefined) {plan.deletedProcesses = counts.deletedProcesses;}
    if (counts.deletedWorkspaces !== undefined) {plan.deletedWorkspaces = counts.deletedWorkspaces;}
    if (counts.deletedWikis !== undefined) {plan.deletedWikis = counts.deletedWikis;}
    if (counts.deletedQueues !== undefined) {plan.deletedQueues = counts.deletedQueues;}
    if (counts.deletedSchedules !== undefined) {plan.deletedSchedules = counts.deletedSchedules;}
    if (counts.deletedGitOps !== undefined) {plan.deletedGitOps = counts.deletedGitOps;}
    if (counts.deletedRepoPreferences !== undefined) {plan.deletedRepoPreferences = counts.deletedRepoPreferences;}
    if (counts.deletedPreferences !== undefined) {plan.deletedPreferences = counts.deletedPreferences;}
    if (counts.deletedWikiDirs !== undefined) {plan.deletedWikiDirs = [...counts.deletedWikiDirs];}
}

function readRepoRootPathFromQueueFile(repoDir: string): string {
    const queueFile = path.join(repoDir, 'queues.json');
    try {
        if (!fs.existsSync(queueFile)) { return ''; }
        const q = JSON.parse(fs.readFileSync(queueFile, 'utf-8')) as { repoRootPath?: unknown };
        return typeof q.repoRootPath === 'string' ? q.repoRootPath : '';
    } catch {
        return '';
    }
}

function writeYamlFileAtomic(filePath: string, data: unknown): void {
    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
        fs.writeFileSync(tmpPath, yaml.dump(data, { lineWidth: -1 }), 'utf-8');
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup failure */ }
        throw err;
    }
}

function readJsonFile<T>(filePath: string): { ok: true; value: T } | { ok: false; error: unknown } {
    try {
        return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T };
    } catch (error) {
        return { ok: false, error };
    }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function taskId(task: unknown): unknown {
    return typeof task === 'object' && task !== null ? (task as { id?: unknown }).id : undefined;
}

function isDirectory(dir: string): boolean {
    try {
        return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

function skippedWarning(label: string, filePath: string, err: unknown): string {
    return `Skipped ${label} ${filePath}: ${getErrorMessage(err)}`;
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
