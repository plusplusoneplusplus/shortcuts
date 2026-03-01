import type { PipelinePhase } from '@plusplusoneplusplus/pipeline-core';

/**
 * Compute the short badge text for an edge between two phases.
 */
export function getEdgeBadgeText(
    fromPhase: PipelinePhase,
    toPhase: PipelinePhase,
    config?: any,
): string | null {
    if (!config) return null;

    // Input → Filter or Input → Map: show data type/source
    if (fromPhase === 'input' && (toPhase === 'filter' || toPhase === 'map')) {
        return getInputBadge(config);
    }

    // Filter → Map: show "filtered"
    if (fromPhase === 'filter' && toPhase === 'map') {
        return 'filtered';
    }

    // Map → Reduce: show output field names
    if (fromPhase === 'map' && toPhase === 'reduce') {
        return getMapOutputBadge(config);
    }

    return null;
}

function getInputBadge(config: any): string | null {
    const input = config.input;
    if (!input) return null;

    if (input.from?.type === 'csv') return 'CSV';
    if (input.items && Array.isArray(input.items)) {
        return `${input.items.length} items`;
    }
    if (Array.isArray(input.from)) {
        return `${input.from.length} items`;
    }
    if (input.generate) return 'generated';

    return null;
}

function getMapOutputBadge(config: any): string | null {
    const output = config.map?.output;
    if (!output || !Array.isArray(output) || output.length === 0) return null;
    if (output.length <= 3) return `[${output.join(', ')}]`;
    return `[${output.slice(0, 2).join(', ')}, …+${output.length - 2}]`;
}

/**
 * Compute the full schema text for an edge hover tooltip.
 */
export function getEdgeSchemaText(
    fromPhase: PipelinePhase,
    toPhase: PipelinePhase,
    config?: any,
): string | null {
    if (!config) return null;

    if (fromPhase === 'input' && (toPhase === 'filter' || toPhase === 'map')) {
        return getInputSchemaText(config);
    }

    if (fromPhase === 'filter' && toPhase === 'map') {
        return getFilterSchemaText(config);
    }

    if (fromPhase === 'map' && toPhase === 'reduce') {
        return getMapReduceSchemaText(config);
    }

    return null;
}

function getInputSchemaText(config: any): string | null {
    const input = config.input;
    if (!input) return null;

    const fields = extractInputFields(input, config.map);
    if (!fields || fields.length === 0) return null;

    const source = input.from?.type === 'csv' ? `Source: CSV (${input.from.path})\n` : '';
    return `${source}Fields: ${fields.join(', ')}`;
}

function getFilterSchemaText(config: any): string | null {
    const filter = config.filter;
    if (!filter) return null;

    let text = `Filter type: ${filter.type}`;
    if (filter.rule?.rules && Array.isArray(filter.rule.rules)) {
        const ruleFields = filter.rule.rules.map((r: any) => r.field).filter(Boolean);
        if (ruleFields.length > 0) {
            text += `\nRule fields: ${ruleFields.join(', ')}`;
        }
    }
    return text;
}

function getMapReduceSchemaText(config: any): string | null {
    const inputFields = extractInputFields(config.input, config.map);
    const outputFields = config.map?.output;

    const parts: string[] = [];
    if (inputFields && inputFields.length > 0) {
        parts.push(`Input: ${inputFields.join(', ')}`);
    }
    if (outputFields && Array.isArray(outputFields) && outputFields.length > 0) {
        parts.push(`Output: ${outputFields.join(', ')}`);
    }
    if (parts.length === 0) return null;
    return parts.join('\n→ ');
}

/**
 * Extract input field names from config.
 * Sources: inline items keys, generate schema, or template variables in map prompt.
 */
function extractInputFields(input: any, map: any): string[] | null {
    if (!input) return null;

    // From inline items: use keys of first item
    if (input.items && Array.isArray(input.items) && input.items.length > 0) {
        return Object.keys(input.items[0]);
    }

    // From inline from array: use keys of first item
    if (Array.isArray(input.from) && input.from.length > 0) {
        return Object.keys(input.from[0]);
    }

    // From generate schema
    if (input.generate?.schema && Array.isArray(input.generate.schema)) {
        return input.generate.schema;
    }

    // Infer from map prompt template variables: {{varName}}
    // Exclude reserved: ITEMS, BATCH
    if (map?.prompt && typeof map.prompt === 'string') {
        const matches = map.prompt.match(/\{\{(\w+)\}\}/g);
        if (matches) {
            const reserved = new Set(['ITEMS', 'BATCH']);
            const fields = [...new Set(
                matches.map((m: string) => m.slice(2, -2)).filter((f: string) => !reserved.has(f))
            )];
            if (fields.length > 0) return fields;
        }
    }

    return null;
}
