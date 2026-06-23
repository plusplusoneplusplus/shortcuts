/**
 * Workflow utility functions and types.
 *
 * Extracted from workflows-handler.ts to keep each module focused.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { discoverPipelines } from '../core/api-handler';
import { validatePipeline } from '../../commands/validate';

// ============================================================================
// Helpers
// ============================================================================

export async function resolveWorkspace(store: ProcessStore, id: string) {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === id);
}

/**
 * Resolve a user-supplied path against a base directory and validate
 * that the result is inside (or equal to) the base directory.
 * Returns the resolved absolute path, or null if the check fails.
 */
export function resolveAndValidatePath(base: string, name: string): string | null {
    const resolved = path.resolve(base, name);
    if (isWithinDirectory(resolved, base)) {
        return resolved;
    }
    return null;
}

/** Enriched workflow info with validation results. */
export interface EnrichedWorkflow {
    name: string;
    path: string;
    description?: string;
    isValid: boolean;
    validationErrors: string[];
}

/**
 * Discover workflows and enrich each with description and validation info.
 */
export async function discoverAndEnrichWorkflows(pipelinesDir: string): Promise<EnrichedWorkflow[]> {
    const basic = await discoverPipelines(pipelinesDir);
    return basic.map(p => {
        const yamlPath = path.join(p.path, 'pipeline.yaml');
        let description: string | undefined;
        let isValid = false;
        let validationErrors: string[] = [];

        // Read description from raw YAML
        try {
            const content = fs.readFileSync(yamlPath, 'utf-8');
            const parsed = yaml.load(content) as any;
            if (parsed && typeof parsed === 'object' && typeof parsed.description === 'string') {
                description = parsed.description;
            }
        } catch {
            // Ignore read errors — validation will catch them
        }

        // Validate workflow
        try {
            const result = validatePipeline(yamlPath);
            isValid = result.valid;
            validationErrors = result.checks
                .filter(c => c.status === 'fail')
                .map(c => c.detail ?? c.label);
        } catch {
            isValid = false;
            validationErrors = ['Failed to validate workflow'];
        }

        return { name: p.name, path: p.path, description, isValid, validationErrors };
    });
}
