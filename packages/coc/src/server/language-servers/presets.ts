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

export const PYTHON_PRESET: LanguageServerDefinition = {
    id: 'python',
    displayName: 'Python',
    languageIds: ['python'],
    filePatterns: ['**/*.{py,pyi,pyw}'],
    command: 'pyright-langserver',
    args: ['--stdio'],
    rootMarkers: ['pyrightconfig.json', 'pyproject.toml', 'setup.cfg', 'setup.py', 'requirements.txt'],
    extensionLanguageIds: {
        '.py': 'python',
        '.pyi': 'python',
        '.pyw': 'python',
    },
    settings: {
        python: {
            analysis: {
                typeCheckingMode: 'basic',
                diagnosticMode: 'openFilesOnly',
            },
        },
    },
    priority: 100,
    enabled: false,
    builtIn: true,
};

export const CLANGD_PRESET: LanguageServerDefinition = {
    id: 'clangd',
    displayName: 'C / C++ (clangd)',
    languageIds: ['c', 'cpp', 'objective-c', 'objective-cpp', 'cuda'],
    filePatterns: ['**/*.{c,cc,cpp,cxx,c++,h,hh,hpp,hxx,h++,inl,ipp,cu,cuh,m,mm}'],
    command: 'clangd',
    args: ['--background-index=false'],
    rootMarkers: ['compile_commands.json', '.clangd', 'compile_flags.txt'],
    extensionLanguageIds: {
        '.c': 'c',
        '.cc': 'cpp',
        '.cpp': 'cpp',
        '.cxx': 'cpp',
        '.c++': 'cpp',
        '.h': 'cpp',
        '.hh': 'cpp',
        '.hpp': 'cpp',
        '.hxx': 'cpp',
        '.h++': 'cpp',
        '.inl': 'cpp',
        '.ipp': 'cpp',
        '.cu': 'cuda',
        '.cuh': 'cuda',
        '.m': 'objective-c',
        '.mm': 'objective-cpp',
    },
    priority: 100,
    sessionScope: 'workspace',
    maxSessions: 4,
    requestTimeoutMs: 120_000,
    idleTimeoutMs: 30 * 60_000,
    enabled: false,
    builtIn: true,
};

/**
 * CoC's own C-family symbol index, served over the same transport as clangd.
 *
 * It claims exactly the files clangd claims, at a lower priority: clangd is
 * the precise answer when it has a compilation database, and this is the fuzzy
 * one that still answers across translation units when clangd returns nothing.
 * Both attach to the same document and the client merges them, so the priority
 * only orders the merge — it does not pick a winner.
 *
 * Unlike every other preset this ships enabled. It needs no installed toolchain
 * and no project configuration, so there is nothing for a user to set up first;
 * the per-workspace toggle in settings remains the off switch.
 */
export const COC_SYMBOLS_PRESET: LanguageServerDefinition = {
    id: 'coc-symbols',
    displayName: 'C / C++ (symbol index)',
    languageIds: CLANGD_PRESET.languageIds,
    filePatterns: CLANGD_PRESET.filePatterns,
    command: 'coc-symbols-lsp',
    args: [],
    // The index is one database per workspace, so the workspace root is the
    // only root that makes sense — a nested marker would shard it.
    rootMarkers: [],
    extensionLanguageIds: CLANGD_PRESET.extensionLanguageIds,
    priority: 50,
    sessionScope: 'workspace',
    // One process per workspace, plus room for the per-editing-session fallback
    // the manager falls back to when two browsers open the same document. More
    // than that would mean several watchers walking the same tree.
    maxSessions: 2,
    requestTimeoutMs: 30_000,
    idleTimeoutMs: 30 * 60_000,
    enabled: true,
    builtIn: true,
};

/** Definitions shipped with CoC. Callers must not mutate the returned objects. */
export function builtInLanguageServerDefinitions(): LanguageServerDefinition[] {
    return [TYPESCRIPT_PRESET, RUST_PRESET, PYTHON_PRESET, CLANGD_PRESET, COC_SYMBOLS_PRESET];
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
