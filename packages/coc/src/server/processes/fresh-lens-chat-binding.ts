import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { badRequest, notFound } from '../errors';

interface ArchiveCapableProcessStore extends ProcessStore {
    archiveProcess(id: string): void;
}

export interface LensChatBinding {
    taskId: string;
}

export interface StartFreshLensChatOptions {
    store: ProcessStore;
    workspaceId: string;
    binding: LensChatBinding | undefined;
    unbind: () => boolean;
}

function hasArchiveProcess(store: ProcessStore): store is ArchiveCapableProcessStore {
    const candidate = store as ProcessStore & { archiveProcess?: unknown };
    return typeof candidate.archiveProcess === 'function';
}

export async function startFreshLensChat(options: StartFreshLensChatOptions): Promise<string | null> {
    const { store, workspaceId, binding, unbind } = options;
    if (!binding) {
        throw notFound('Binding');
    }
    if (!hasArchiveProcess(store)) {
        throw badRequest('Fresh lens chat is not supported by this process store');
    }

    const process = await store.getProcess(binding.taskId, workspaceId);
    if (!process) {
        unbind();
        return null;
    }

    store.archiveProcess(binding.taskId);
    unbind();
    return binding.taskId;
}
