/**
 * Deep Wiki Generator — Core Types
 *
 * All shared interfaces for the deep-wiki CLI.
 * These types define the data model for the three-phase pipeline:
 *   Phase 1: Discovery → ModuleGraph
 *   Phase 2: Analysis  → (future)
 *   Phase 3: Writing   → (future)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

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
    tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
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
    /** Start from phase N (1, 2, or 3) */
    phase: number;
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
    /** Verbose logging */
    verbose: boolean;
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
// Cache Types
// ============================================================================

/**
 * Metadata stored alongside cached results.
 */
export interface CacheMetadata {
    /** Git HEAD hash when the cache was created */
    gitHash: string;
    /** Timestamp when the cache was created */
    timestamp: number;
    /** Deep-wiki version that created the cache */
    version: string;
    /** Focus area used during discovery (undefined = full repo) */
    focus?: string;
}

/**
 * A cached module graph with metadata.
 */
export interface CachedGraph {
    /** Cache metadata */
    metadata: CacheMetadata;
    /** The cached module graph */
    graph: ModuleGraph;
}
