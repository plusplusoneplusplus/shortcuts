/**
 * These types are used exclusively by the analysis response parser
 * to normalize raw AI output into structured ComponentAnalysis objects.
 */

export interface KeyConcept {
    /** Concept name */
    name: string;
    /** Description of the concept */
    description: string;
    /** Code reference (file:line or file path) */
    codeRef?: string;
}

export interface PublicAPIEntry {
    /** Function/class/constant name */
    name: string;
    /** Type signature or declaration */
    signature: string;
    /** Description of what it does */
    description: string;
}

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
 * An internal dependency (another component in the same project).
 */
export interface InternalDependency {
    /** Component ID of the dependency */
    component: string;
    /** How this component uses the dependency */
    usage: string;
}

/**
 * An external dependency (third-party package).
 */
export interface ExternalDependency {
    /** Package name */
    package: string;
    /** How this component uses the package */
    usage: string;
}
