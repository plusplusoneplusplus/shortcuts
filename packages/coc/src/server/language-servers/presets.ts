import type { LanguageServerDefinition } from './types';

/**
 * Built-in languages are ordinary definitions: the runtime treats them like
 * user-supplied ones, so language-specific behavior stays in adapters.
 *
 * They are disabled by default and enabled per workspace in settings.
 */
export const TYPESCRIPT_PRESET: LanguageServerDefinition = {
    id: 'typescript',
    displayName: 'TypeScript',
    languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    filePatterns: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    extensionLanguageIds: {
        '.ts': 'typescript',
        '.mts': 'typescript',
        '.cts': 'typescript',
        '.tsx': 'typescriptreact',
        '.js': 'javascript',
        '.mjs': 'javascript',
        '.cjs': 'javascript',
        '.jsx': 'javascriptreact',
    },
    priority: 100,
    enabled: false,
    builtIn: true,
};

export const RUST_PRESET: LanguageServerDefinition = {
    id: 'rust',
    displayName: 'Rust',
    languageIds: ['rust'],
    filePatterns: ['**/*.rs'],
    command: 'rust-analyzer',
    args: [],
    rootMarkers: ['Cargo.toml'],
    extensionLanguageIds: {
        '.rs': 'rust',
    },
    initializationOptions: {
        checkOnSave: false,
        cargo: {
            buildScripts: {
                enable: true,
            },
        },
        procMacro: {
            enable: true,
        },
    },
    priority: 100,
    enabled: false,
    builtIn: true,
};

/** Definitions shipped with CoC. Callers must not mutate the returned objects. */
export function builtInLanguageServerDefinitions(): LanguageServerDefinition[] {
    return [TYPESCRIPT_PRESET, RUST_PRESET];
}

/**
 * Merge built-in presets with workspace-configured definitions. A workspace
 * definition sharing a preset's id overrides it, which is how a preset gets
 * enabled or repointed at a different executable.
 */
export function mergeWithBuiltIns(configured: LanguageServerDefinition[]): LanguageServerDefinition[] {
    const byId = new Map<string, LanguageServerDefinition>();
    for (const definition of builtInLanguageServerDefinitions()) {
        byId.set(definition.id, definition);
    }
    for (const definition of configured) {
        const preset = byId.get(definition.id);
        byId.set(definition.id, preset ? { ...preset, ...definition, builtIn: true } : definition);
    }
    return [...byId.values()];
}
