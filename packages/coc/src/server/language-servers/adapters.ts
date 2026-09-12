/**
 * Per-definition root and runtime preparation.
 *
 * A definition describes what to start; an adapter fills in what only that
 * language knows — how to select its project root and which runtime exists on
 * this host. The manager calls this registry and stays language-neutral: no
 * shared session, transport, or editor code branches on a language.
 *
 * An adapter runs only for a built-in preset that still points at its own
 * command. Repointing a preset at another executable in workspace settings is
 * an explicit choice, and preparation must not undo it.
 */

import { PYTHON_PRESET, RUST_PRESET, TYPESCRIPT_PRESET } from './presets';
import { applyPythonRuntime, resolvePythonRuntime } from './python-adapter';
import type { PythonRuntimeDeps } from './python-adapter';
import { applyRustRuntime, resolveRustRuntime, resolveRustServerRoot } from './rust-adapter';
import type { RustRuntimeDeps } from './rust-adapter';
import { resolveServerRoot } from './selection';
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
    /** Safe command the user may copy and run themselves. */
    recoveryCommand?: string;
}

export type PrepareDefinitionDeps = TypeScriptRuntimeDeps & RustRuntimeDeps & PythonRuntimeDeps;

export function resolveDefinitionRoot(
    definition: LanguageServerDefinition,
    workspaceRoot: string,
    relativePath: string,
    deps: PrepareDefinitionDeps = {},
): string {
    if (definition.id === RUST_PRESET.id && definition.builtIn === true) {
        return resolveRustServerRoot(definition, workspaceRoot, relativePath, deps);
    }
    return resolveServerRoot(definition, workspaceRoot, relativePath, deps.exists);
}

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
            recoveryCommand: runtime.recoveryCommand,
        };
    }
    if (claimsPython(definition)) {
        const runtime = resolvePythonRuntime(definition, rootPath, deps);
        return {
            definition: applyPythonRuntime(definition, runtime),
            runtimeLabel: runtime.label,
            commandLabel: PYTHON_PRESET.command,
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

function claimsPython(definition: LanguageServerDefinition): boolean {
    return (
        definition.id === PYTHON_PRESET.id &&
        definition.builtIn === true &&
        definition.command === PYTHON_PRESET.command
    );
}
