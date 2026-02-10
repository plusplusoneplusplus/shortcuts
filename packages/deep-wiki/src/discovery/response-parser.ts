/**
 * Discovery Phase — Response Parser
 *
 * Parses and validates AI JSON responses into ModuleGraph structures.
 * Handles JSON extraction from markdown, validation, normalization,
 * and error recovery.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { extractJSON } from '@plusplusoneplusplus/pipeline-core';
import type { ModuleGraph, ModuleInfo, ProjectInfo, CategoryInfo, TopLevelArea, StructuralScanResult } from '../types';
import {
    MODULE_GRAPH_REQUIRED_FIELDS,
    PROJECT_INFO_REQUIRED_FIELDS,
    MODULE_INFO_REQUIRED_FIELDS,
    VALID_COMPLEXITY_VALUES,
    isValidModuleId,
    normalizeModuleId,
} from '../schemas';
import { parseAIJsonResponse, attemptJsonRepair } from '../utils/parse-ai-response';

// ============================================================================
// Module Graph Parsing
// ============================================================================

/**
 * Parse an AI response into a ModuleGraph.
 *
 * Handles:
 * 1. Raw JSON → parse directly
 * 2. JSON in markdown code blocks → extract and parse
 * 3. Multiple JSON blocks → take the largest one
 * 4. Trailing text after JSON → strip and parse
 * 5. Invalid JSON → attempt repair
 * 6. Missing required fields → fill defaults, warn
 *
 * @param response - Raw AI response string
 * @returns Parsed and validated ModuleGraph
 * @throws Error if response cannot be parsed into a valid graph
 */
export function parseModuleGraphResponse(response: string): ModuleGraph {
    const parsed = parseAIJsonResponse(response, { context: 'discovery', repair: true });

    // Step 3: Validate and normalize
    return validateAndNormalizeGraph(parsed);
}

// ============================================================================
// Structural Scan Parsing
// ============================================================================

/**
 * Parse an AI response into a StructuralScanResult.
 *
 * @param response - Raw AI response string
 * @returns Parsed structural scan result
 * @throws Error if response cannot be parsed
 */
export function parseStructuralScanResponse(response: string): StructuralScanResult {
    if (!response || typeof response !== 'string') {
        throw new Error('Empty or invalid response from AI');
    }

    const jsonStr = extractJSON(response);
    if (!jsonStr) {
        throw new Error('No JSON found in structural scan response');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        const fixed = attemptJsonRepair(jsonStr);
        if (fixed) {
            parsed = JSON.parse(fixed);
        } else {
            throw new Error('Invalid JSON in structural scan response');
        }
    }

    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Structural scan response is not a JSON object');
    }

    const raw = parsed as Record<string, unknown>;

    return {
        fileCount: typeof raw.fileCount === 'number' ? raw.fileCount : 0,
        areas: parseAreas(raw.areas),
        projectInfo: parsePartialProjectInfo(raw.projectInfo),
    };
}

// ============================================================================
// Validation and Normalization
// ============================================================================

/**
 * Validate and normalize a raw parsed object into a ModuleGraph.
 */
function validateAndNormalizeGraph(raw: Record<string, unknown>): ModuleGraph {
    const warnings: string[] = [];

    // Check required top-level fields
    for (const field of MODULE_GRAPH_REQUIRED_FIELDS) {
        if (!(field in raw)) {
            if (field === 'categories') {
                raw.categories = [];
                warnings.push(`Missing '${field}' field, using empty default`);
            } else {
                throw new Error(`Missing required field '${field}' in module graph`);
            }
        }
    }

    // Parse project info
    const project = parseProjectInfo(raw.project);

    // Parse modules
    const modules = parseModules(raw.modules, warnings);

    // Parse categories
    const categories = parseCategories(raw.categories, warnings);

    // Parse architecture notes
    const architectureNotes = typeof raw.architectureNotes === 'string'
        ? raw.architectureNotes
        : '';

    // Post-processing: ensure module categories match declared categories
    const categoryNames = new Set(categories.map(c => c.name));
    for (const mod of modules) {
        if (mod.category && !categoryNames.has(mod.category)) {
            // Auto-add missing category
            categories.push({ name: mod.category, description: `Auto-generated category for ${mod.category}` });
            categoryNames.add(mod.category);
            warnings.push(`Auto-added missing category '${mod.category}'`);
        }
    }

    // Post-processing: validate dependency references
    const moduleIds = new Set(modules.map(m => m.id));
    for (const mod of modules) {
        mod.dependencies = mod.dependencies.filter(dep => {
            if (!moduleIds.has(dep)) {
                warnings.push(`Module '${mod.id}' references unknown dependency '${dep}', removing`);
                return false;
            }
            return true;
        });
        mod.dependents = mod.dependents.filter(dep => {
            if (!moduleIds.has(dep)) {
                warnings.push(`Module '${mod.id}' references unknown dependent '${dep}', removing`);
                return false;
            }
            return true;
        });
    }

    // Deduplicate modules by ID
    const seenIds = new Set<string>();
    const deduplicatedModules: ModuleInfo[] = [];
    for (const mod of modules) {
        if (seenIds.has(mod.id)) {
            warnings.push(`Duplicate module ID '${mod.id}', keeping first occurrence`);
            continue;
        }
        seenIds.add(mod.id);
        deduplicatedModules.push(mod);
    }

    if (warnings.length > 0) {
        // Log warnings to stderr for visibility
        for (const w of warnings) {
            process.stderr.write(`[WARN] ${w}\n`);
        }
    }

    return {
        project,
        modules: deduplicatedModules,
        categories,
        architectureNotes,
    };
}

