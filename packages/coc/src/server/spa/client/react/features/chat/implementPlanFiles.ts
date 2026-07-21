export interface SwitchablePlanFilesInput {
    detectedPlanFiles: string[];
    explicitPlanPath?: string;
    effectivePlanCanvasId?: string;
}

/**
 * Keep explicit task plans and canvas plans single-file while allowing every
 * plan created during the conversation to remain selectable. A plan path that
 * was only persisted to process metadata is deliberately not an explicit path.
 */
export function resolveSwitchablePlanFiles({
    detectedPlanFiles,
    explicitPlanPath,
    effectivePlanCanvasId,
}: SwitchablePlanFilesInput): string[] {
    return explicitPlanPath || effectivePlanCanvasId ? [] : detectedPlanFiles;
}
