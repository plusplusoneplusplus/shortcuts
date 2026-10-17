import type { DefinitionPreviewModel } from './definitionPreview';
import { resolveFileOpenPath } from './fileIdentity';

interface EditingModel {
    scope: string;
    workspaceId: string;
    path: string;
    model: DefinitionPreviewModel;
}
const models = new Map<object, EditingModel>();
const targets = new WeakMap<object, Map<string, { entry: EditingModel; symbolCandidate: boolean }>>();

/** Only models in this concrete owner and editing session may be reused. */
export function registerEditingModel(entry: EditingModel): () => void {
    models.set(entry.model, entry);
    targets.set(entry.model, new Map());
    return () => { if (models.get(entry.model) === entry) { models.delete(entry.model); targets.delete(entry.model); } };
}

export function editingModels(scope: string): readonly EditingModel[] {
    return [...models.values()].filter(entry => entry.scope === scope);
}

export function editingModelTarget(source: object, uri: string): { workspaceId: string; path: string; symbolCandidate?: true } | null {
    const owner = models.get(source);
    if (!owner) return null;
    const grant = targets.get(source)?.get(uri);
    const target = grant?.entry
        ?? editingModels(owner.scope).find(entry => entry.model.uri.toString() === uri);
    if (target && models.get(target.model) !== target) return null;
    return target ? { workspaceId: target.workspaceId, path: target.path,
        ...(grant?.symbolCandidate ? { symbolCandidate: true } : {}) } : null;
}


/** Resolve again if another pane mounts or closes while owner I/O is pending. */
export async function resolveEditingTarget(
    scope: string,
    path: string,
    resolve: (path: string) => Promise<string>,
    signal: AbortSignal,
): Promise<{ path: string; entry?: EditingModel }> {
    for (;;) {
        signal.throwIfAborted();
        const before = editingModels(scope);
        const resolved = await resolveFileOpenPath(path, [...new Set(before.map(entry => entry.path))], resolve);
        signal.throwIfAborted();
        const after = editingModels(scope);
        if (before.length !== after.length || before.some((entry, index) => entry !== after[index])) continue;
        return { path: resolved, entry: after.find(entry => entry.path === resolved) };
    }
}

/** Grant this initiating model navigation to a target verified by its owner. */
export function allowEditingModelTarget(source: object, entry: EditingModel, symbolCandidate = false): DefinitionPreviewModel['uri'] {
    targets.get(source)?.set(entry.model.uri.toString(), { entry, symbolCandidate });
    return entry.model.uri;
}
