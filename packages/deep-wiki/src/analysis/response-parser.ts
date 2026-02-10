/**
 * Analysis Response Parser
 *
 * Parses AI responses from Phase 2 analysis into structured ModuleAnalysis objects.
 * Handles JSON extraction from markdown code blocks, field validation, default filling,
 * and Mermaid diagram validation.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type {
    ModuleAnalysis,
    KeyConcept,
    PublicAPIEntry,
    CodeExample,
    InternalDependency,
    ExternalDependency,
} from '../types';
import { isValidMermaidDiagram } from '../schemas';

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract JSON from a response that may contain markdown code blocks.
 * Tries multiple strategies:
 * 1. Direct JSON parse
 * 2. Extract from ```json ... ``` code block
 * 3. Extract from ``` ... ``` code block
 * 4. Find the first { ... } block
 */
export function extractJSON(response: string): unknown | null {
    if (!response || typeof response !== 'string') {
        return null;
    }

    const trimmed = response.trim();

    // Strategy 1: Direct JSON parse
    try {
        return JSON.parse(trimmed);
    } catch {
        // Continue to next strategy
    }

    // Strategy 2: Extract from ```json ... ``` code block (flexible whitespace)
    // Handles preamble text before the code block and optional newlines
    const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
        const content = jsonBlockMatch[1].trim();
        if (content) {
            try {
                return JSON.parse(content);
            } catch {
                // Continue to next strategy
            }
        }
    }

    // Strategy 3: Extract from ``` ... ``` code block (flexible whitespace)
    const codeBlockMatch = trimmed.match(/```\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        const content = codeBlockMatch[1].trim();
        if (content) {
            try {
                return JSON.parse(content);
            } catch {
                // Continue to next strategy
            }
        }
    }

    // Strategy 4: Find the last ```json block (for multi-block responses)
    // AI sometimes includes earlier code blocks with non-JSON content
    const allJsonBlocks = [...trimmed.matchAll(/```json\s*([\s\S]*?)\s*```/g)];
    for (let i = allJsonBlocks.length - 1; i >= 0; i--) {
        const content = allJsonBlocks[i][1].trim();
        if (content) {
            try {
                return JSON.parse(content);
            } catch {
                continue;
            }
        }
    }

    // Strategy 5: Find the first { ... } block (greedy)
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
        } catch {
            // All strategies failed
        }
    }

    return null;
}

// ============================================================================
// Field Normalizers
// ============================================================================

/**
 * Ensure a value is a non-empty string, or return the default.
 */
function ensureString(value: unknown, defaultValue: string = ''): string {
    if (typeof value === 'string') {
        return value;
    }
    return defaultValue;
}

/**
 * Ensure a value is an array, or return an empty array.
 */
function ensureArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) {
        return value as T[];
    }
    return [];
}

/**
 * Normalize a KeyConcept from raw data.
 */
function normalizeKeyConcept(raw: unknown): KeyConcept | null {
    if (!raw || typeof raw !== 'object') { return null; }
    const obj = raw as Record<string, unknown>;
    if (!obj.name || typeof obj.name !== 'string') { return null; }

    return {
        name: obj.name,
        description: ensureString(obj.description),
        codeRef: typeof obj.codeRef === 'string' ? obj.codeRef : undefined,
    };
}

/**
 * Normalize a PublicAPIEntry from raw data.
 */
function normalizePublicAPIEntry(raw: unknown): PublicAPIEntry | null {
    if (!raw || typeof raw !== 'object') { return null; }
    const obj = raw as Record<string, unknown>;
    if (!obj.name || typeof obj.name !== 'string') { return null; }

    return {
        name: obj.name,
        signature: ensureString(obj.signature),
        description: ensureString(obj.description),
    };
}

/**
 * Normalize a CodeExample from raw data.
 */
function normalizeCodeExample(raw: unknown): CodeExample | null {
    if (!raw || typeof raw !== 'object') { return null; }
    const obj = raw as Record<string, unknown>;
    if (!obj.title || typeof obj.title !== 'string') { return null; }

    const example: CodeExample = {
        title: obj.title,
        code: ensureString(obj.code),
    };

    if (typeof obj.file === 'string' && obj.file.length > 0) {
        example.file = normalizeFilePath(obj.file);
    }

    if (Array.isArray(obj.lines) && obj.lines.length === 2) {
        const start = Number(obj.lines[0]);
        const end = Number(obj.lines[1]);
        if (!isNaN(start) && !isNaN(end) && start >= 0 && end >= start) {
            example.lines = [start, end];
        }
    }

    return example;
}

