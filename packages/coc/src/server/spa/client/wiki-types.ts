/**
 * Client-side wiki type definitions.
 *
 * Mirrors the server-side wiki types needed by the SPA dashboard.
 */

export type WikiStatus = 'loaded' | 'generating' | 'error' | 'pending';

export interface WikiData {
    id: string;
    name: string;
    repoPath: string;
    color?: string;
    generatedAt?: string;
    loaded?: boolean;
    componentCount?: number;
    status?: WikiStatus;
    title?: string;
    aiEnabled?: boolean;
    errorMessage?: string;
}

export interface ComponentGraph {
    project: ProjectInfo;
    components: ComponentInfo[];
    categories: CategoryInfo[];
    architectureNotes?: string;
    domains?: DomainInfo[];
}

export interface ProjectInfo {
    name: string;
    description: string;
    mainLanguage?: string;
}

export interface ComponentInfo {
    id: string;
    name: string;
    path: string;
    purpose: string;
    keyFiles?: string[];
    dependencies?: string[];
    dependents?: string[];
    complexity?: 'low' | 'medium' | 'high';
    category: string;
    domain?: string;
}

export interface CategoryInfo {
    id: string;
    name: string;
    description?: string;
}

export interface DomainInfo {
    id: string;
    name: string;
    path: string;
    description: string;
    components: string[];
}
