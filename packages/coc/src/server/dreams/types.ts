export const DREAM_CARD_CATEGORIES = [
    'skill-or-prompt-improvement',
    'user-workflow-suggestion',
    'product-improvement',
] as const;

export type DreamCardCategory = typeof DREAM_CARD_CATEGORIES[number];

export const DREAM_CARD_STATUSES = [
    'candidate',
    'visible',
    'approved',
    'dismissed',
    'converted',
    'superseded',
] as const;

export type DreamCardStatus = typeof DREAM_CARD_STATUSES[number];

export const DREAM_REVIEW_VISIBLE_STATUSES = ['visible'] as const satisfies readonly DreamCardStatus[];

export interface DreamSourceRange {
    processId: string;
    startTurnIndex: number;
    endTurnIndex: number;
}

export type DreamConversionArtifactType =
    | 'skill-hardening-task'
    | 'note'
    | 'memory'
    | 'work-item'
    | 'other';

export interface DreamConversionLink {
    artifactType: DreamConversionArtifactType;
    artifactId: string;
    artifactUrl?: string;
    createdAt: string;
}

export interface DreamCard {
    id: string;
    workspaceId: string;
    runId?: string;
    category: DreamCardCategory;
    status: DreamCardStatus;
    sourceRanges: DreamSourceRange[];
    observedPattern: string;
    whyItMatters: string;
    recommendation: string;
    expectedImpact: string;
    confidence: number;
    dedupFingerprint: string;
    notAlreadyCoveredRationale: string;
    criticRationale?: string;
    dedupRationale?: string;
    supersededByCardId?: string;
    conversion?: DreamConversionLink;
    createdAt: string;
    updatedAt: string;
    visibleAt?: string;
    approvedAt?: string;
    dismissedAt?: string;
    convertedAt?: string;
    supersededAt?: string;
}

export interface CreateDreamCandidateInput {
    workspaceId: string;
    runId?: string;
    category: DreamCardCategory;
    sourceRanges: DreamSourceRange[];
    observedPattern: string;
    whyItMatters: string;
    recommendation: string;
    expectedImpact: string;
    confidence: number;
    dedupFingerprint?: string;
    notAlreadyCoveredRationale: string;
    criticRationale?: string;
    dedupRationale?: string;
}

export interface DreamCardListOptions {
    includeHidden?: boolean;
    statuses?: DreamCardStatus | readonly DreamCardStatus[];
}

export interface DreamPromotionOptions {
    criticRationale?: string;
    dedupRationale?: string;
}

export interface DreamSupersedeOptions {
    supersededByCardId?: string;
    dedupRationale: string;
}

export interface DreamDismissOptions {
    dedupRationale?: string;
}
