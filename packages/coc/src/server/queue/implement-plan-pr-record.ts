import {
    getLogger,
    LogCategory,
    type ProcessStore,
} from '@plusplusoneplusplus/forge';

export interface ImplementationPrAnnotation {
    chainId: string;
    prUrl: string;
    prNumber?: number;
    prState: 'open' | 'merged';
}

export async function recordImplementationPrAnnotation(
    store: ProcessStore,
    processId: string | undefined,
    annotation: ImplementationPrAnnotation,
): Promise<boolean> {
    if (!processId) {
        getLogger().warn(LogCategory.TASKS, `[ImplementPlan/PR] Cannot record ${annotation.prState} state: implement process id is missing`);
        return false;
    }

    try {
        const process = await store.getProcess(processId);
        if (!process) {
            getLogger().warn(LogCategory.TASKS, `[ImplementPlan/PR] Cannot record ${annotation.prState} state: process ${processId} was not found`);
            return false;
        }
        await store.updateProcess(processId, {
            metadata: {
                ...(process.metadata ?? { type: process.type }),
                implementationPr: annotation,
            },
        });
        return true;
    } catch (error) {
        getLogger().warn(
            LogCategory.TASKS,
            `[ImplementPlan/PR] Failed to record ${annotation.prState} state for ${processId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
    }
}
