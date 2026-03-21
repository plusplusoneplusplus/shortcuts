/**
 * Deep-Wiki Types (subset)
 *
 * Types from deep-wiki/src/types.ts needed by the standalone wiki server
 * handlers (dw-generate-handler, dw-admin-handlers). Only the types that
 * are not already available in ./types.ts are duplicated here.
 */

// Re-export shared types that already exist in CoC wiki types
export type {
    ComponentGraph,
    ComponentAnalysis,
    WebsiteTheme,
} from './types';

// Import for local use
import type { WebsiteTheme } from './types';

// Types unique to the deep-wiki generate pipeline
export type ArticleType = 'component' | 'index' | 'architecture' | 'getting-started' | 'domain-index' | 'domain-architecture';

export interface GeneratedArticle {
    type: ArticleType;
    slug: string;
    title: string;
    content: string;
    componentId?: string;
    domainId?: string;
}

export type PhaseName = 'discovery' | 'consolidation' | 'analysis' | 'writing';

export interface PhaseConfig {
    model?: string;
    timeout?: number;
    concurrency?: number;
    depth?: 'shallow' | 'normal' | 'deep';
    skipAI?: boolean;
}

export type PhasesConfig = Partial<Record<PhaseName, PhaseConfig>>;

export interface GenerateCommandOptions {
    repoPath?: string;
    output: string;
    model?: string;
    concurrency?: number;
    timeout?: number;
    focus?: string;
    depth: 'shallow' | 'normal' | 'deep';
    force: boolean;
    useCache: boolean;
    phase?: number;
    endPhase?: number;
    verbose: boolean;
    skipWebsite?: boolean;
    theme?: WebsiteTheme;
    title?: string;
    seeds?: string;
    noCluster?: boolean;
    strict?: boolean;
    largeRepoThreshold?: number;
    config?: string;
    phases?: PhasesConfig;
}
