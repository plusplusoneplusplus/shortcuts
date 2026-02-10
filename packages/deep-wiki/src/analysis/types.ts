/**
 * Analysis Detail Types — Sub-interfaces for ModuleAnalysis.
 *
 * These types are used exclusively by the analysis response parser
 * to normalize raw AI output into structured ModuleAnalysis objects.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/**
 * A key concept identified in a module.
 */
export interface KeyConcept {
    /** Concept name */
    name: string;
    /** Description of the concept */
    description: string;
    /** Code reference (file:line or file path) */
    codeRef?: string;
}

/**
 * A public API entry point of a module.
 */
export interface PublicAPIEntry {
    /** Function/class/constant name */
    name: string;
    /** Type signature or declaration */
    signature: string;
    /** Description of what it does */
    description: string;
}

/**
 * An illustrative code example from a module.
 */
export interface CodeExample {
    /** Short title for the example */
    title: string;
    /** The code snippet */
    code: string;
    /** File path (relative to repo root) */
    file?: string;
    /** Line numbers [start, end] */
    lines?: [number, number];
}

/**
 * An internal dependency (another module in the same project).
 */
export interface InternalDependency {
    /** Module ID of the dependency */
    module: string;
    /** How this module uses the dependency */
    usage: string;
}

/**
 * An external dependency (third-party package).
 */
export interface ExternalDependency {
    /** Package name */
    package: string;
    /** How this module uses the package */
    usage: string;
}
