/**
 * Pipeline Preview Mermaid Generator
 *
 * Generates Mermaid flowchart diagrams from pipeline configurations.
 * Supports interactive node clicks for showing details.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { PipelineConfig, CSVParseResult, isCSVSource, PromptItem } from '../types';
import { ResourceFileInfo } from './types';

/**
 * Node types in the pipeline diagram
 */
export type PipelineNodeType = 'input' | 'map' | 'reduce' | 'resource';

/**
 * Data associated with each node for detail display
 */
export interface PipelineNodeData {
    type: PipelineNodeType;
    config: PipelineConfig;
    csvInfo?: CSVParseResult;
    resource?: ResourceFileInfo;
}

/**
 * Options for mermaid diagram generation
 */
export interface MermaidGenerationOptions {
    /** Include resource files as nodes */
    includeResources?: boolean;
    /** Theme: 'dark' or 'default' */
    theme?: 'dark' | 'default';
    /** Show row/column counts in nodes */
    showCounts?: boolean;
}

const DEFAULT_OPTIONS: Required<MermaidGenerationOptions> = {
    includeResources: true,
    theme: 'default',
    showCounts: true
};

/**
 * Escape special characters for Mermaid labels
 */
export function escapeMermaidLabel(text: string): string {
    return text
        .replace(/"/g, '#quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number = 20): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Generate Mermaid flowchart diagram from pipeline configuration
 *
 * @param config Pipeline configuration from YAML
 * @param csvInfo Optional CSV parse result for row/column counts
 * @param resources Optional resource files in the pipeline package
 * @param options Generation options
 * @returns Mermaid diagram string
 */
export function generatePipelineMermaid(
    config: PipelineConfig,
    csvInfo?: CSVParseResult,
    resources?: ResourceFileInfo[],
    options?: MermaidGenerationOptions
): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const lines: string[] = [];

    // Start with flowchart definition
    lines.push('graph TB');

    // Check if this is a generate pipeline
    const hasGenerateConfig = config.input?.generate && 
        typeof config.input.generate === 'object' &&
        'prompt' in config.input.generate &&
        'schema' in config.input.generate;

    // Check if there's a CSV source file
    const hasCSVSource = isCSVSource(config.input.from);
    const csvPath = hasCSVSource ? (config.input.from as { path: string }).path : undefined;

    // Find the input file resource info (if available)
    const inputFileResource = csvPath && resources
        ? resources.find(r => r.relativePath === csvPath || r.fileName === csvPath)
        : undefined;

    // CSV_FILE node (only if using CSV source)
    if (hasCSVSource && csvPath) {
        const csvFileLabel = buildCSVFileNodeLabel(csvPath, csvInfo, inputFileResource);
        lines.push(`    CSV_FILE["${csvFileLabel}"]`);
    }

    // GENERATE node (if applicable)
    if (hasGenerateConfig) {
        const generateLabel = buildGenerateNodeLabel(config);
        lines.push(`    GENERATE["${generateLabel}"]`);
    }

    // INPUT node
    const inputLabel = buildInputNodeLabel(config, csvInfo, opts);
    lines.push(`    INPUT["${inputLabel}"]`);

    // MAP node
    const mapLabel = buildMapNodeLabel(config, opts);
    lines.push(`    MAP["${mapLabel}"]`);

    // REDUCE node
    const reduceLabel = buildReduceNodeLabel(config);
    lines.push(`    REDUCE["${reduceLabel}"]`);

    // Add empty line before links
    lines.push('');

    // Links between nodes
    // CSV file -> INPUT (if CSV source)
    if (hasCSVSource && csvPath) {
        const csvLinkLabel = csvInfo
            ? `${csvInfo.rowCount} rows`
            : 'reads';
        lines.push(`    CSV_FILE -->|"${csvLinkLabel}"| INPUT`);
    }

    if (hasGenerateConfig) {
        lines.push(`    GENERATE -->|"AI generates"| INPUT`);
    }

    const inputLinkLabel = csvInfo
        ? `${csvInfo.headers.length} columns`
        : 'data';
    lines.push(`    INPUT -->|"${inputLinkLabel}"| MAP`);

    const outputFields = config.map.output || [];
    const mapLinkLabel = outputFields.length > 0 ? `${outputFields.length} fields` : 'text';
    lines.push(`    MAP -->|"${mapLinkLabel}"| REDUCE`);

    // Add empty line before click handlers
    lines.push('');

    // Click handlers - these will be handled by the webview
    if (hasCSVSource && csvPath) {
        lines.push('    click CSV_FILE nodeClick');
    }
    if (hasGenerateConfig) {
        lines.push('    click GENERATE nodeClick');
    }
    lines.push('    click INPUT nodeClick');
    lines.push('    click MAP nodeClick');
    lines.push('    click REDUCE nodeClick');

    // Add empty line before styles
    lines.push('');

    // Styling
    if (hasCSVSource && csvPath) {
        lines.push('    style CSV_FILE fill:#9E9E9E,stroke:#616161,color:#fff');
    }
    if (hasGenerateConfig) {
        lines.push('    style GENERATE fill:#9C27B0,stroke:#6A1B9A,color:#fff');
    }
    lines.push('    style INPUT fill:#4CAF50,stroke:#2E7D32,color:#fff');
    lines.push('    style MAP fill:#2196F3,stroke:#1565C0,color:#fff');
    lines.push('    style REDUCE fill:#FF9800,stroke:#E65100,color:#fff');

    return lines.join('\n');
}

/**
 * Build the label for the GENERATE node
 */
function buildGenerateNodeLabel(config: PipelineConfig): string {
    const parts: string[] = ['🤖 GENERATE'];
    parts.push('AI Input');

    const generateConfig = config.input?.generate;
    if (generateConfig && 'schema' in generateConfig) {
        parts.push(`${generateConfig.schema.length} fields`);
    }

    return escapeMermaidLabel(parts.join('<br/>'));
}

/**
 * Build the label for the CSV_FILE node (input file)
 */
function buildCSVFileNodeLabel(
    csvPath: string,
    csvInfo?: CSVParseResult,
    resourceInfo?: ResourceFileInfo
): string {
    const parts: string[] = ['📄 CSV File'];
    parts.push(truncateText(csvPath, 18));

    if (resourceInfo) {
        parts.push(formatFileSize(resourceInfo.size));
    } else if (csvInfo) {
        parts.push(`${csvInfo.headers.length} cols`);
    }

    return escapeMermaidLabel(parts.join('<br/>'));
}

/**
 * Build the label for the INPUT node
 */
function buildInputNodeLabel(
    config: PipelineConfig,
    csvInfo?: CSVParseResult,
    opts?: MermaidGenerationOptions
): string {
    const parts: string[] = ['📥 INPUT'];
    
    // Determine input type based on new config structure
    const hasInlineItems = config.input.items && config.input.items.length > 0;
    const hasCSVSource = isCSVSource(config.input.from);
    const hasInlineArrayFrom = Array.isArray(config.input.from);
    const hasGenerateConfig = config.input?.generate && 
        typeof config.input.generate === 'object' &&
        'prompt' in config.input.generate &&
        'schema' in config.input.generate;
    
    if (hasGenerateConfig) {
        parts.push('AI-GENERATED');
        const schema = (config.input.generate as { schema: string[] }).schema;
        parts.push(`${schema.length} fields`);
    } else if (hasInlineItems) {
        parts.push('INLINE');
        if (opts?.showCounts) {
            const itemCount = config.input.items!.length;
            const limit = config.input.limit;
            const displayCount = limit ? Math.min(itemCount, limit) : itemCount;
            parts.push(`${displayCount} items`);
        }
    } else if (hasCSVSource) {
        parts.push('CSV');
        if (opts?.showCounts && csvInfo) {
            const rowCount = csvInfo.rowCount;
            const limit = config.input.limit;
            const displayCount = limit ? Math.min(rowCount, limit) : rowCount;
            parts.push(`${displayCount} rows`);
        } else {
            // Show file name truncated - hasCSVSource is true so from is CSVSource
            parts.push(truncateText((config.input.from as { path: string }).path, 15));
        }
    } else if (hasInlineArrayFrom) {
        parts.push('INLINE_ARRAY');
        if (opts?.showCounts) {
            const itemCount = (config.input.from as PromptItem[]).length;
            const limit = config.input.limit;
            const displayCount = limit ? Math.min(itemCount, limit) : itemCount;
            parts.push(`${displayCount} items`);
        }
    } else {
        parts.push('UNKNOWN');
    }

    return escapeMermaidLabel(parts.join('<br/>'));
}

/**
 * Build the label for the MAP node
 */
function buildMapNodeLabel(
    config: PipelineConfig,
    opts?: MermaidGenerationOptions
): string {
    const parts: string[] = ['🔄 MAP'];
    parts.push('AI Processing');

    if (opts?.showCounts) {
        const parallel = config.map.parallel || 5;
        parts.push(`${parallel} parallel`);
    }

    return escapeMermaidLabel(parts.join('<br/>'));
}

/**
 * Build the label for the REDUCE node
 */
function buildReduceNodeLabel(config: PipelineConfig): string {
    const parts: string[] = ['📤 REDUCE'];
    parts.push(`Type: ${config.reduce.type}`);

    return escapeMermaidLabel(parts.join('<br/>'));
}

/**
 * Build the label for a resource node
 */
function buildResourceNodeLabel(resource: ResourceFileInfo): string {
    const parts: string[] = ['📁 Resource'];
    parts.push(truncateText(resource.fileName, 15));

    return escapeMermaidLabel(parts.join('<br/>'));
}

/**
 * Extract template variables from a prompt string
 * Finds all {{variable}} patterns
 */
export function extractTemplateVariables(prompt: string): string[] {
    const regex = /\{\{(\w+)\}\}/g;
    const variables: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(prompt)) !== null) {
        if (!variables.includes(match[1])) {
            variables.push(match[1]);
        }
    }

    return variables;
}

