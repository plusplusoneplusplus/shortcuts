/**
 * Wiki Fixture Generators for E2E Tests
 *
 * Provides reusable helpers to create realistic ComponentGraph data
 * and write it to disk for wiki-related E2E tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    ComponentGraph,
    ComponentInfo,
    ProjectInfo,
    CategoryInfo,
    DomainInfo,
} from '../../../src/server/wiki/types';

// Re-export types so tests can import from a single module
export type { ComponentGraph, ComponentInfo, ProjectInfo, CategoryInfo, DomainInfo };

/** Configuration options for `createWikiFixture`. */
export interface WikiFixtureOptions {
    /** Project name (default: "test-wiki-project") */
    projectName: string;
    /** Number of components to generate (default: 4) */
    componentCount: number;
    /** Whether to include domains (default: false) */
    withDomains: boolean;
    /** Whether to include theme metadata (default: false) */
    withThemes: boolean;
    /** Primary language (default: "TypeScript") */
    language: string;
    /** Category definitions — overrides the default set */
    categories: CategoryInfo[];
}

const DEFAULT_CATEGORIES: CategoryInfo[] = [
    { name: 'core', description: 'Core business logic' },
    { name: 'api', description: 'API layer and routing' },
    { name: 'infra', description: 'Infrastructure and tooling' },
];

const COMPLEXITY_LEVELS: ComponentInfo['complexity'][] = ['low', 'medium', 'high'];

/**
 * Create a single `ComponentInfo` with sensible defaults.
 *
 * @param id   Unique component identifier (kebab-case).
 * @param overrides  Partial fields to override defaults.
 */
export function createWikiComponent(
    id: string,
    overrides?: Partial<ComponentInfo>,
): ComponentInfo {
    const name = id
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    return {
        id,
        name,
        path: `src/${id}/`,
        purpose: `Handles ${id.replace(/-/g, ' ')} functionality`,
        keyFiles: [`src/${id}/index.ts`, `src/${id}/types.ts`],
        dependencies: [],
        dependents: [],
        complexity: 'medium',
        category: 'core',
        ...overrides,
    };
}

/**
 * Generate a `ComponentGraph` fixture and write `component-graph.json` to `wikiDir`.
 *
 * @param wikiDir  Directory where `component-graph.json` will be written (created if absent).
 * @param options  Optional overrides for fixture generation.
 * @returns The generated `ComponentGraph` object.
 */
export function createWikiFixture(
    wikiDir: string,
    options?: Partial<WikiFixtureOptions>,
): ComponentGraph {
    const opts: WikiFixtureOptions = {
        projectName: 'test-wiki-project',
        componentCount: 4,
        withDomains: false,
        withThemes: false,
        language: 'TypeScript',
        categories: DEFAULT_CATEGORIES,
        ...options,
    };

    const project: ProjectInfo = {
        name: opts.projectName,
        description: `Fixture project for wiki E2E tests`,
        language: opts.language,
        buildSystem: 'npm + webpack',
        entryPoints: ['src/index.ts'],
    };

    // Build components with deterministic IDs
    const components: ComponentInfo[] = [];
    for (let i = 1; i <= opts.componentCount; i++) {
        const catIndex = (i - 1) % opts.categories.length;
        const comp = createWikiComponent(`comp-${i}`, {
            category: opts.categories[catIndex].name,
            complexity: COMPLEXITY_LEVELS[i % COMPLEXITY_LEVELS.length],
        });
        components.push(comp);
    }

    // Wire deterministic dependencies: each component depends on the previous one
    for (let i = 1; i < components.length; i++) {
        components[i].dependencies = [components[i - 1].id];
        components[i - 1].dependents = [
            ...(components[i - 1].dependents ?? []),
            components[i].id,
        ];
    }

    const graph: ComponentGraph = {
        project,
        components,
        categories: opts.categories,
        architectureNotes:
            'Layered architecture with clear separation between API, business logic, and data layers. ' +
            'Components are organized by functional area. ' +
            'Dependencies flow from higher-level modules to lower-level modules.',
    };

    // Optionally add domains
    if (opts.withDomains) {
        const mid = Math.ceil(components.length / 2);
        const domains: DomainInfo[] = [
            {
                id: 'frontend',
                name: 'Frontend',
                path: 'src/frontend/',
                description: 'Client-side user interface components',
                components: components.slice(0, mid).map((c) => c.id),
            },
            {
                id: 'backend',
                name: 'Backend',
                path: 'src/backend/',
                description: 'Server-side business logic and API',
                components: components.slice(mid).map((c) => c.id),
            },
        ];
        graph.domains = domains;
        // Tag each component with its domain
        for (const domain of domains) {
            for (const compId of domain.components) {
                const comp = components.find((c) => c.id === compId);
                if (comp) comp.domain = domain.id;
            }
        }
    }

    // Write to disk
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(
        path.join(wikiDir, 'component-graph.json'),
        JSON.stringify(graph, null, 2),
    );

    return graph;
}