/**
 * Normalize an InternalDependency from raw data.
 */
function normalizeInternalDependency(raw: unknown): InternalDependency | null {
    if (!raw || typeof raw !== 'object') { return null; }
    const obj = raw as Record<string, unknown>;
    if (!obj.module || typeof obj.module !== 'string') { return null; }

    return {
        module: obj.module,
        usage: ensureString(obj.usage),
    };
}

/**
 * Normalize an ExternalDependency from raw data.
 */
function normalizeExternalDependency(raw: unknown): ExternalDependency | null {
    if (!raw || typeof raw !== 'object') { return null; }
    const obj = raw as Record<string, unknown>;
    if (!obj.package || typeof obj.package !== 'string') { return null; }

    return {
        package: obj.package,
        usage: ensureString(obj.usage),
    };
}

/**
 * Normalize a file path to be relative to the repo root.
 * Removes leading ./ or / prefixes.
 */
function normalizeFilePath(filePath: string): string {
    // Remove leading ./ or /
    let normalized = filePath.replace(/^\.\//, '').replace(/^\//, '');
    // Normalize backslashes to forward slashes (Windows compat)
    normalized = normalized.replace(/\\/g, '/');
    return normalized;
}

/**
 * Normalize a Mermaid diagram string.
 * Returns empty string if invalid.
 */
function normalizeMermaidDiagram(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
        return '';
    }

    // Strip markdown code block wrapper if present
    let diagram = value.trim();
    const mermaidBlockMatch = diagram.match(/```(?:mermaid)?\s*\n([\s\S]*?)\n\s*```/);
    if (mermaidBlockMatch) {
        diagram = mermaidBlockMatch[1].trim();
    }

    // Basic validation
    if (!isValidMermaidDiagram(diagram)) {
        return '';
    }

    return diagram;
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse an AI response string into a ModuleAnalysis object.
 *
 * @param response The raw AI response text
 * @param expectedModuleId The expected moduleId (for validation)
 * @returns Parsed ModuleAnalysis
 * @throws Error if the response cannot be parsed at all
 */
export function parseAnalysisResponse(response: string, expectedModuleId: string): ModuleAnalysis {
    const parsed = extractJSON(response);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Failed to extract JSON from analysis response');
    }

    const raw = parsed as Record<string, unknown>;

    // Validate moduleId — use expected if missing or mismatched
    const moduleId = typeof raw.moduleId === 'string' ? raw.moduleId : expectedModuleId;

    // Build the ModuleAnalysis with defaults for missing fields
    const analysis: ModuleAnalysis = {
        moduleId,
        overview: ensureString(raw.overview, 'No overview available.'),
        keyConcepts: ensureArray(raw.keyConcepts)
            .map(normalizeKeyConcept)
            .filter((c): c is KeyConcept => c !== null),
        publicAPI: ensureArray(raw.publicAPI)
            .map(normalizePublicAPIEntry)
            .filter((e): e is PublicAPIEntry => e !== null),
        internalArchitecture: ensureString(raw.internalArchitecture),
        dataFlow: ensureString(raw.dataFlow),
        patterns: ensureArray<string>(raw.patterns).filter(
            (p): p is string => typeof p === 'string' && p.length > 0
        ),
        errorHandling: ensureString(raw.errorHandling),
        codeExamples: ensureArray(raw.codeExamples)
            .map(normalizeCodeExample)
            .filter((e): e is CodeExample => e !== null),
        dependencies: {
            internal: [],
            external: [],
        },
        suggestedDiagram: normalizeMermaidDiagram(raw.suggestedDiagram),
    };

    // Parse dependencies object
    if (raw.dependencies && typeof raw.dependencies === 'object') {
        const deps = raw.dependencies as Record<string, unknown>;
        analysis.dependencies.internal = ensureArray(deps.internal)
            .map(normalizeInternalDependency)
            .filter((d): d is InternalDependency => d !== null);
        analysis.dependencies.external = ensureArray(deps.external)
            .map(normalizeExternalDependency)
            .filter((d): d is ExternalDependency => d !== null);
    }

    return analysis;
}
