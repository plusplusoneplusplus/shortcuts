import type { LanguageServerDefinition } from './types';

/**
 * TypeScript is the first language to ship. It is an ordinary definition: the
 * runtime treats it exactly like a user-supplied one, so nothing downstream
 * needs a TypeScript branch.
 *
 * Disabled by default — language support starts off and is turned on per
 * workspace in settings.
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

/** Definitions shipped with CoC. Callers must not mutate the returned objects. */
export function builtInLanguageServerDefinitions(): LanguageServerDefinition[] {
    return [TYPESCRIPT_PRESET];
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
