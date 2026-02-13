/**
 * Deep Wiki Generator — Core Types
 *
 * All shared interfaces for the deep-wiki CLI.
 * These types define the data model for the five-phase pipeline:
 *   Phase 1: Discovery      → ModuleGraph
 *   Phase 2: Consolidation  → Reduced ModuleGraph
 *   Phase 3: Analysis       → ModuleAnalysis[]
 *   Phase 4: Writing        → Wiki articles on disk
 *   Phase 5: Website        → Static HTML site
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { TokenUsage } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Phase 1: Discovery Types
// ============================================================================

/**
 * High-level project information inferred from config files and README.
 */
export interface ProjectInfo {
    /** Project name (from package.json, Cargo.toml, etc.) */
    name: string;
    /** Brief description inferred from README or config */
    description: string;
    /** Primary programming language */
    language: string;
    /** Build system (e.g., "npm + webpack", "cargo", "go modules") */
    buildSystem: string;
    /** Entry point files relative to repo root */
    entryPoints: string[];
}

/**
 * A single module/package/directory in the codebase.
 */
export interface ModuleInfo {
    /** Unique lowercase kebab-case identifier */
    id: string;
    /** Human-readable module name */
    name: string;
    /** Path relative to repo root (e.g., "src/auth/") */
    path: string;
    /** One-sentence purpose description */
    purpose: string;
    /** Key files in this module (relative to repo root) */
    keyFiles: string[];
    /** IDs of modules this module depends on */
    dependencies: string[];
    /** IDs of modules that depend on this module */
    dependents: string[];
    /** Complexity level */
    complexity: 'low' | 'medium' | 'high';
    /** Category this module belongs to */
    category: string;
    /** Area slug from large-repo discovery (only set for large repos) */
    area?: string;
    /** Optional line ranges for monolithic files — [[start, end], ...] */
    lineRanges?: [number, number][];
    /** IDs of original modules merged into this one (set by consolidation phase) */
    mergedFrom?: string[];
}

/**
 * A named category for grouping modules.
 */
export interface CategoryInfo {
    /** Category name (e.g., "core", "infra", "api") */
    name: string;
    /** Short description of what this category contains */
    description: string;
}

/**
 * Information about a top-level area in a large repo.
 * Used to organize modules into hierarchical wiki output.
 */
export interface AreaInfo {
    /** Unique kebab-case identifier (derived from area path) */
    id: string;
    /** Human-readable area name */
    name: string;
    /** Path relative to repo root */
    path: string;
    /** Brief description of the area */
    description: string;
    /** IDs of modules belonging to this area */
    modules: string[];
}

/**
 * The complete module graph — output of Phase 1 (Discovery).
 */
export interface ModuleGraph {
    /** High-level project information */
    project: ProjectInfo;
    /** All discovered modules */
    modules: ModuleInfo[];
    /** Module categories */
    categories: CategoryInfo[];
    /** Architecture notes (free-text summary) */
    architectureNotes: string;
    /** Top-level areas (only present for large repos with 3000+ files) */
    areas?: AreaInfo[];
}

/**
 * Options for the discovery phase.
 */
export interface DiscoveryOptions {
    /** Absolute path to the local repository */
    repoPath: string;
    /** AI model to use (optional, SDK default if omitted) */
    model?: string;
    /** Timeout in milliseconds for discovery session (default: 300000 = 5 min) */
    timeout?: number;
    /** Focus discovery on a specific subtree (e.g., "src/") */
    focus?: string;
    /** Maximum parallel sessions for large-repo drill-down */
    concurrency?: number;
    /** Output directory for cache (when provided, enables incremental caching) */
    outputDir?: string;
    /** Current git hash for cache validation (when provided with outputDir) */
    gitHash?: string;
    /** Use cached results regardless of git hash (--use-cache mode) */
    useCache?: boolean;
}

/**
 * Result of the discovery phase.
 */
export interface DiscoveryResult {
    /** The discovered module graph */
    graph: ModuleGraph;
    /** Total duration in milliseconds */
    duration: number;
    /** Token usage information (if available from SDK) */
    tokenUsage?: TokenUsage;
}

// ============================================================================
// CLI Configuration
// ============================================================================

