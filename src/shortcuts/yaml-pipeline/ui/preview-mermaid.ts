/**
 * Pipeline Preview Mermaid Generator
 *
 * Generates Mermaid flowchart diagrams from pipeline configurations.
 * Supports interactive node clicks for showing details.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { PipelineConfig, CSVParseResult } from '../types';
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

    // INPUT node
    const inputLabel = buildInputNodeLabel(config, csvInfo, opts);
    lines.push(`    INPUT["${inputLabel}"]`);

    // MAP node
    const mapLabel = buildMapNodeLabel(config, opts);
    lines.push(`    MAP["${mapLabel}"]`);

    // REDUCE node
    const reduceLabel = buildReduceNodeLabel(config);
    lines.push(`    REDUCE["${reduceLabel}"]`);

    // Add resource nodes if enabled
    if (opts.includeResources && resources && resources.length > 0) {
        // Filter out the main input file to avoid duplication
        const csvPath = config.input.from?.path;
        const otherResources = resources.filter(r =>
            !csvPath || (r.relativePath !== csvPath && r.fileName !== csvPath)
        );

        otherResources.forEach((resource, idx) => {
            const resId = `RES${idx}`;
            const resLabel = buildResourceNodeLabel(resource);
            lines.push(`    ${resId}["${resLabel}"]`);
        });
    }

    // Add empty line before links
    lines.push('');

    // Links between nodes
    const inputLinkLabel = csvInfo
        ? `${csvInfo.headers.length} columns`
        : 'data';
    lines.push(`    INPUT -->|"${inputLinkLabel}"| MAP`);

    const mapLinkLabel = `${config.map.output.length} fields`;
    lines.push(`    MAP -->|"${mapLinkLabel}"| REDUCE`);

    // Add resource links
    if (opts.includeResources && resources && resources.length > 0) {
        const csvPath = config.input.from?.path;
        const otherResources = resources.filter(r =>
            !csvPath || (r.relativePath !== csvPath && r.fileName !== csvPath)
        );

        otherResources.forEach((_, idx) => {
            const resId = `RES${idx}`;
            lines.push(`    ${resId} -.->|"referenced"| MAP`);
        });
    }

    // Add empty line before click handlers
    lines.push('');

    // Click handlers - these will be handled by the webview
    lines.push('    click INPUT nodeClick');
    lines.push('    click MAP nodeClick');
    lines.push('    click REDUCE nodeClick');

    if (opts.includeResources && resources && resources.length > 0) {
        const csvPath = config.input.from?.path;
        const otherResources = resources.filter(r =>
            !csvPath || (r.relativePath !== csvPath && r.fileName !== csvPath)
        );

        otherResources.forEach((_, idx) => {
            lines.push(`    click RES${idx} nodeClick`);
        });
    }

    // Add empty line before styles
    lines.push('');

    // Styling
    lines.push('    style INPUT fill:#4CAF50,stroke:#2E7D32,color:#fff');
    lines.push('    style MAP fill:#2196F3,stroke:#1565C0,color:#fff');
    lines.push('    style REDUCE fill:#FF9800,stroke:#E65100,color:#fff');

    if (opts.includeResources && resources && resources.length > 0) {
        const csvPath = config.input.from?.path;
        const otherResources = resources.filter(r =>
            !csvPath || (r.relativePath !== csvPath && r.fileName !== csvPath)
        );

        otherResources.forEach((_, idx) => {
            lines.push(`    style RES${idx} fill:#9E9E9E,stroke:#616161,color:#fff`);
        });
    }

    return lines.join('\n');
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
    const hasCSVSource = config.input.from?.type === 'csv';
    
    if (hasInlineItems) {
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
            // Show file name truncated
            parts.push(truncateText(config.input.from!.path, 15));
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
    const inputType = hasInlineItems ? 'INLINE' : (config.input.from?.type?.toUpperCase() || 'UNKNOWN');
    const itemCount = hasInlineItems ? config.input.items!.length : csvInfo?.rowCount;

    lines.push('Pipeline Flow:');
    lines.push('');
    lines.push(`  ┌─────────────────┐`);
    lines.push(`  │  📥 INPUT       │`);
    lines.push(`  │  ${inputType.padEnd(13)} │`);
    if (itemCount !== undefined) {
        const countLabel = hasInlineItems ? 'items' : 'rows';
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
