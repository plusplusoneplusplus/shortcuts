/**
 * Task parsing utilities. No editor dependencies.
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { TaskStatus } from './types';

/** Valid task status values */
export const VALID_TASK_STATUSES: TaskStatus[] = ['pending', 'in-progress', 'done', 'future'];

/** Common document type suffixes used for grouping related task files */
export const COMMON_DOC_TYPES: string[] = [
    'plan', 'spec', 'test', 'notes', 'todo', 'readme',
    'design', 'impl', 'implementation', 'review', 'checklist',
    'requirements', 'analysis', 'research', 'summary', 'log',
    'draft', 'final', 'v1', 'v2', 'v3', 'old', 'new', 'backup'
];

/**
 * Reads the file's frontmatter.
 * @param filePath - Absolute path to the markdown file
 * @returns undefined if no valid status was found
 */
export function parseTaskStatus(filePath: string): TaskStatus | undefined {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');

        // Check for frontmatter (starts with ---)
        if (!content.startsWith('---')) {
            return undefined;
        }

        // Find the closing ---
        const endIndex = content.indexOf('---', 3);
        if (endIndex === -1) {
            return undefined;
        }

        const frontmatterContent = content.substring(3, endIndex).trim();
        if (!frontmatterContent) {
            return undefined;
        }

        const frontmatter = yaml.load(frontmatterContent) as Record<string, unknown>;
        if (!frontmatter || typeof frontmatter !== 'object') {
            return undefined;
        }

        // Extract status field
        const status = frontmatter.status;
        if (typeof status === 'string' && VALID_TASK_STATUSES.includes(status as TaskStatus)) {
            return status as TaskStatus;
        }

        return undefined;
    } catch {
        // Silently ignore parsing errors
        return undefined;
    }
}

/**
 * Creates frontmatter if it doesn't exist.
 * @param filePath - Absolute path to the markdown file
 */
export async function updateTaskStatus(filePath: string, status: TaskStatus): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8');

    if (content.startsWith('---')) {
        // Has existing frontmatter - update it
        const endIndex = content.indexOf('---', 3);
        if (endIndex !== -1) {
            const frontmatterContent = content.substring(3, endIndex).trim();
            let frontmatter: Record<string, unknown> = {};

            if (frontmatterContent) {
                try {
                    frontmatter = (yaml.load(frontmatterContent) as Record<string, unknown>) || {};
                } catch {
                    frontmatter = {};
                }
            }

            frontmatter.status = status;

            // Rebuild the file
            const newFrontmatter = yaml.dump(frontmatter, { lineWidth: -1 }).trim();
            const bodyContent = content.substring(endIndex + 3);
            const newContent = `---\n${newFrontmatter}\n---${bodyContent}`;

            await fs.promises.writeFile(filePath, newContent, 'utf-8');
            return;
        }
    }

    // No frontmatter - add it
    const newFrontmatter = yaml.dump({ status }, { lineWidth: -1 }).trim();
    const newContent = `---\n${newFrontmatter}\n---\n\n${content}`;
    await fs.promises.writeFile(filePath, newContent, 'utf-8');
}

/**
 * Examples:
 *   "task1.md" -> { baseName: "task1", docType: undefined }
 *   "task1.plan.md" -> { baseName: "task1", docType: "plan" }
 *   "task1.test.spec.md" -> { baseName: "task1.test", docType: "spec" }
 */
export function parseFileName(fileName: string): { baseName: string; docType?: string } {
    // Remove .md extension
    const withoutMd = fileName.replace(/\.md$/i, '');

    // Split by dot to find potential doc type suffix
    const parts = withoutMd.split('.');

    if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1].toLowerCase();

        if (COMMON_DOC_TYPES.includes(lastPart) || /^v\d+$/.test(lastPart)) {
            return {
                baseName: parts.slice(0, -1).join('.'),
                docType: parts[parts.length - 1]
            };
        }
    }

    // No doc type suffix found
    return { baseName: withoutMd, docType: undefined };
}

/**
 * Replaces invalid filename characters and whitespace with hyphens,
 * collapses consecutive hyphens, and trims leading/trailing hyphens.
 */
export function sanitizeFileName(name: string): string {
    return name
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .trim();
}