/**
 * Full configuration for the deep-wiki CLI.
 */
export interface DeepWikiConfig {
    /** Output directory for generated wiki */
    output: string;
    /** Number of parallel AI sessions */
    concurrency: number;
    /** AI model to use */
    model?: string;
    /** Focus on a specific subtree */
    focus?: string;
    /** Article detail level */
    depth: 'shallow' | 'normal' | 'deep';
    /** Cache directory (default: <output>/.wiki-cache/) */
    cache?: string;
    /** Ignore cache, regenerate everything */
    force: boolean;
    /** Always use existing cache regardless of git hash */
    useCache: boolean;
    /** Start from phase N (1, 2, 3, or 4) */
    phase: number;
}

/**
 * Schema for the `deep-wiki.config.yaml` configuration file.
 * All fields are optional — unset fields use CLI flags or defaults.
 */
export interface DeepWikiConfigFile {
    /** Repository path (can be overridden by CLI positional argument) */
    repoPath?: string;
    /** Output directory */
    output?: string;
    /** Global default AI model */
    model?: string;
    /** Number of parallel AI sessions */
    concurrency?: number;
    /** Timeout in seconds */
    timeout?: number;
    /** Article detail level */
    depth?: 'shallow' | 'normal' | 'deep';
    /** Use cache regardless of git hash */
    useCache?: boolean;
    /** Ignore cache, regenerate everything */
    force?: boolean;
    /** Focus on a specific subtree */
    focus?: string;
    /** Path to seeds file, or "auto" to generate */
    seeds?: string;
    /** Skip module consolidation */
    noCluster?: boolean;
    /** Strict mode: fail on any module failure */
    strict?: boolean;
    /** Skip website generation */
    skipWebsite?: boolean;
    /** Website theme */
    theme?: 'light' | 'dark' | 'auto';
    /** Override project name in website title */
    title?: string;
    /** Start from phase N */
    phase?: number;
    /** End at phase N (only run phases from `phase` to `endPhase` inclusive) */
    endPhase?: number;
    /** Per-phase configuration overrides */
    phases?: PhasesConfig;
}

// ============================================================================
// Discovery Command Options
// ============================================================================

/**
 * Options for the `deep-wiki discover` command.
 */
export interface DiscoverCommandOptions {
    /** Output directory */
    output: string;
    /** AI model override */
    model?: string;
    /** Timeout in seconds */
    timeout?: number;
    /** Focus subtree */
    focus?: string;
    /** Force re-discovery (ignore cache) */
    force: boolean;
    /** Always use existing cache regardless of git hash */
    useCache: boolean;
    /** Verbose logging */
    verbose: boolean;
    /** Path to seeds file for breadth-first discovery, or "auto" to generate */
    seeds?: string;
}

// ============================================================================
// Large Repo Types
// ============================================================================

/**
 * A top-level area identified during the first pass of large repo discovery.
 */
export interface TopLevelArea {
    /** Area name (e.g., "packages/core") */
    name: string;
    /** Path relative to repo root */
    path: string;
    /** Brief description */
    description: string;
}

/**
 * Result of the structural scan (first pass) for large repos.
 */
export interface StructuralScanResult {
    /** Estimated total file count */
    fileCount: number;
    /** Identified top-level areas */
    areas: TopLevelArea[];
    /** Project-level info gathered during scan */
    projectInfo: Partial<ProjectInfo>;
}

// ============================================================================
// Phase 3: Analysis Types (detail types colocated in analysis/types.ts)
// ============================================================================

// Re-export analysis detail types for backward compatibility
export type { KeyConcept, PublicAPIEntry, CodeExample, InternalDependency, ExternalDependency } from './analysis/types';

// Import for use in ModuleAnalysis below
import type { KeyConcept, PublicAPIEntry, CodeExample, InternalDependency, ExternalDependency } from './analysis/types';

/**
 * Deep analysis result for a single module — output of Phase 3 per-module AI session.
 */
