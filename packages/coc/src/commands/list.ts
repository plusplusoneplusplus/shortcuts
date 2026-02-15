/**
 * List Command
 *
 * Lists pipeline packages in a directory.
 * Discovers subdirectories containing pipeline.yaml files.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
    readCSVFileSync,
    resolveCSVPath,
    isCSVSource,
    isGenerateConfig,
} from '@plusplusoneplusplus/pipeline-core';
import type { PipelineConfig } from '@plusplusoneplusplus/pipeline-core';
import {
    bold,
    gray,
    dim,
    printError,
    printHeader,
    printWarning,
} from '../logger';
import type { OutputFormat } from '../output-formatter';

// ============================================================================
// Types
// ============================================================================

/**
 * Information about a discovered pipeline package
 */
export interface PipelinePackageInfo {
    /** Pipeline package name (directory name) */
    name: string;
    /** Pipeline description from YAML */
    description: string;
    /** Input type (csv, inline, generate) */
    inputType: string;
    /** Number of items (if determinable) */
    itemCount: number | undefined;
    /** Path to pipeline.yaml */
    path: string;
}

// ============================================================================
// List Command
// ============================================================================

/**
 * Execute the list command
 *
 * @param dirPath Directory to scan for pipeline packages
 * @param format Output format
 * @returns exit code (0 = success)
 */
export function executeList(dirPath: string, format: OutputFormat = 'table'): number {
    const resolved = path.resolve(dirPath);

    if (!fs.existsSync(resolved)) {
        printError(`Directory not found: ${dirPath}`);
        return 2;
    }

    if (!fs.statSync(resolved).isDirectory()) {
        printError(`Not a directory: ${dirPath}`);
        return 2;
    }

    const packages = discoverPipelines(resolved);

    if (packages.length === 0) {
        printWarning(`No pipeline packages found in ${dirPath}`);
        return 0;
    }

    const output = formatList(packages, format);
    process.stdout.write(output + '\n');

    return 0;
}

/**
 * Discover pipeline packages in a directory
 */
export function discoverPipelines(dirPath: string): PipelinePackageInfo[] {
    const packages: PipelinePackageInfo[] = [];

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return packages;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) { continue; }

        const yamlPath = path.join(dirPath, entry.name, 'pipeline.yaml');
        if (!fs.existsSync(yamlPath)) { continue; }

        try {
            const content = fs.readFileSync(yamlPath, 'utf-8');
            const config = yaml.load(content) as PipelineConfig;
            if (!config || typeof config !== 'object' || !config.name) {
                throw new Error('Invalid pipeline config');
            }
            const info = buildPackageInfo(entry.name, config, path.dirname(yamlPath));
            packages.push(info);
        } catch {
            // Skip invalid pipelines in listing
            packages.push({
                name: entry.name,
                description: '(invalid pipeline.yaml)',
                inputType: '-',
                itemCount: undefined,
                path: yamlPath,
            });
        }
    }

    return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build package info from a parsed pipeline config
 */
function buildPackageInfo(
    name: string,
    config: PipelineConfig,
    pipelineDir: string
): PipelinePackageInfo {
    let inputType = '-';
    let itemCount: number | undefined;

    const { input } = config;

    if (input.items) {
        inputType = 'inline';
        itemCount = input.items.length;
    } else if (input.from && isCSVSource(input.from)) {
        inputType = 'CSV';
        try {
            const csvPath = resolveCSVPath(input.from.path, pipelineDir);
            if (fs.existsSync(csvPath)) {
                const csv = readCSVFileSync(csvPath, {
                    delimiter: input.from.delimiter,
                });
                itemCount = csv.rowCount;
            }
        } catch {
            // Count not available
        }
    } else if (input.from && Array.isArray(input.from)) {
        inputType = 'list';
        itemCount = input.from.length;
    } else if (input.generate && isGenerateConfig(input.generate)) {
        inputType = 'generate';
    }

    return {
        name,
        description: config.name || '',
        inputType,
        itemCount,
        path: path.join(pipelineDir, 'pipeline.yaml'),
    };
}

// ============================================================================
// Formatting
// ============================================================================

function formatList(packages: PipelinePackageInfo[], format: OutputFormat): string {
    switch (format) {
        case 'json':
            return JSON.stringify(packages, null, 2);
        case 'csv':
            return formatCSV(packages);
        case 'markdown':
            return formatMarkdownTable(packages);
        case 'table':
        default:
            return formatTableOutput(packages);
    }
}

function formatCSV(packages: PipelinePackageInfo[]): string {
    const lines = ['name,description,input,items'];
    for (const pkg of packages) {
        const desc = pkg.description.includes(',') ? `"${pkg.description}"` : pkg.description;
        lines.push(`${pkg.name},${desc},${pkg.inputType},${pkg.itemCount ?? '-'}`);
    }
    return lines.join('\n');
}

function formatMarkdownTable(packages: PipelinePackageInfo[]): string {
    const lines = [
        '| Name | Description | Input | Items |',
        '| --- | --- | --- | --- |',
    ];
    for (const pkg of packages) {
        lines.push(`| ${pkg.name} | ${pkg.description} | ${pkg.inputType} | ${pkg.itemCount ?? '-'} |`);
    }
    return lines.join('\n');
}

function formatTableOutput(packages: PipelinePackageInfo[]): string {
    // Calculate column widths
    const nameWidth = Math.max(4, ...packages.map(p => p.name.length));
    const descWidth = Math.max(11, ...packages.map(p => Math.min(p.description.length, 40)));
    const inputWidth = Math.max(5, ...packages.map(p => p.inputType.length));

    const lines: string[] = [];

    // Header
    const header = [
        padRight(bold('NAME'), nameWidth),
        padRight(bold('DESCRIPTION'), descWidth),
        padRight(bold('INPUT'), inputWidth),
        bold('ITEMS'),
    ].join('  ');
    lines.push(header);

    // Separator
    const sep = [
        gray('─'.repeat(nameWidth)),
        gray('─'.repeat(descWidth)),
        gray('─'.repeat(inputWidth)),
        gray('─'.repeat(5)),
    ].join('──');
    lines.push(sep);

    // Rows
    for (const pkg of packages) {
        const desc = pkg.description.length > 40
            ? pkg.description.substring(0, 37) + '...'
            : pkg.description;
        const row = [
            padRight(pkg.name, nameWidth),
            padRight(desc, descWidth),
            padRight(pkg.inputType, inputWidth),
            pkg.itemCount !== undefined ? String(pkg.itemCount) : dim('-'),
        ].join('  ');
        lines.push(row);
    }

    return lines.join('\n');
}

function padRight(str: string, width: number): string {
    if (str.length >= width) { return str; }
    return str + ' '.repeat(width - str.length);
}
