import { getServerLogger } from '../logging/server-logger';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomic } from '../canvas/canvas-atomic-write';
import type { CanvasRecord } from '../canvas/canvas-store';
import { listCanvasExtensionInstances, readCanvasExtensionInstance } from './instance-records';
import { persistCanvasExtensionInstance, runCanvasExtensionOperation, type CanvasExtensionInstanceDeps } from './instance-service';
import {
    assertManagedPath, checkGeneratedSyntax, generatedExtensionKey, generatedOwnerRoot, generatedPackageRoot, generatedSourceContext, listGeneratedPackages,
    readGeneratedPackage, removeManagedPath, stageGeneratedPackage, writeGeneratedPublication,
    type GeneratedAsset, type GeneratedPublication,
} from './generated-packages';
import { sessionWorkspacePath } from './session-workspace';

export interface PublishGeneratedCanvasArgs {
    sourcePath: string;
    canvasId?: string;
    expectedRevision?: number;
    declaredCanvasId?: string;
    input?: Record<string, unknown>;
    assets?: GeneratedAsset[];
}
interface Journal { previous?: GeneratedPublication; candidate: GeneratedPublication; records: CanvasRecord[]; createdCanvasId?: string }
function publication(item: GeneratedPublication): GeneratedPublication {
    const { id, revision, contentHash, cwd, assets, status } = item;
    return { id, revision, contentHash, cwd, assets, status };
}
function journalPath(deps: CanvasExtensionInstanceDeps, id: string): string {
    return path.join(generatedPackageRoot(deps.dataDir, deps, id), 'pending.json');
}
function writeJournal(deps: CanvasExtensionInstanceDeps, journal: Journal) {
    writeFileAtomic(journalPath(deps, journal.candidate.id), JSON.stringify(journal));
}
function pruneRevisions(deps: CanvasExtensionInstanceDeps, committed: GeneratedPublication) {
    const root = path.join(generatedPackageRoot(deps.dataDir, deps, committed.id), 'revisions');
    for (const name of fs.readdirSync(root)) {
        if (name !== committed.revision) {removeManagedPath(deps.dataDir, path.join(root, name)); }
    }
    for (const name of fs.readdirSync(path.dirname(root))) {
        if (name.startsWith('.tmp-')) removeManagedPath(deps.dataDir, path.join(path.dirname(root), name));
    }
}

/** Caller holds the exact owner's operation queue. Recovery never starts application code. */
export function reconcileGeneratedPublications(deps: CanvasExtensionInstanceDeps): void {
    const root = generatedOwnerRoot(deps.dataDir, deps);
    assertManagedPath(deps.dataDir, root);
    if (!fs.existsSync(root)) {return; }
    const referenced = new Set(listCanvasExtensionInstances(deps.canvasStore, deps).map(record => record.instance.extensionKey));
    for (const id of fs.readdirSync(root)) {
        if (!/^[0-9a-f-]{36}$/.test(id)) {continue; }
        const pending = journalPath(deps, id);
        assertManagedPath(deps.dataDir, pending);
        if (fs.existsSync(pending)) {
            const journal: Journal = JSON.parse(fs.readFileSync(pending, 'utf8'));
            if (journal.candidate.id !== id || (journal.previous && journal.previous.id !== id)
                || journal.records.some(record => record.workspaceId !== deps.workspaceId || record.processId !== deps.processId
                    || readCanvasExtensionInstance(record).extensionKey !== generatedExtensionKey(deps, id))) { throw new Error('Invalid publication journal'); }
            if (journal.previous) {
                for (const old of journal.records) {
                    const current = deps.canvasStore.getCanvas(deps.workspaceId, old.id);
                    if (!current || current.processId !== deps.processId || current.type !== 'copilot-extension'
                        || readCanvasExtensionInstance(current).extensionKey !== generatedExtensionKey(deps, id)) {continue; }
                    const instance = readCanvasExtensionInstance(old);
                    persistCanvasExtensionInstance(deps, { ...instance,
                        runtimeReload: { id: randomUUID(), error: 'Publication interrupted. Reload to retry committed source.' },
                    }, current, { silent: true });
                }
                writeGeneratedPublication(deps.dataDir, deps, { ...journal.previous, status: 'failed' });
                fs.unlinkSync(pending);
            } else {
                if (journal.createdCanvasId) {
                    const canvas = deps.canvasStore.getCanvas(deps.workspaceId, journal.createdCanvasId);
                    if (canvas?.processId === deps.processId && readCanvasExtensionInstance(canvas).extensionKey
                        === generatedExtensionKey(deps, id)) {
                        deps.canvasStore.deleteCanvas(deps.workspaceId, canvas.id);
                    }
                }
                removeManagedPath(deps.dataDir, path.join(sessionWorkspacePath(deps.dataDir, deps), 'generated', id));
                removeManagedPath(deps.dataDir, generatedPackageRoot(deps.dataDir, deps, id));
                continue;
            }
        }
        const committed = readGeneratedPackage(deps.dataDir, deps, id);
        if (committed && (committed.status === 'deleting' || !referenced.has(committed.extension.extensionKey))) {
            for (const record of listCanvasExtensionInstances(deps.canvasStore, deps)) {
                if (record.instance.extensionKey === committed.extension.extensionKey) {deps.canvasStore.deleteCanvas(deps.workspaceId, record.canvas.id); }
            }
            removeManagedPath(deps.dataDir, path.join(sessionWorkspacePath(deps.dataDir, deps), 'generated', id));
            removeManagedPath(deps.dataDir, generatedPackageRoot(deps.dataDir, deps, id));
        } else if (committed) {pruneRevisions(deps, committed); }
        else {
            removeManagedPath(deps.dataDir, path.join(sessionWorkspacePath(deps.dataDir, deps), 'generated', id));
            removeManagedPath(deps.dataDir, generatedPackageRoot(deps.dataDir, deps, id));
        }
    }
}