export interface ModuleAnalysis {
    /** Module ID (matches ModuleInfo.id) */
    moduleId: string;
    /** High-level overview paragraph */
    overview: string;
    /** Key concepts and abstractions */
    keyConcepts: KeyConcept[];
    /** Public API entries */
    publicAPI: PublicAPIEntry[];
    /** Internal architecture description */
    internalArchitecture: string;
    /** Data flow description */
    dataFlow: string;
    /** Design patterns used */
    patterns: string[];
    /** Error handling strategy */
    errorHandling: string;
    /** Illustrative code examples */
    codeExamples: CodeExample[];
    /** Dependencies (internal + external) */
    dependencies: {
        internal: InternalDependency[];
        external: ExternalDependency[];
    };
    /** Suggested Mermaid diagram for the module */
    suggestedDiagram: string;
    /** All source files examined during analysis (repo-relative paths) */
    sourceFiles?: string[];
}

/**
 * Options for the analysis phase (Phase 3).
 */
export interface AnalysisOptions {
    /** The discovered module graph */
    graph: ModuleGraph;
    /** AI model to use */
    model?: string;
    /** Timeout per module in milliseconds (default: 180000 = 3 min) */
    timeout?: number;
    /** Maximum parallel AI sessions (default: 5) */
    concurrency?: number;
    /** Analysis depth */
    depth?: 'shallow' | 'normal' | 'deep';
    /** Absolute path to the repository */
    repoPath: string;
}

/**
 * Result of the analysis phase (Phase 3).
 */
export interface AnalysisResult {
    /** Per-module analysis results */
    analyses: ModuleAnalysis[];
    /** Total duration in milliseconds */
    duration: number;
    /** Token usage information (if available) */
    tokenUsage?: TokenUsage;
}

// ============================================================================
// Phase 4: Writing Types
// ============================================================================

/**
 * Type of generated article.
 */
export type ArticleType = 'module' | 'index' | 'architecture' | 'getting-started' | 'area-index' | 'area-architecture';

/**
 * A single generated wiki article.
 */
export interface GeneratedArticle {
    /** Article type */
    type: ArticleType;
    /** URL-safe slug for the filename */
    slug: string;
    /** Human-readable title */
    title: string;
    /** Markdown content */
    content: string;
    /** Module ID (only for module articles) */
    moduleId?: string;
    /** Area ID (for area-level and module articles in hierarchical layout) */
    areaId?: string;
}

/**
 * Options for the writing phase (Phase 4).
 */
export interface WritingOptions {
    /** The discovered module graph */
    graph: ModuleGraph;
    /** Per-module analysis results */
    analyses: ModuleAnalysis[];
    /** AI model to use */
    model?: string;
    /** Maximum parallel AI sessions (default: 5) */
    concurrency?: number;
    /** Timeout per article in milliseconds (default: 120000 = 2 min) */
    timeout?: number;
    /** Article depth */
    depth?: 'shallow' | 'normal' | 'deep';
}

/**
 * Output of the writing phase (Phase 4).
 */
export interface WikiOutput {
    /** All generated articles */
    articles: GeneratedArticle[];
    /** Total duration in milliseconds */
    duration: number;
    /** Module IDs that failed article generation (empty when all succeed) */
    failedModuleIds?: string[];
}

// ============================================================================
// Phase 5: Website Generation Types
// ============================================================================

/**
 * Theme for the generated website.
 */
export type WebsiteTheme = 'light' | 'dark' | 'auto';

/**
 * Options for the website generation phase.
 */
export interface WebsiteOptions {
    /** Theme for the generated website (default: 'auto') */
    theme?: WebsiteTheme;
    /** Override project name in website title */
    title?: string;
    /** Disable search functionality */
    noSearch?: boolean;
    /** Path to a custom HTML template */
    customTemplate?: string;
}

// ============================================================================
// Per-Phase Configuration
// ============================================================================

/**
 * Phase names used as keys in per-phase configuration.
 */
export type PhaseName = 'discovery' | 'consolidation' | 'analysis' | 'writing';

/**
 * Per-phase configuration overrides.
 * All fields are optional — unset fields fall back to the global config or defaults.
 */
export interface PhaseConfig {
    /** AI model override for this phase */
    model?: string;
    /** Timeout in seconds for this phase */
    timeout?: number;
    /** Number of parallel AI sessions for this phase */
    concurrency?: number;
    /** Article detail level for this phase (only applies to analysis/writing) */
    depth?: 'shallow' | 'normal' | 'deep';
    /** Skip AI clustering (only applies to consolidation) */
    skipAI?: boolean;
}