/**
 * Parse and validate ProjectInfo.
 */
function parseProjectInfo(raw: unknown): ProjectInfo {
    if (typeof raw !== 'object' || raw === null) {
        throw new Error("Missing or invalid 'project' field in module graph");
    }

    const obj = raw as Record<string, unknown>;

    // Validate required fields exist (use defaults if missing)
    for (const field of PROJECT_INFO_REQUIRED_FIELDS) {
        if (!(field in obj) || typeof obj[field] !== 'string') {
            // Use defaults for missing fields
        }
    }

    return {
        name: String(obj.name || 'unknown'),
        description: String(obj.description || ''),
        language: String(obj.language || 'unknown'),
        buildSystem: String(obj.buildSystem || 'unknown'),
        entryPoints: parseStringArray(obj.entryPoints),
    };
}

/**
 * Parse and validate an array of ModuleInfo.
 */
function parseModules(raw: unknown, warnings: string[]): ModuleInfo[] {
    if (!Array.isArray(raw)) {
        throw new Error("'modules' field must be an array");
    }

    const modules: ModuleInfo[] = [];

    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (typeof item !== 'object' || item === null) {
            warnings.push(`Skipping invalid module at index ${i}`);
            continue;
        }

        const obj = item as Record<string, unknown>;

        // Check required fields
        let hasRequired = true;
        for (const field of MODULE_INFO_REQUIRED_FIELDS) {
            if (!(field in obj) || typeof obj[field] !== 'string') {
                warnings.push(`Module at index ${i} missing required field '${field}', skipping`);
                hasRequired = false;
                break;
            }
        }
        if (!hasRequired) { continue; }

        // Normalize module ID
        let id = String(obj.id);
        if (!isValidModuleId(id)) {
            const normalized = normalizeModuleId(id);
            warnings.push(`Normalized module ID '${id}' → '${normalized}'`);
            id = normalized;
        }

        // Normalize path (remove leading ./ and trailing /)
        let modulePath = String(obj.path || '');
        modulePath = normalizePath(modulePath);

        // Validate complexity
        let complexity = String(obj.complexity || 'medium').toLowerCase();
        if (!VALID_COMPLEXITY_VALUES.includes(complexity as typeof VALID_COMPLEXITY_VALUES[number])) {
            warnings.push(`Module '${id}' has invalid complexity '${complexity}', defaulting to 'medium'`);
            complexity = 'medium';
        }

        modules.push({
            id,
            name: String(obj.name),
            path: modulePath,
            purpose: String(obj.purpose || ''),
            keyFiles: parseStringArray(obj.keyFiles).map(normalizePath),
            dependencies: parseStringArray(obj.dependencies),
            dependents: parseStringArray(obj.dependents),
            complexity: complexity as ModuleInfo['complexity'],
            category: String(obj.category || 'general'),
        });
    }

    return modules;
}

/**
 * Parse and validate an array of CategoryInfo.
 */
function parseCategories(raw: unknown, warnings: string[]): CategoryInfo[] {
    if (!Array.isArray(raw)) {
        warnings.push("'categories' is not an array, using empty default");
        return [];
    }

    const categories: CategoryInfo[] = [];

    for (const item of raw) {
        if (typeof item !== 'object' || item === null) { continue; }
        const obj = item as Record<string, unknown>;

        if (typeof obj.name !== 'string' || !obj.name) { continue; }

        categories.push({
            name: String(obj.name),
            description: String(obj.description || ''),
        });
    }

    return categories;
}

/**
 * Parse areas from structural scan response.
 */
function parseAreas(raw: unknown): TopLevelArea[] {
    if (!Array.isArray(raw)) { return []; }

    const areas: TopLevelArea[] = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) { continue; }
        const obj = item as Record<string, unknown>;

        areas.push({
            name: String(obj.name || ''),
            path: normalizePath(String(obj.path || '')),
            description: String(obj.description || ''),
        });
    }

    return areas;
}

/**
 * Parse partial ProjectInfo from structural scan response.
 */
function parsePartialProjectInfo(raw: unknown): Partial<ProjectInfo> {
    if (typeof raw !== 'object' || raw === null) { return {}; }
    const obj = raw as Record<string, unknown>;

    const result: Partial<ProjectInfo> = {};
    if (typeof obj.name === 'string') { result.name = obj.name; }
    if (typeof obj.description === 'string') { result.description = obj.description; }
    if (typeof obj.language === 'string') { result.language = obj.language; }
    if (typeof obj.buildSystem === 'string') { result.buildSystem = obj.buildSystem; }
    if (Array.isArray(obj.entryPoints)) { result.entryPoints = parseStringArray(obj.entryPoints); }

    return result;
}

// ============================================================================
// Utility Helpers
// ============================================================================

/**
 * Safely parse an unknown value as a string array.
 */
function parseStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) { return []; }
    return raw
        .filter(item => typeof item === 'string')
        .map(item => String(item));
}

/**
 * Normalize a file path: remove leading ./, convert backslashes to forward slashes.
 */
export function normalizePath(p: string): string {
    return p
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\/+/g, '/');
}