export function publishGeneratedCanvas(deps: CanvasExtensionInstanceDeps, args: PublishGeneratedCanvasArgs, requestSignal?: AbortSignal) {
    return deps.hosts.runPublication(deps, requestSignal, (signal, lease) => runCanvasExtensionOperation(deps, async () => {
        const check = () => { signal.throwIfAborted(); lease(); };
        check();
        const keys = new Set(['sourcePath', 'canvasId', 'expectedRevision', 'declaredCanvasId', 'input', 'assets']);
        if (!args || Object.keys(args).some(key => !keys.has(key))) { throw new Error('Invalid extension_canvas arguments'); }
        if (args.canvasId !== undefined && (typeof args.canvasId !== 'string' || !args.canvasId.trim())) { throw new Error('canvasId must be a non-empty string'); }
        if (args.input !== undefined && (!args.input || typeof args.input !== 'object' || Array.isArray(args.input))) { throw new Error('input must be an object'); }
        const context = await generatedSourceContext(deps.dataDir, deps, deps.processStore);
        check();
        reconcileGeneratedPublications(deps);
        const saved = listCanvasExtensionInstances(deps.canvasStore, deps);
        const target = args.canvasId ? saved.find(record => record.canvas.id === args.canvasId) : undefined;
        if (args.canvasId && !target) { throw new Error('Generated canvas is unavailable in this conversation'); }
        const previous = target ? listGeneratedPackages(deps.dataDir, deps).find(item => item.extension.extensionKey === target.instance.extensionKey) : undefined;
        if (target && args.declaredCanvasId !== undefined && args.declaredCanvasId !== target.instance.canvasId) { throw new Error('declaredCanvasId cannot replace saved identity'); }
        if (target && !previous) { throw new Error('Only generated canvases can be replaced'); }
        if (target && (!Number.isInteger(args.expectedRevision) || args.expectedRevision !== target.canvas.revision)) {
            throw Object.assign(new Error('Publication revision conflict'), { data: { code: 'revision-conflict', message: 'Read the canvas and retry with its current revision' } });
        }
        if (!target && (typeof args.declaredCanvasId !== 'string' || !args.declaredCanvasId.trim())) { throw new Error('declaredCanvasId is required on create'); }
        const candidate = stageGeneratedPackage(deps.dataDir, deps, context, args, previous?.id);
        candidate.extension.skipSavedInstances = true;
        const related = previous ? saved.filter(record => record.instance.extensionKey === previous.extension.extensionKey) : [];
        const journal: Journal = { candidate: publication(candidate), previous: previous && publication(previous), records: related.map(record => record.canvas), ...(!target ? { createdCanvasId: `generated-${candidate.id}` } : {}) };
        let retired = false;
        let created: CanvasRecord | undefined;
        let committed = false;
        const validation = { ...candidate.extension, extensionKey: `${candidate.extension.extensionKey}:candidate:${candidate.revision}` };
        const cancel = () => {
            void deps.hosts.reset(deps, validation).catch(() => {});
            if (!previous || retired) {void deps.hosts.reset(deps, candidate.extension).catch(() => {}); }
        };
        signal?.addEventListener('abort', cancel, { once: true });
        try {
            writeJournal(deps, journal);
            await checkGeneratedSyntax(candidate.sourcePath, signal);
            check();
            // Candidate declaration inspection uses a separate key, so incompatible updates leave the live runtime intact.
            let declarations;
            try { declarations = await deps.hosts.declarations(deps, validation); }
            finally { await deps.hosts.reset(deps, validation); }
            check();
            const declaredCanvasId = target?.instance.canvasId ?? args.declaredCanvasId!;
            if (!declarations.some(item => item.id === declaredCanvasId)
                || related.some(record => !declarations.some(item => item.id === record.instance.canvasId))) { throw new Error('Requested or retained declaration is missing'); }
            if (previous) { retired = true; await deps.hosts.reset(deps, previous.extension); }
            check();
            const open = related.filter(record => !record.instance.closed || record.canvas.id === target?.canvas.id);
            const reloadId = randomUUID();
            const updated: { existing?: CanvasRecord; instance: ReturnType<typeof readCanvasExtensionInstance> }[] = [];
            for (const record of open) {
                const input = record.canvas.id === target?.canvas.id ? args.input ?? record.instance.input : record.instance.input;
                const result = await deps.hosts.open(deps, candidate.extension, { canvasId: record.instance.canvasId, instanceId: record.instance.instanceId, input });
                check();
                updated.push({ existing: record.canvas, instance: { ...record.instance, input, closed: undefined,
                    title: result.title ?? record.instance.title, runtimeReload: { id: reloadId } } });
            }
            // Closed siblings remain closed, but also advance revision to invalidate stale authoring reads.
            for (const record of related.filter(record => record.instance.closed && record.canvas.id !== target?.canvas.id)) {
                updated.push({ existing: record.canvas, instance: { ...record.instance } });
            }
            if (!target) {
                const instanceId = randomUUID();
                const result = await deps.hosts.open(deps, candidate.extension, { canvasId: declaredCanvasId, instanceId, input: args.input });
                check();
                updated.push({ instance: { extensionKey: candidate.extension.extensionKey, canvasId: declaredCanvasId, instanceId,
                    input: args.input, title: result.title ?? declarations.find(item => item.id === declaredCanvasId)!.displayName } });
            }
            check();
            // No awaits between the journal, durable records and publication commit.
            const written = updated.map(item => {
                const canvas = persistCanvasExtensionInstance(deps, item.instance, item.existing, { silent: true, recordId: journal.createdCanvasId });
                if (!target) {created = canvas; }
                return canvas;
            });
            writeGeneratedPublication(deps.dataDir, deps, candidate);
            fs.unlinkSync(journalPath(deps, candidate.id));
            committed = true;
            for (const canvas of written) {deps.notifier.canvasUpdated(deps.workspaceId, canvas, 'ai', target ? { refreshOnly: true } : undefined); }
            try { pruneRevisions(deps, candidate); } catch (cleanupError) { getServerLogger().warn({ error: cleanupError }, 'Generated revision cleanup will retry at startup'); }
            const canvas = target ? written.find(item => item.id === target.canvas.id)! : created!;
            return { success: true, canvasId: canvas.id, instanceId: readCanvasExtensionInstance(canvas).instanceId,
                extensionKey: candidate.extension.extensionKey, declaredCanvasId, revision: canvas.revision, embed: `canvas://${canvas.id}` };
        } catch (error) {
            if (committed) { throw error; }
            try {
                if (!previous || retired) {await deps.hosts.reset(deps, candidate.extension).catch(() => {}); }
                let active = true;
                try { lease(); } catch { active = false; }
                if (created) {deps.canvasStore.deleteCanvas(deps.workspaceId, created.id); }
                if (previous && retired && active && !signal?.aborted) {
                    for (const record of related) {
                        const current = deps.canvasStore.getCanvas(deps.workspaceId, record.canvas.id);
                        if (current) {persistCanvasExtensionInstance(deps, { ...record.instance,
                            runtimeReload: { id: randomUUID(), error: 'Replacement failed. Reload to retry committed source.' },
                        }, current, { refreshOnly: true }); }
                    }
                }
                if (previous && active) {writeGeneratedPublication(deps.dataDir, deps, { ...publication(previous), status: retired ? 'failed' : previous.status }); }
                const root = generatedPackageRoot(deps.dataDir, deps, candidate.id);
                if (previous) {
                    removeManagedPath(deps.dataDir, path.join(root, 'revisions', candidate.revision));
                    fs.rmSync(journalPath(deps, candidate.id), { force: true });
                } else {
                    removeManagedPath(deps.dataDir, path.join(sessionWorkspacePath(deps.dataDir, deps), 'generated', candidate.id));
                    removeManagedPath(deps.dataDir, root);
                }
            } catch (cleanupError) { getServerLogger().warn({ error: cleanupError }, 'Generated publication cleanup failed; journal retained'); }
            throw error;
        } finally { signal?.removeEventListener('abort', cancel); }
    }));
}

/** Caller holds owner queue; installed keys are deliberately rejected. */
export async function deleteGeneratedCanvas(deps: CanvasExtensionInstanceDeps, extensionKey: string) {
    const item = listGeneratedPackages(deps.dataDir, deps).find(candidate => candidate.extension.extensionKey === extensionKey);
    if (!item) { throw new Error('Permanent deletion is only available for generated canvases'); }
    writeGeneratedPublication(deps.dataDir, deps, { ...publication(item), status: 'deleting' });
    await deps.hosts.reset(deps, item.extension);
    const records = listCanvasExtensionInstances(deps.canvasStore, deps).filter(record => record.instance.extensionKey === extensionKey);
    for (const record of records) {deps.canvasStore.deleteCanvas(deps.workspaceId, record.canvas.id); }
    removeManagedPath(deps.dataDir, path.join(sessionWorkspacePath(deps.dataDir, deps), 'generated', item.id));
    removeManagedPath(deps.dataDir, generatedPackageRoot(deps.dataDir, deps, item.id));
    for (const record of records) {deps.notifier.canvasUpdated(deps.workspaceId, record.canvas, 'ai', { refreshOnly: true }); }
    return { success: true, removedCanvasIds: records.map(record => record.canvas.id) };
}
