import type { AIProcess } from '@plusplusoneplusplus/forge';
import { extractMapReducePlanArtifactFromText } from '@plusplusoneplusplus/coc-client';
import { isMapReduceGenerationContext } from '../tasks/task-types';
import type { MapReduceContext, MapReduceGenerationContext } from '../tasks/task-types';

type ProcessMetadata = AIProcess['metadata'];

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as T;
}

export function updateMapReduceGenerationMetadataFromAssistantTurn(
    metadata: ProcessMetadata | undefined,
    assistantContent: string,
    turnIndex: number,
    now = new Date(),
): ProcessMetadata | undefined {
    const current = metadata ? { ...metadata } : undefined;
    const currentMapReduce = current?.mapReduce as MapReduceContext | null | undefined;
    if (!isMapReduceGenerationContext(currentMapReduce)) {
        return undefined;
    }

    const result = extractMapReducePlanArtifactFromText(assistantContent, turnIndex);
    let nextMapReduce: MapReduceGenerationContext;

    if (result.plan) {
        nextMapReduce = stripUndefined({
            ...currentMapReduce,
            latestItemCount: result.plan.items.length,
            latestPlanTurnIndex: result.plan.turnIndex,
            latestPlan: stripUndefined({
                turnIndex: result.plan.turnIndex,
                items: result.plan.items,
                childMode: result.plan.childMode ?? currentMapReduce.childMode,
                sharedInstructions: result.plan.sharedInstructions,
                reduceInstructions: result.plan.reduceInstructions,
                maxParallel: result.plan.maxParallel,
                rawJson: result.plan.rawJson,
                updatedAt: now.toISOString(),
            }),
            lastPlanError: undefined,
            lastPlanErrorTurnIndex: undefined,
        });
    } else if (result.error) {
        nextMapReduce = stripUndefined({
            ...currentMapReduce,
            lastPlanError: result.error.message,
            lastPlanErrorTurnIndex: result.error.turnIndex,
        });
    } else {
        return undefined;
    }

    return {
        ...current,
        mapReduce: nextMapReduce,
    } as ProcessMetadata;
}
