import { createContext, useContext } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';

export interface WorkspaceOwner {
    /** Raw id used in owner API paths and request bodies. */
    workspaceId: string;
    /** Concrete server-qualified clone key, or the raw id for an explicit local owner. */
    selectionId: string;
    /** Undefined means explicitly local, not an unresolved remote owner. */
    baseUrl?: string;
    client?: CocClient;
    rootPath?: string;
}

export const WorkspaceOwnerContext = createContext<WorkspaceOwner | null>(null);

export function useWorkspaceOwner(workspaceId?: string | null): WorkspaceOwner | null {
    const owner = useContext(WorkspaceOwnerContext);
    return owner && (workspaceId === owner.workspaceId || workspaceId === owner.selectionId) ? owner : null;
}
