/**
 * Types for the Auto AI Discovery feature
 * 
 * This module provides types for automatically discovering files, docs, and commits
 * related to a feature using AI-powered relevance scoring with keyword fallback.
 */

/**
 * Type of discoverable source
 */
export type DiscoverySourceType = 'file' | 'folder' | 'commit' | 'doc';

/**
 * Commit information for discovery results
 */
export interface DiscoveryCommitInfo {
    /** Full commit hash */
    hash: string;
    /** Short commit hash (7 chars) */
    shortHash: string;
    /** Commit subject/message */
    subject: string;
    /** Author name */
    authorName: string;
    /** Commit date (ISO string) */
    date: string;
    /** Repository root path */
    repositoryRoot: string;
}

/**
 * A single discovery result
 */
export interface DiscoveryResult {
    /** Unique identifier for this result */
    id: string;
    /** Type of discovered item */
    type: DiscoverySourceType;
    /** Display name */
    name: string;
    /** File/folder path (for file/folder/doc types) */
    path?: string;
    /** Commit information (for commit type) */
    commit?: DiscoveryCommitInfo;
    /** Relevance score (0-100) */
    relevanceScore: number;
    /** Keywords that matched this result */
    matchedKeywords: string[];
    /** Human-readable reason for relevance */
    relevanceReason: string;
    /** Whether this result is selected for adding to group */
    selected: boolean;
}

/**
 * Existing group item snapshot for bypassing in discovery
 */
export interface ExistingGroupItem {
    /** Item type */
    type: 'file' | 'folder' | 'commit';
    /** Path for files/folders */
    path?: string;
    /** Commit hash for commits */
    commitHash?: string;
}

/**
 * Existing group snapshot for context in discovery
 */
export interface ExistingGroupSnapshot {
    /** Group name */
    name: string;
    /** Group description */
    description?: string;
    /** Items already in the group to bypass */
    items: ExistingGroupItem[];
}

/**
 * Scope configuration for discovery
 */
export interface DiscoveryScope {
    /** Include source code files (.ts, .js, .py, etc.) */
    includeSourceFiles: boolean;
    /** Include documentation files (.md, .txt, .rst, etc.) */
    includeDocs: boolean;
    /** Include config files (package.json, tsconfig.json, etc.) */
    includeConfigFiles: boolean;
    /** Include git commit history */
    includeGitHistory: boolean;
    /** Maximum number of commits to search */
    maxCommits: number;
    /** Glob patterns to exclude from search */
    excludePatterns: string[];
}

/**
 * Default discovery scope configuration
 */
export const DEFAULT_DISCOVERY_SCOPE: DiscoveryScope = {
    includeSourceFiles: true,
    includeDocs: true,
    includeConfigFiles: true,
    includeGitHistory: true,
    maxCommits: 50,
    excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/out/**', '**/build/**']
};

/**
 * Request for discovery operation
 */
export interface DiscoveryRequest {
    /** Natural language description of the feature */
    featureDescription: string;
    /** Optional additional keywords to search for */
    keywords?: string[];
    /** Scope configuration */
    scope: DiscoveryScope;
    /** Optional target group path to add results to */
    targetGroupPath?: string;
    /** Repository root path */
    repositoryRoot: string;
    /** Optional existing group snapshot - items to bypass in discovery results */
    existingGroupSnapshot?: ExistingGroupSnapshot;
}

/**
 * Current phase of the discovery process
 */
export type DiscoveryPhase = 
    | 'initializing' 
    | 'extracting-keywords' 
    | 'scanning-files' 
    | 'scanning-git' 
    | 'scoring-relevance' 
    | 'completed';

/**
 * Status of a discovery process
 */
export type DiscoveryStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * A tracked discovery process
 */
export interface DiscoveryProcess {
    /** Unique identifier */
    id: string;
    /** Current status */
    status: DiscoveryStatus;
    /** Feature description being searched */
    featureDescription: string;
    /** Current phase of discovery */
    phase: DiscoveryPhase;
    /** Progress percentage (0-100) */
    progress: number;
    /** Discovery results (when completed) */
    results?: DiscoveryResult[];
    /** Error message (if failed) */
    error?: string;
    /** When the process started */
    startTime: Date;
    /** When the process ended (if finished) */
    endTime?: Date;
    /** Target group path for adding results (optional) */
    targetGroupPath?: string;
}

/**
 * Configuration for relevance scoring
 */
export interface RelevanceScoringConfig {
    /** Weight for keyword-based scoring (0-1) */
    keywordWeight: number;
    /** Weight for AI-based scoring (0-1) */
    aiWeight: number;
    /** Minimum score threshold to include in results */
    minScore: number;
    /** Maximum number of results to return */
    maxResults: number;
}

/**
 * Default relevance scoring configuration
 */
export const DEFAULT_SCORING_CONFIG: RelevanceScoringConfig = {
    keywordWeight: 0.4,
    aiWeight: 0.6,
    minScore: 30,
    maxResults: 50
};

/**
 * Raw search result before scoring
 */
export interface RawSearchResult {
    /** Type of result */
    type: DiscoverySourceType;
    /** Display name */
    name: string;
    /** File/folder path (for file/folder/doc types) */
    path?: string;
    /** Commit information (for commit type) */
    commit?: DiscoveryCommitInfo;
    /** Content snippet for matching (file content, commit message, etc.) */
    contentSnippet?: string;
}

/**
 * Keyword extraction result
 */
export interface KeywordExtractionResult {
    /** Extracted keywords */
    keywords: string[];
    /** Whether AI was used for extraction */
    usedAI: boolean;
}

/**
 * Event types for discovery process changes
 */
export type DiscoveryEventType = 
    | 'process-started' 
    | 'process-updated' 
    | 'process-completed' 
    | 'process-failed' 
    | 'process-cancelled';

/**
 * Discovery process change event
 */
export interface DiscoveryEvent {
    type: DiscoveryEventType;
    process: DiscoveryProcess;
}

/**
 * Serialized format of DiscoveryProcess for persistence
 */
export interface SerializedDiscoveryProcess {
    id: string;
    status: DiscoveryStatus;
    featureDescription: string;
    phase: DiscoveryPhase;
    progress: number;
    results?: DiscoveryResult[];
    error?: string;
    startTime: string; // ISO string
    endTime?: string; // ISO string
    targetGroupPath?: string;
}

/**
 * Convert DiscoveryProcess to serialized format for storage
 */
export function serializeDiscoveryProcess(process: DiscoveryProcess): SerializedDiscoveryProcess {
    return {
        id: process.id,
        status: process.status,
        featureDescription: process.featureDescription,
        phase: process.phase,
        progress: process.progress,
        results: process.results,
        error: process.error,
        startTime: process.startTime.toISOString(),
        endTime: process.endTime?.toISOString(),
        targetGroupPath: process.targetGroupPath
    };
}

/**
 * Convert serialized format back to DiscoveryProcess
 */
export function deserializeDiscoveryProcess(serialized: SerializedDiscoveryProcess): DiscoveryProcess {
    return {
        id: serialized.id,
        status: serialized.status,
        featureDescription: serialized.featureDescription,
        phase: serialized.phase,
        progress: serialized.progress,
        results: serialized.results,
        error: serialized.error,
        startTime: new Date(serialized.startTime),
        endTime: serialized.endTime ? new Date(serialized.endTime) : undefined,
        targetGroupPath: serialized.targetGroupPath
    };
}

