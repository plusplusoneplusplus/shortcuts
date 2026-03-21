/**
 * Wiki Types
 *
 * Type definitions for the wiki data layer. Contains types copied from
 * deep-wiki that are consumed by wiki-data, context-builder,
 * file-watcher, and conversation-session-manager.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Deep-Wiki Domain Types (copied to avoid dependency back on deep-wiki)
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

// ============================================================================
// Analysis Sub-Types (copied from deep-wiki/src/analysis/types.ts)
// ============================================================================

/** A key concept identified in a component. */
export interface KeyConcept {
    name: string;
    description: string;
    codeRef?: string;
}

/** A public API entry point of a component. */
export interface PublicAPIEntry {
    name: string;
    signature: string;
    description: string;
}

/** An illustrative code example from a component. */
export interface CodeExample {
    title: string;
    code: string;
    file?: string;
    lines?: [number, number];
}

/** An internal dependency (another component in the same project). */
export interface InternalDependency {
    component: string;
    usage: string;
}

/** An external dependency (third-party package). */
export interface ExternalDependency {
    package: string;
    usage: string;
}

/**
 * Deep analysis result for a single component.
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

// ============================================================================
// AskAIFunction (decoupled from ask-handler)
// ============================================================================

/**
 * Callback type for sending a prompt to the AI and receiving a response.
 * Decoupled from the HTTP handler layer so data-layer modules can use it.
 */
export type AskAIFunction = (prompt: string, options?: {
    model?: string;
    workingDirectory?: string;
    onStreamingChunk?: (chunk: string) => void;
}) => Promise<string>;

// ============================================================================
// Serve Command Options (deep-wiki variant)
// ============================================================================

/**
 * Options for the `deep-wiki serve` command (wiki-specific variant).
 * Lives under wiki/ to avoid collision with CoC's top-level ServeCommandOptions.
 */
export interface WikiServeCommandOptions {
    /** Port to listen on (default: 3000) */
    port?: number;
    /** Host/address to bind to (default: '0.0.0.0') */
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

// Website Theme
export type WebsiteTheme = 'light' | 'dark' | 'auto';
