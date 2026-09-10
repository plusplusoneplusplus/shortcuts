/**
 * Language-server configuration contract.
 *
 * Mirrors the server's language-neutral definition shape. Nothing here knows
 * about TypeScript — presets arrive from the server like any other definition.
 */

export type LanguageServerJsonValue =
  | string
  | number
  | boolean
  | null
  | LanguageServerJsonValue[]
  | { [key: string]: LanguageServerJsonValue };

export interface LanguageServerDefinition {
  /** Stable identifier, unique within a workspace. */
  id: string;
  /** Human-readable name shown in settings and status. */
  displayName: string;
  /** LSP language ids this server serves. */
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
  initializationOptions?: LanguageServerJsonValue;
  settings?: LanguageServerJsonValue;
  /** Higher wins when several definitions match one document. */
  priority?: number;
  enabled?: boolean;
  /** True for definitions shipped with CoC. Built-ins can be overridden, not deleted. */
  builtIn?: boolean;
}

/** A single field-level validation failure, addressed by dotted path. */
export interface LanguageServerDefinitionError {
  /** Dotted path anchored on the request body, e.g. `definitions.0.command`. */
  field: string;
  message: string;
}

export interface LanguageServerConfigWarning {
  kind: string;
  message: string;
}

/** Read/write response for `/workspaces/:id/language-servers`. */
export interface LanguageServerConfigResponse {
  enabled: boolean;
  /** Definitions as stored for this workspace, without preset layering. */
  definitions: LanguageServerDefinition[];
  /** Presets layered with workspace overrides — what settings should render. */
  effective: LanguageServerDefinition[];
  /** The subset that may actually start; empty while support is disabled. */
  startable: LanguageServerDefinition[];
  status: 'ok' | 'missing' | 'invalid';
  warnings: LanguageServerConfigWarning[];
}

export interface LanguageServerConfigUpdate {
  enabled?: boolean;
  definitions?: LanguageServerDefinition[];
}

/** Stored configuration echoed back with a rejected write. */
export interface LanguageServerStoredConfig {
  enabled: boolean;
  definitions: LanguageServerDefinition[];
}

/** Body of a 400 from a language-server config write. */
export interface LanguageServerConfigRejection {
  errors: LanguageServerDefinitionError[];
  /** The untouched on-disk config, so the UI can restore the last valid state. */
  config?: LanguageServerStoredConfig;
}