/**
 * Check if all template variables exist in CSV headers
 */
export function validateTemplateVariables(
    prompt: string,
    headers: string[]
): { valid: boolean; missingVariables: string[] } {
    const variables = extractTemplateVariables(prompt);
    const headerSet = new Set(headers);
    const missingVariables = variables.filter(v => !headerSet.has(v));

    return {
        valid: missingVariables.length === 0,
        missingVariables
    };
}

/**
 * Estimate pipeline execution time based on row count and parallelism
 */
export function estimateExecutionTime(
    rowCount: number,
    parallel: number = 5,
    avgSecondsPerRow: number = 2
): string {
    const totalSeconds = Math.ceil((rowCount / parallel) * avgSecondsPerRow);

    if (totalSeconds < 60) {
        return `~${totalSeconds} seconds`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (seconds === 0) {
        return `~${minutes} minute${minutes > 1 ? 's' : ''}`;
    }

    return `~${minutes}m ${seconds}s`;
}

/**
 * Generate a simple text representation of the pipeline flow
 * Used as fallback or for accessibility
 */
export function generatePipelineTextDiagram(
    config: PipelineConfig,
    csvInfo?: CSVParseResult
): string {
    const lines: string[] = [];
    
    // Determine input type based on new config structure
    const hasInlineItems = config.input.items && config.input.items.length > 0;
    const hasCSVSource = isCSVSource(config.input.from);
    const hasInlineArrayFrom = Array.isArray(config.input.from);
    const hasGenerateConfig = config.input?.generate && 
        typeof config.input.generate === 'object' &&
        'prompt' in config.input.generate &&
        'schema' in config.input.generate;
    
    let inputType: string;
    let itemCount: number | undefined;
    
    if (hasGenerateConfig) {
        inputType = 'AI-GENERATED';
        itemCount = (config.input.generate as { schema: string[] }).schema.length;
    } else if (hasInlineItems) {
        inputType = 'INLINE';
        itemCount = config.input.items!.length;
    } else if (hasCSVSource) {
        inputType = 'CSV';
        itemCount = csvInfo?.rowCount;
    } else if (hasInlineArrayFrom) {
        inputType = 'INLINE_ARRAY';
        itemCount = (config.input.from as PromptItem[]).length;
    } else {
        inputType = 'UNKNOWN';
        itemCount = undefined;
    }

    lines.push('Pipeline Flow:');
    lines.push('');
    
    // Add GENERATE node if applicable
    if (hasGenerateConfig) {
        lines.push(`  ┌─────────────────┐`);
        lines.push(`  │  🤖 GENERATE    │`);
        lines.push(`  │  AI Input       │`);
        lines.push(`  └────────┬────────┘`);
        lines.push(`           │`);
        lines.push(`           ▼`);
    }
    
    lines.push(`  ┌─────────────────┐`);
    lines.push(`  │  📥 INPUT       │`);
    lines.push(`  │  ${inputType.padEnd(13)} │`);
    if (itemCount !== undefined) {
        const countLabel = hasGenerateConfig ? 'fields' : (hasInlineItems || hasInlineArrayFrom ? 'items' : 'rows');
        lines.push(`  │  ${String(itemCount).padEnd(5)} ${countLabel.padEnd(6)} │`);
    }
    lines.push(`  └────────┬────────┘`);
    lines.push(`           │`);
    lines.push(`           ▼`);
    lines.push(`  ┌─────────────────┐`);
    lines.push(`  │  🔄 MAP         │`);
    lines.push(`  │  AI Processing  │`);
    lines.push(`  │  ${String(config.map.parallel || 5).padEnd(2)} parallel   │`);
    lines.push(`  └────────┬────────┘`);
    lines.push(`           │`);
    lines.push(`           ▼`);
    lines.push(`  ┌─────────────────┐`);
    lines.push(`  │  📤 REDUCE      │`);
    lines.push(`  │  ${config.reduce.type.padEnd(13)} │`);
    lines.push(`  └─────────────────┘`);

    return lines.join('\n');
}
