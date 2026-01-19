/**
 * Bundled Pipelines Registry
 *
 * Registry of all bundled pipelines that ship with the extension.
 * These pipelines are read-only and can be copied to the workspace for customization.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { BundledPipelineManifest } from '../ui/types';

/**
 * Registry of all bundled pipelines that ship with the extension.
 * Add new entries here when adding bundled pipelines.
 */
export const BUNDLED_PIPELINES: BundledPipelineManifest[] = [
    {
        id: 'code-review-checklist',
        name: 'Code Review Checklist',
        description: 'Generate code review checklists from git diffs',
        category: 'code-review',
        directory: 'code-review-checklist',
        resources: ['checklist-template.md']
    },
    {
        id: 'bug-triage',
        name: 'Bug Triage',
        description: 'Classify and prioritize bug reports from CSV',
        category: 'data-processing',
        directory: 'bug-triage',
        resources: ['sample-input.csv']
    },
    {
        id: 'doc-generator',
        name: 'Documentation Generator',
        description: 'Generate documentation from code files',
        category: 'documentation',
        directory: 'doc-generator'
    },
    {
        id: 'multi-agent-research',
        name: 'Multi-Agent Research System',
        description: 'AI-decomposed orchestrator-worker pattern for parallel research (inspired by Anthropic)',
        category: 'research',
        directory: 'multi-agent-research',
        resources: ['README.md']
    }
];

/**
 * Get the absolute path to the bundled pipelines directory.
 * This resolves to the resources folder within the extension.
 */
export function getBundledPipelinesPath(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'resources', 'bundled-pipelines');
}

/**
 * Get manifest for a specific bundled pipeline by ID.
 */
export function getBundledPipelineManifest(id: string): BundledPipelineManifest | undefined {
    return BUNDLED_PIPELINES.find(p => p.id === id);
}

/**
 * Get all bundled pipeline manifests.
 */
export function getAllBundledPipelineManifests(): BundledPipelineManifest[] {
    return [...BUNDLED_PIPELINES];
}

/**
 * Check if a bundled pipeline ID is valid.
 */
export function isValidBundledPipelineId(id: string): boolean {
    return BUNDLED_PIPELINES.some(p => p.id === id);
}

/**
 * Get the full path to a bundled pipeline's directory.
 */
export function getBundledPipelineDirectory(
    context: vscode.ExtensionContext,
    bundledId: string
): string | undefined {
    const manifest = getBundledPipelineManifest(bundledId);
    if (!manifest) {
        return undefined;
    }
    return path.join(getBundledPipelinesPath(context), manifest.directory);
}

/**
 * Get the full path to a bundled pipeline's entry point file.
 */
export function getBundledPipelineEntryPoint(
    context: vscode.ExtensionContext,
    bundledId: string
): string | undefined {
    const manifest = getBundledPipelineManifest(bundledId);
    if (!manifest) {
        return undefined;
    }
    const bundledPath = getBundledPipelinesPath(context);
    const entryPoint = manifest.entryPoint || 'pipeline.yaml';
    return path.join(bundledPath, manifest.directory, entryPoint);
}
