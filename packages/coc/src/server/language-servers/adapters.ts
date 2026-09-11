/**
 * Per-definition runtime preparation.
 *
 * A definition describes what to start; an adapter fills in what only that
 * language knows — which executable and which library actually exist on this
 * host for a given project root. The manager calls one function here and stays
 * language-neutral: no shared session, transport, or editor code branches on
 * TypeScript.
 *
 * An adapter runs only for a built-in preset that still points at its own
 * command. Repointing a preset at another executable in workspace settings is
 * an explicit choice, and preparation must not undo it.
 */

import { RUST_PRESET, TYPESCRIPT_PRESET } from './presets';
import { applyRustRuntime, resolveRustRuntime } from './rust-adapter';
import type { RustRuntimeDeps } from './rust-adapter';
import { applyTypeScriptRuntime, resolveTypeScriptRuntime } from './typescript-adapter';
import type { TypeScriptRuntimeDeps } from './typescript-adapter';
import type { LanguageServerDefinition } from './types';

export interface PreparedDefinition {
    /** The definition to start, with any resolved executable applied. */
    definition: LanguageServerDefinition;
    /** Short summary of the resolved runtime. Safe to show a user. */
    runtimeLabel?: string;
    /** Name to use for the executable in user-facing text, never a host path. */
    commandLabel?: string;
    /** User-facing notes, e.g. why a workspace toolchain was rejected. */
    notes?: string[];
}

export type PrepareDefinitionDeps = TypeScriptRuntimeDeps & RustRuntimeDeps;

/**
 * Resolves the runtime for one definition and project root. Returns the
 * definition unchanged when no adapter claims it.
 */
export function prepareDefinitionForRoot(
    definition: LanguageServerDefinition,
    rootPath: string,
    deps: PrepareDefinitionDeps = {},
): PreparedDefinition {
    if (claimsTypeScript(definition)) {
        const runtime = resolveTypeScriptRuntime(definition, rootPath, deps);
        return {
            definition: applyTypeScriptRuntime(definition, runtime),
            runtimeLabel: runtime.label,
            commandLabel: TYPESCRIPT_PRESET.command,
            notes: runtime.notes,
        };
    }
    if (claimsRust(definition)) {
        const runtime = resolveRustRuntime(definition, rootPath, deps);
        return {
            definition: applyRustRuntime(definition, runtime),
            runtimeLabel: runtime.label,
            commandLabel: RUST_PRESET.command,
            notes: runtime.notes,
        };
    }
    return { definition };
}

function claimsTypeScript(definition: LanguageServerDefinition): boolean {
    return (
        definition.id === TYPESCRIPT_PRESET.id &&
        definition.builtIn === true &&
        definition.command === TYPESCRIPT_PRESET.command
    );
}

function claimsRust(definition: LanguageServerDefinition): boolean {
    return definition.id === RUST_PRESET.id && definition.builtIn === true && definition.command === RUST_PRESET.command;
}