/**
 * Map of phase-specific configuration overrides.
 */
export type PhasesConfig = Partial<Record<PhaseName, PhaseConfig>>;

// ============================================================================
// Generate Command Options
// ============================================================================

/**
 * Options for the `deep-wiki generate` command.
 */
export interface GenerateCommandOptions {
    /** Output directory */
    output: string;
    /** AI model override */
    model?: string;
    /** Number of parallel AI sessions */
    concurrency?: number;
    /** Timeout in seconds per phase */
    timeout?: number;
    /** Focus on a specific subtree */
    focus?: string;
    /** Article detail level */
    depth: 'shallow' | 'normal' | 'deep';
    /** Ignore cache, regenerate everything */
    force: boolean;
    /** Always use existing cache regardless of git hash */
    useCache: boolean;
    /** Start from phase N (1, 2, 3, or 4) */
    phase?: number;
    /** End at phase N (1, 2, 3, 4, or 5). Only runs phases from `phase` to `endPhase` inclusive. */
    endPhase?: number;
    /** Verbose logging */
    verbose: boolean;
    /** Skip website generation (Phase 5) */
    skipWebsite?: boolean;
    /** Website theme */
    theme?: WebsiteTheme;
    /** Override website title */
    title?: string;
    /** Path to seeds file for breadth-first discovery, or "auto" to generate */
    seeds?: string;
    /** Skip module consolidation (Phase 2) — keep original module granularity */
    noCluster?: boolean;
    /** Strict mode: fail the pipeline if any module fails after retries (default: true) */
    strict?: boolean;
    /** Path to YAML configuration file */
    config?: string;
    /** Per-phase configuration overrides */
    phases?: PhasesConfig;
}

/**
 * A single topic seed — an architectural concern/module identified during Phase 0.
 */
export interface TopicSeed {
    /** Short kebab-case identifier (e.g., "authentication", "api-gateway") */
    topic: string;
    /** 1-2 sentence description of the topic */
    description: string;
    /** Comma-separated or array of search terms to find related code */
    hints: string[];
}

/**
 * Output of Phase 0 — the seeds file structure.
 */
export interface SeedsOutput {
    /** Deep-wiki version that generated these seeds */
    version: string;
    /** Timestamp when seeds were generated */
    timestamp: number;
    /** Repository path used for generation */
    repoPath: string;
    /** The discovered topic seeds */
    topics: TopicSeed[];
}

/**
 * Options for the `deep-wiki seeds` command.
 */
export interface SeedsCommandOptions {
    /** Output file path (default: "seeds.json") */
    output: string;
    /** Maximum number of topics to generate (default: 50) */
    maxTopics: number;
    /** AI model override */
    model?: string;
    /** Timeout in seconds for seeds session */
    timeout?: number;
    /** Verbose logging */
    verbose: boolean;
}

// ============================================================================
// Iterative Discovery Types (colocated in discovery/iterative/types.ts)
// ============================================================================

// Re-export iterative discovery types for backward compatibility
export type { TopicProbeResult, ProbeFoundModule, DiscoveredTopic, IterativeDiscoveryOptions, MergeResult } from './discovery/iterative/types';

// ============================================================================
// Serve Command Options (colocated in server/types.ts)
// ============================================================================

// Re-export serve command types for backward compatibility
export type { ServeCommandOptions } from './server/types';

// ============================================================================
// Cache Types (colocated in cache/types.ts)
// ============================================================================

// Re-export cache types for backward compatibility
export type {
    CacheMetadata,
    CachedGraph,
    AnalysisCacheMetadata,
    CachedAnalysis,
    CachedArticle,
    CachedConsolidation,
    CachedProbeResult,
    CachedSeeds,
    CachedStructuralScan,
    CachedAreaGraph,
    DiscoveryProgressMetadata,
} from './cache/types';

// ============================================================================
// Phase 2: Module Consolidation Types (colocated in consolidation/types.ts)
// ============================================================================

// Re-export consolidation types for backward compatibility
export type { ConsolidationOptions, ConsolidationResult, ClusterGroup } from './consolidation/types';
