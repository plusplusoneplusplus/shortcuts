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
    /** Area slug from large-repo discovery (only set for large repos) */
    area?: string;
    /** Optional line ranges for monolithic files — [[start, end], ...] */
    lineRanges?: [number, number][];
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
    /** Always use existing cache regardless of git hash */
    useCache: boolean;
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
// Phase 2: Analysis Types
// ============================================================================

/**
 * A key concept identified in a module.
 */
export interface KeyConcept {
    /** Concept name */
    name: string;
    /** Description of the concept */
    description: string;
    /** Code reference (file:line or file path) */
    codeRef?: string;
}

/**
 * A public API entry point of a module.
 */
export interface PublicAPIEntry {
    /** Function/class/constant name */
    name: string;
    /** Type signature or declaration */
    signature: string;
    /** Description of what it does */
    description: string;
}

/**
 * An illustrative code example from a module.
 */
export interface CodeExample {
    /** Short title for the example */
    title: string;
    /** The code snippet */
    code: string;
    /** File path (relative to repo root) */
    file?: string;
    /** Line numbers [start, end] */
    lines?: [number, number];
}

/**
 * An internal dependency (another module in the same project).
 */
export interface InternalDependency {
    /** Module ID of the dependency */
    module: string;
    /** How this module uses the dependency */
    usage: string;
}

/**
 * An external dependency (third-party package).
 */
export interface ExternalDependency {
    /** Package name */
    package: string;
    /** How this module uses the package */
    usage: string;
}

/**
 * Deep analysis result for a single module — output of Phase 2 per-module AI session.
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
}

/**
 * Options for the analysis phase (Phase 2).
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
 * Result of the analysis phase (Phase 2).
 */
export interface AnalysisResult {
    /** Per-module analysis results */
    analyses: ModuleAnalysis[];
    /** Total duration in milliseconds */
    duration: number;
    /** Token usage information (if available) */
    tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

// ============================================================================
// Phase 3: Writing Types
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
 * Options for the writing phase (Phase 3).
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
 * Output of the writing phase (Phase 3).
 */
export interface WikiOutput {
    /** All generated articles */
    articles: GeneratedArticle[];
    /** Total duration in milliseconds */
    duration: number;
}

// ============================================================================
// Phase 4: Website Generation Types
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
    /** Start from phase N (1, 2, or 3) */
    phase?: number;
    /** Verbose logging */
    verbose: boolean;
    /** Skip website generation (Phase 4) */
    skipWebsite?: boolean;
    /** Website theme */
    theme?: WebsiteTheme;
    /** Override website title */
    title?: string;
    /** Path to seeds file for breadth-first discovery, or "auto" to generate */
    seeds?: string;
}

// ============================================================================
// Phase 0: Topic Seed Types
// ============================================================================

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
    /** Verbose logging */
    verbose: boolean;
}

// ============================================================================
// Iterative Discovery Types (Phase 1 with seeds)
// ============================================================================

/**
 * Result of probing a single topic in the codebase.
 */
export interface TopicProbeResult {
    /** The topic that was probed */
    topic: string;
    /** Modules found related to this topic */
    foundModules: ProbeFoundModule[];
    /** New topics discovered during probing */
    discoveredTopics: DiscoveredTopic[];
    /** IDs of other topics this topic depends on */
    dependencies: string[];
    /** Confidence level (0-1) */
    confidence: number;
}

/**
 * A module found during topic probing.
 */
export interface ProbeFoundModule {
    /** Suggested module ID (kebab-case) */
    id: string;
    /** Human-readable name */
    name: string;
    /** Path relative to repo root */
    path: string;
    /** Purpose description */
    purpose: string;
    /** Key files in this module */
    keyFiles: string[];
    /** Evidence of why this belongs to the topic */
    evidence: string;
    /** Optional line ranges for monolithic files [start, end][] */
    lineRanges?: [number, number][];
}

/**
 * A new topic discovered during probing (feeds next round).
 */
export interface DiscoveredTopic {
    /** Topic name (kebab-case) */
    topic: string;
    /** Description */
    description: string;
    /** Search hints */
    hints: string[];
    /** Where it was discovered */
    source: string;
}

/**
 * Options for iterative discovery.
 */
export interface IterativeDiscoveryOptions {
    /** Absolute path to the repository */
    repoPath: string;
    /** Initial topic seeds */
    seeds: TopicSeed[];
    /** AI model to use */
    model?: string;
    /** Timeout per probe session in milliseconds (default: 120000 = 2 min) */
    probeTimeout?: number;
    /** Timeout for merge session in milliseconds (default: 180000 = 3 min) */
    mergeTimeout?: number;
    /** Maximum parallel probe sessions (default: 5) */
    concurrency?: number;
    /** Maximum rounds of iteration (default: 3) */
    maxRounds?: number;
    /** File coverage threshold to stop (default: 0.8) */
    coverageThreshold?: number;
    /** Focus on a specific subtree */
    focus?: string;
}

/**
 * Result of the merge + gap analysis step.
 */
export interface MergeResult {
    /** The merged module graph (growing) */
    graph: ModuleGraph;
    /** New topics to probe in the next round */
    newTopics: TopicSeed[];
    /** Whether convergence was reached */
    converged: boolean;
    /** Coverage estimate (0-1) */
    coverage: number;
    /** Reason for convergence (or reason not converged) */
    reason: string;
}

// ============================================================================
// Serve Command Options
// ============================================================================

/**
 * Options for the `deep-wiki serve` command.
 */
export interface ServeCommandOptions {
    /** Port to listen on (default: 3000) */
    port?: number;
    /** Host/address to bind to (default: 'localhost') */
    host?: string;
    /** Generate wiki before serving (path to repo) */
    generate?: string;
    /** Watch repo for changes (requires --generate) */
    watch?: boolean;
    /** Enable AI Q&A and deep-dive features */
    ai?: boolean;
    /** AI model for Q&A sessions */
    model?: string;
    /** Open browser on start */
    open?: boolean;
    /** Website theme */
    theme?: string;
    /** Override project title */
    title?: string;
    /** Verbose logging */
    verbose?: boolean;
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

/**
 * Metadata for cached analyses.
 */
export interface AnalysisCacheMetadata {
    /** Git HEAD hash when analyses were created */
    gitHash: string;
    /** Timestamp when analyses were saved */
    timestamp: number;
    /** Deep-wiki version */
    version: string;
    /** Number of cached modules */
    moduleCount: number;
}

/**
 * A cached per-module analysis result.
 */
export interface CachedAnalysis {
    /** The analysis result */
    analysis: ModuleAnalysis;
    /** Git hash when this analysis was created */
    gitHash: string;
    /** Timestamp */
    timestamp: number;
}

/**
 * A cached per-module generated article.
 */
export interface CachedArticle {
    /** The generated article */
    article: GeneratedArticle;
    /** Git hash when this article was generated */
    gitHash: string;
    /** Timestamp */
    timestamp: number;
}
