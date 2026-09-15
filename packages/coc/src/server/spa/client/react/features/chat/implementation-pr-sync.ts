import type { ImplementationRecord } from './ImplementPlanCard';

export interface ImplementationPrSyncAnnotation {
    chainId: string;
    prUrl: string;
    prNumber?: number;
    prState: 'open' | 'merged';
}

export function parseImplementationPrAnnotation(value: unknown): ImplementationPrSyncAnnotation | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    if (
        typeof candidate.chainId !== 'string'
        || typeof candidate.prUrl !== 'string'
        || (candidate.prState !== 'open' && candidate.prState !== 'merged')
    ) {
        return undefined;
    }
    const prNumber = typeof candidate.prNumber === 'number' && Number.isInteger(candidate.prNumber)
        ? candidate.prNumber
        : undefined;
    return {
        chainId: candidate.chainId,
        prUrl: candidate.prUrl,
        ...(prNumber !== undefined ? { prNumber } : {}),
        prState: candidate.prState,
    };
}

export function mergeImplementationPrAnnotations(
    records: ImplementationRecord[],
    annotationsByProcessId: Record<string, ImplementationPrSyncAnnotation>,
): ImplementationRecord[] {
    let changed = false;
    const updated = records.map(record => {
        const annotation = annotationsByProcessId[record.processId];
        if (!annotation || annotation.chainId !== record.prGateChainId) return record;
        if (
            record.prUrl === annotation.prUrl
            && record.prNumber === annotation.prNumber
            && record.prState === annotation.prState
        ) {
            return record;
        }
        changed = true;
        return {
            ...record,
            prUrl: annotation.prUrl,
            ...(annotation.prNumber !== undefined ? { prNumber: annotation.prNumber } : {}),
            prState: annotation.prState,
        };
    });
    return changed ? updated : records;
}
