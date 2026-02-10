/**
 * Analysis Prompt Templates
 *
 * Prompt templates for Phase 3 (Deep Analysis). Each module is analyzed
 * by an AI session with MCP tool access. Three depth variants control
 * the level of investigation detail.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { MODULE_ANALYSIS_SCHEMA } from '../schemas';

// ============================================================================
// Depth Variants
// ============================================================================

/**
 * Shallow analysis: overview + public API only.
 * Fastest, least detailed — suitable for large repos or quick surveys.
 */
const SHALLOW_INVESTIGATION_STEPS = `
Use the grep, glob, and view tools to investigate this module:

1. Read the main entry file(s) and understand the public API
2. Identify the module's primary purpose and key abstractions

Return a JSON object matching the schema below. For shallow analysis, you may leave
internalArchitecture, dataFlow, and errorHandling as brief one-sentence summaries.
Keep codeExamples to 1 example maximum.`;

/**
 * Normal analysis: full 7-step investigation.
 * Balanced depth — default for most projects.
 */
const NORMAL_INVESTIGATION_STEPS = `
Use the grep, glob, and view tools to deeply investigate this module:

1. Read all key files and understand the public API
2. Trace the main control flow and data flow
3. Identify design patterns and coding conventions
4. Find error handling strategies
5. Extract 2-3 illustrative code examples
6. Map internal dependencies to external packages
7. Suggest a Mermaid diagram showing the module's internal structure

Return a JSON object matching the schema below.`;

/**
 * Deep analysis: exhaustive investigation including performance and edge cases.
 * Most thorough — suitable for critical modules or small repos.
 */
const DEEP_INVESTIGATION_STEPS = `
Use the grep, glob, and view tools to exhaustively investigate this module:

1. Read ALL files in the module, not just key files
2. Map the complete public API with full type signatures
3. Trace every control flow path and data flow
4. Identify ALL design patterns and coding conventions
5. Analyze error handling, edge cases, and error recovery strategies
6. Extract 3-5 illustrative code examples covering different aspects
7. Map ALL internal dependencies and external packages with usage details
8. Analyze performance characteristics and potential bottlenecks
9. Identify any security considerations or sensitive operations
10. Suggest a detailed Mermaid diagram showing the module's internal structure

Return a JSON object matching the schema below. Be thorough and comprehensive —
include all details you can find.`;

// ============================================================================
// Template
// ============================================================================

/**
 * Get the investigation steps for a given depth level.
 */
export function getInvestigationSteps(depth: 'shallow' | 'normal' | 'deep'): string {
    switch (depth) {
        case 'shallow': return SHALLOW_INVESTIGATION_STEPS;
        case 'deep': return DEEP_INVESTIGATION_STEPS;
        default: return NORMAL_INVESTIGATION_STEPS;
    }
}

/**
 * Build the full analysis prompt template.
 *
 * Uses {{variable}} placeholders that will be substituted by the map-reduce framework:
 * - {{moduleName}}, {{moduleId}}, {{modulePath}}, {{purpose}}
 * - {{keyFiles}}, {{dependencies}}, {{dependents}}
 * - {{complexity}}, {{category}}, {{projectName}}, {{architectureNotes}}
 *
 * @param depth Analysis depth level
 * @returns Prompt template string with {{variable}} placeholders
 */
export function buildAnalysisPromptTemplate(depth: 'shallow' | 'normal' | 'deep'): string {
    const steps = getInvestigationSteps(depth);

    return `You are analyzing module "{{moduleName}}" in the {{projectName}} codebase.

Module ID: {{moduleId}}
Module path: {{modulePath}}
Purpose: {{purpose}}
Complexity: {{complexity}}
Category: {{category}}
Key files: {{keyFiles}}
Dependencies (other modules): {{dependencies}}
Dependents (modules that depend on this): {{dependents}}

Architecture context:
{{architectureNotes}}
${steps}

**Output JSON Schema:**
\`\`\`json
${MODULE_ANALYSIS_SCHEMA}
\`\`\`

IMPORTANT:
- The "moduleId" field MUST be exactly "{{moduleId}}"
- All file paths should be relative to the repository root
- The "suggestedDiagram" field should contain valid Mermaid syntax
- The "sourceFiles" field should list ALL files you read or examined during analysis
- If you cannot determine a field, use an empty string or empty array as appropriate
- Return ONLY the JSON object, no additional text before or after`;
}

/**
 * Get the list of output fields expected from the analysis prompt.
 * These fields are used by the map-reduce framework to parse AI responses.
 */
export function getAnalysisOutputFields(): string[] {
    return [
        'moduleId',
        'overview',
        'keyConcepts',
        'publicAPI',
        'internalArchitecture',
        'dataFlow',
        'patterns',
        'errorHandling',
        'codeExamples',
        'dependencies',
        'suggestedDiagram',
        'sourceFiles',
    ];
}
