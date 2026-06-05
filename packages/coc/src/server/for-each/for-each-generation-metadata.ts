import type { AIProcess } from '@plusplusoneplusplus/forge';
import { extractForEachPlanArtifactFromText } from '@plusplusoneplusplus/coc-client';
import { isForEachGenerationContext } from '../tasks/task-types';
import type { ForEachContext, ForEachGenerationContext } from '../tasks/task-types';

type ProcessMetadata = AIProcess['metadata'];

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as T;
}

export function updateForEachGenerationMetadataFromAssistantTurn(
    metadata: ProcessMetadata | undefined,
    assistantContent: string,
    turnIndex: number,
    now = new Date(),
): ProcessMetadata | undefined {
    const current = metadata ? { ...metadata } : undefined;
    const currentForEach = current?.forEach as ForEachContext | null | undefined;
    if (!isForEachGenerationContext(currentForEach)) {
        return undefined;
    }

    const result = extractForEachPlanArtifactFromText(assistantContent, turnIndex);
    let nextForEach: ForEachGenerationContext;

    if (result.plan) {
        nextForEach = stripUndefined({
            ...currentForEach,
            latestItemCount: result.plan.items.length,
            latestPlanTurnIndex: result.plan.turnIndex,
            latestPlan: stripUndefined({
                turnIndex: result.plan.turnIndex,
                items: result.plan.items,
                childMode: result.plan.childMode ?? currentForEach.childMode,
                sharedInstructions: result.plan.sharedInstructions,
                rawJson: result.plan.rawJson,
                updatedAt: now.toISOString(),
            }),
            lastPlanError: undefined,
            lastPlanErrorTurnIndex: undefined,
        });
    } else if (result.error) {
        nextForEach = stripUndefined({
            ...currentForEach,
            lastPlanError: result.error.message,
            lastPlanErrorTurnIndex: result.error.turnIndex,
        });
    } else {
        return undefined;
    }

    return {
        ...current,
        forEach: nextForEach,
    } as ProcessMetadata;
}
