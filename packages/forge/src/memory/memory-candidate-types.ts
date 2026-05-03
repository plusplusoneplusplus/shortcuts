/**
 * Memory Candidate Types
 *
 * Candidate-focused lifecycle for durable memory facts captured from AI
 * sessions before they are explicitly promoted into bounded MEMORY.md.
 */

export type MemoryCandidateTarget = 'repo' | 'system';

export type MemoryCandidateStatus = 'pending' | 'promoted' | 'dropped' | 'ignored';

export interface MemoryCandidate {
    id: string;
    target: MemoryCandidateTarget;
    content: string;
    contentHash: string;
    source: string;
    workspaceId: string;
    processId: string | null;
    turnIndex: number | null;
    createdAt: string;
    lastSeenAt: string;
    signalCount: number;
    totalScore: number;
    maxScore: number;
    uniqueProcessCount: number;
    recallDays: string[];
    conceptTags: string[];
    status: MemoryCandidateStatus;
    promotedAt: string | null;
    droppedAt: string | null;
    droppedReason: string | null;
}

export interface MemoryCandidateInput {
    target: MemoryCandidateTarget;
    content: string;
    source: string;
    workspaceId: string;
    processId?: string | null;
    turnIndex?: number | null;
    score?: number;
    conceptTags?: string[];
    seenAt?: string;
}

export interface MemoryCandidateStats {
    pending: number;
    promoted: number;
    dropped: number;
    ignored: number;
    total: number;
}
