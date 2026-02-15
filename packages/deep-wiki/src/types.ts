/**
 * Deep Wiki Generator — Core Types
 *
 * All shared interfaces for the deep-wiki CLI.
 * These types define the data model for the five-phase pipeline:
 *   Phase 1: Discovery      → ComponentGraph
 *   Phase 2: Consolidation  → Reduced ComponentGraph
 *   Phase 3: Analysis       → ComponentAnalysis[]
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
 * A single component/package/directory in the codebase.
 */
export interface ComponentInfo {
    /** Unique lowercase kebab-case identifier */
    id: string;
    /** Human-readable component name */
    name: string;
    /** Path relative to repo root (e.g., "src/auth/") */
    path: string;
    /** One-sentence purpose description */
    purpose: string;
    /** Key files in this component (relative to repo root) */
    keyFiles: string[];
    /** IDs of components this component depends on */
    dependencies: string[];
    /** IDs of components that depend on this component */
    dependents: string[];
    /** Complexity level */
    complexity: 'low' | 'medium' | 'high';
    /** Category this component belongs to */
    category: string;
    /** Domain slug from large-repo discovery (only set for large repos) */
    domain?: string;
    /** Optional line ranges for monolithic files — [[start, end], ...] */
    lineRanges?: [number, number][];
    /** IDs of original components merged into this one (set by consolidation phase) */
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
export interface DomainInfo {
    /** Unique kebab-case identifier (derived from area path) */
    id: string;
    /** Human-readable area name */
    name: string;
    /** Path relative to repo root */
    path: string;
    /** Brief description of the area */
    description: string;
    /** IDs of components belonging to this domain */
    components: string[];
}

/**
 * The complete component graph — output of Phase 1 (Discovery).
 */
export interface ComponentGraph {
    /** High-level project information */
    project: ProjectInfo;
    /** All discovered components */
    components: ComponentInfo[];
    /** Component categories */
    categories: CategoryInfo[];
    /** Architecture notes (free-text summary) */
    architectureNotes: string;
    /** Top-level domains (only present for large repos with 3000+ files) */
    domains?: DomainInfo[];
    /** Theme area metadata (populated by theme command) */
    themes?: ThemeMeta[];
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
    /** File count threshold for triggering multi-round discovery (default: 3000) */
    largeRepoThreshold?: number;
}

/**
 * Result of the discovery phase.
 */
export interface DiscoveryResult {
    /** The discovered component graph */
    graph: ComponentGraph;
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
    /** File count threshold for triggering multi-round discovery (default: 3000) */
    largeRepoThreshold?: number;
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
    /** File count threshold for triggering multi-round discovery (default: 3000) */
    largeRepoThreshold?: number;
}

// ============================================================================
// Large Repo Types
// ============================================================================

/**
 * A top-level area identified during the first pass of large repo discovery.
 */
export interface TopLevelDomain {
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
    /** Identified top-level domains */
    domains: TopLevelDomain[];
    /** Project-level info gathered during scan */
    projectInfo: Partial<ProjectInfo>;
}

// ============================================================================
// Phase 3: Analysis Types (detail types colocated in analysis/types.ts)
// ============================================================================

// Re-export analysis detail types for backward compatibility
export type { KeyConcept, PublicAPIEntry, CodeExample, InternalDependency, ExternalDependency } from './analysis/types';

// Import for use in ComponentAnalysis below
import type { KeyConcept, PublicAPIEntry, CodeExample, InternalDependency, ExternalDependency } from './analysis/types';

/**
 * Deep analysis result for a single component — output of Phase 3 per-component AI session.
 */
export interface ComponentAnalysis {
    /** Component ID (matches ComponentInfo.id) */
    componentId: string;
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
    /** The discovered component graph */
    graph: ComponentGraph;
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
    /** Per-component analysis results */
    analyses: ComponentAnalysis[];
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
export type ArticleType = 'component' | 'index' | 'architecture' | 'getting-started' | 'domain-index' | 'domain-architecture';

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
    /** Component ID (only for component articles) */
    componentId?: string;
    /** Domain ID (for domain-level and module articles in hierarchical layout) */
    domainId?: string;
}

/**
 * Options for the writing phase (Phase 4).
 */
export interface WritingOptions {
    /** The discovered component graph */
    graph: ComponentGraph;
    /** Per-component analysis results */
    analyses: ComponentAnalysis[];
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
    /** Component IDs that failed article generation (empty when all succeed) */
    failedComponentIds?: string[];
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
    /** Repository path (from config file, overridden by CLI positional argument) */
    repoPath?: string;
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
    /** File count threshold for triggering multi-round discovery (default: 3000) */
    largeRepoThreshold?: number;
    /** Path to YAML configuration file */
    config?: string;
    /** Per-phase configuration overrides */
    phases?: PhasesConfig;
}

/**
 * A single theme seed — an architectural concern/module identified during Phase 0.
 */
export interface ThemeSeed {
    /** Short kebab-case identifier (e.g., "authentication", "api-gateway") */
    theme: string;
    /** 1-2 sentence description of the theme */
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
    /** The discovered theme seeds */
    themes: ThemeSeed[];
}

/**
 * Options for the `deep-wiki seeds` command.
 */
export interface SeedsCommandOptions {
    /** Output file path (default: "seeds.json") */
    output: string;
    /** Maximum number of themes to generate (default: 50) */
    maxThemes: number;
    /** AI model override */
    model?: string;
    /** Timeout in seconds for seeds session */
    timeout?: number;
    /** Verbose logging */
    verbose: boolean;
}

// ============================================================================
// Theme Generation Types
// ============================================================================

/**
 * User-provided theme request.
 */
export interface ThemeRequest {
    /** kebab-case ID (e.g., "compaction") */
    theme: string;
    /** User-provided description for better discovery */
    description?: string;
    /** Optional search hints (grep terms) */
    hints?: string[];
}

/**
 * Result of checking theme coverage in existing wiki.
 */
export interface ThemeCoverageCheck {
    /** Whether the theme is new, partially covered, or already exists */
    status: 'new' | 'partial' | 'exists';
    /** Path to existing article if theme already exists */
    existingArticlePath?: string;
    /** Components related to the theme */
    relatedComponents: ThemeRelatedComponent[];
}

/**
 * A component related to a theme with relevance scoring.
 */
export interface ThemeRelatedComponent {
    /** ID of the related component */
    componentId: string;
    /** Path to the module's article */
    articlePath: string;
    /** Relevance level */
    relevance: 'high' | 'medium' | 'low';
    /** Reason for the match */
    matchReason: string;
}

/**
 * AI-generated outline for how to decompose the theme into articles.
 */
export interface ThemeOutline {
    /** Theme identifier */
    themeId: string;
    /** Human-readable title */
    title: string;
    /** Layout strategy: single article or area with multiple articles */
    layout: 'single' | 'area';
    /** Planned articles */
    articles: ThemeArticlePlan[];
    /** Components involved in the theme */
    involvedComponents: ThemeInvolvedComponent[];
}

/**
 * Plan for a single article within a theme.
 */
export interface ThemeArticlePlan {
    /** URL-safe slug for the article */
    slug: string;
    /** Human-readable title */
    title: string;
    /** Brief description of what the article covers */
    description: string;
    /** Whether this is the index article for the theme area */
    isIndex: boolean;
    /** IDs of components covered by this article */
    coveredComponentIds: string[];
    /** Files covered by this article */
    coveredFiles: string[];
}

/**
 * A component involved in a theme with its role.
 */
export interface ThemeInvolvedComponent {
    /** Module ID */
    componentId: string;
    /** Role of the component in the theme */
    role: string;
    /** Key files relevant to the theme */
    keyFiles: string[];
}

/**
 * Cross-cutting theme analysis result.
 */
export interface ThemeAnalysis {
    /** Theme identifier */
    themeId: string;
    /** High-level overview */
    overview: string;
    /** Per-article analysis results */
    perArticle: ThemeArticleAnalysis[];
    /** Cross-cutting analysis */
    crossCutting: ThemeCrossCuttingAnalysis;
}

/**
 * Analysis for a single article within a theme.
 */
export interface ThemeArticleAnalysis {
    /** Article slug */
    slug: string;
    /** Key concepts discovered */
    keyConcepts: { name: string; description: string; codeRef?: string }[];
    /** Data flow description */
    dataFlow: string;
    /** Illustrative code examples */
    codeExamples: { title: string; code: string; file: string }[];
    /** Internal implementation details */
    internalDetails: string;
}

/**
 * Cross-cutting analysis across all articles in a theme.
 */
export interface ThemeCrossCuttingAnalysis {
    /** Architecture overview */
    architecture: string;
    /** Data flow description */
    dataFlow: string;
    /** Suggested Mermaid diagram */
    suggestedDiagram: string;
    /** Configuration notes */
    configuration?: string;
    /** Related theme IDs */
    relatedThemes?: string[];
}

/**
 * Generated theme article (individual file within the area).
 */
export interface ThemeArticle {
    /** Article type */
    type: 'theme-index' | 'theme-article';
    /** URL-safe slug */
    slug: string;
    /** Human-readable title */
    title: string;
    /** Markdown content */
    content: string;
    /** Parent theme identifier */
    themeId: string;
    /** IDs of components covered by this article */
    coveredComponentIds: string[];
}

/**
 * Theme area metadata stored in module-graph.json.
 */
export interface ThemeMeta {
    /** Unique theme identifier */
    id: string;
    /** Human-readable title */
    title: string;
    /** Theme description */
    description: string;
    /** Layout strategy */
    layout: 'single' | 'area';
    /** Articles within this theme area */
    articles: { slug: string; title: string; path: string }[];
    /** IDs of components involved in this theme */
    involvedComponentIds: string[];
    /** Directory path for the theme area output */
    directoryPath: string;
    /** Timestamp when this theme was generated */
    generatedAt: number;
    /** Git hash at generation time */
    gitHash?: string;
}

/**
 * CLI options for the `deep-wiki theme` command.
 */
export interface ThemeCommandOptions {
    /** Theme identifier */
    theme: string;
    /** User-provided description */
    description?: string;
    /** Path to existing wiki directory */
    wiki: string;
    /** Force regeneration */
    force: boolean;
    /** Check coverage only (no generation) */
    check: boolean;
    /** List existing themes */
    list: boolean;
    /** AI model override */
    model?: string;
    /** Analysis depth */
    depth: 'shallow' | 'normal' | 'deep';
    /** Timeout in seconds */
    timeout: number;
    /** Number of parallel AI sessions */
    concurrency: number;
    /** Disable cross-linking with existing articles */
    noCrossLink: boolean;
    /** Skip website regeneration */
    noWebsite: boolean;
    /** Interactive mode */
    interactive: boolean;
    /** Verbose logging */
    verbose: boolean;
}

// ============================================================================
// Iterative Discovery Types (colocated in discovery/iterative/types.ts)
// ============================================================================

// Re-export iterative discovery types for backward compatibility
export type { ThemeProbeResult, ProbeFoundComponent, DiscoveredTheme, IterativeDiscoveryOptions, MergeResult } from './discovery/iterative/types';

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
    CachedDomainGraph,
    DiscoveryProgressMetadata,
} from './cache/types';

// ============================================================================
// Phase 2: Component Consolidation Types (colocated in consolidation/types.ts)
// ============================================================================

// Re-export consolidation types for backward compatibility
export type { ConsolidationOptions, ConsolidationResult, ClusterGroup } from './consolidation/types';
