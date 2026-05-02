/**
 * Comment anchor relocation logic for task comments.
 *
 * Extracted from task-comments-handler.ts to reduce file size.
 * Uses forge's batchRelocateAnchors / needsRelocationCheck to
 * update comment positions when the underlying file has drifted.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    batchRelocateAnchors,
    needsRelocationCheck,
} from '@plusplusoneplusplus/forge';
import type { BaseAnchorData } from '@plusplusoneplusplus/forge';
import type { TaskComment } from './task-comments-manager';
import type { TaskCommentsManager } from './task-comments-manager';

/**
 * Relocate comment anchors if the file content has drifted.
 * Returns the (possibly updated) comments array. Persists relocated positions.
 */
export async function relocateCommentsIfNeeded(
    mgr: TaskCommentsManager,
    wsId: string,
    taskPath: string,
    comments: TaskComment[],
    taskRootPath: string
): Promise<TaskComment[]> {
    const absolutePath = path.join(taskRootPath, taskPath);
    let content: string;
    try {
        content = await fs.promises.readFile(absolutePath, 'utf8');
    } catch {
        return comments;
    }

    // Filter comments that have anchors and need relocation
    const anchorsMap = new Map<string, BaseAnchorData>();
    for (const c of comments) {
        if (!c.anchor) continue;
        if (
            needsRelocationCheck(
                content,
                c.anchor,
                c.selection.startLine,
                c.selection.endLine,
                c.selection.startColumn,
                c.selection.endColumn
            )
        ) {
            anchorsMap.set(c.id, c.anchor);
        }
    }

    if (anchorsMap.size === 0) {
        return comments;
    }

    const results = batchRelocateAnchors(content, anchorsMap);

    let changed = false;
    for (const [id, result] of results) {
        if (result.found && result.startLine != null && result.endLine != null) {
            const comment = comments.find(c => c.id === id);
            if (comment) {
                comment.selection = {
                    startLine: result.startLine,
                    endLine: result.endLine,
                    startColumn: result.startColumn ?? comment.selection.startColumn,
                    endColumn: result.endColumn ?? comment.selection.endColumn,
                };
                if (comment.anchor) {
                    comment.anchor.originalLine = result.startLine;
                }
                changed = true;
            }
        }
    }

    if (changed) {
        await mgr.writeComments(wsId, taskPath, comments);
    }

    return comments;
}
