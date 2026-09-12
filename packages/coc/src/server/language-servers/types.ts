/**
 * Language-neutral contract for describing a standard LSP server.
 *
 * Nothing in this module knows about TypeScript. Language-specific details
 * (executable resolution, language-id mapping, settings) live in the
 * definition itself so shared editor and transport code stays generic.
 */

/** JSON value accepted for initialization options and server settings. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface LanguageServerDefinition {
    /** Stable identifier, unique within a workspace. */
    id: string;
    /** Human-readable name shown in settings and status. */
    displayName: string;
    /** LSP language ids this server serves, e.g. `['typescript', 'typescriptreact']`. */
    languageIds: string[];
    /** Glob patterns matched against the workspace-relative file path. */
    filePatterns: string[];
    /** Executable name or absolute path. Never a shell command line. */
    command: string;
    /** Structured argument vector. Passed to the process without a shell. */
    args: string[];
    /** File names that mark a project root, most specific first. */
    rootMarkers: string[];
    /** Maps a lowercase file extension (with dot) to an LSP language id. */
    extensionLanguageIds?: Record<string, string>;
    /** Sent in the LSP `initialize` request. */
    initializationOptions?: JsonValue;
    /** Sent in `workspace/didChangeConfiguration`. */
    settings?: JsonValue;
    /** Higher wins when several definitions match one document. Defaults to 0. */
    priority?: number;
    /** Process identity boundary. Defaults to one process per editing session and root. */
    sessionScope?: 'editing-session' | 'workspace';
    /** Maximum live processes for this definition in one workspace. */
    maxSessions?: number;
    /** Per-request timeout for this definition. */
    requestTimeoutMs?: number;
    /** Stop an unreferenced process after this idle interval. */
    idleTimeoutMs?: number;
    /** Definitions are opt-in; a disabled definition never starts. Defaults to false. */
    enabled?: boolean;
    /** True for definitions shipped with CoC. Built-ins can be overridden, not deleted. */
    builtIn?: boolean;
}

/** A single field-level validation failure, addressed by dotted path. */
export interface LanguageServerDefinitionError {
    /** Dotted field path, e.g. `args.1` or `command`. */
    field: string;
    message: string;
}

export type LanguageServerDefinitionValidation =
    | { ok: true; definition: LanguageServerDefinition }
    | { ok: false; errors: LanguageServerDefinitionError[] };
