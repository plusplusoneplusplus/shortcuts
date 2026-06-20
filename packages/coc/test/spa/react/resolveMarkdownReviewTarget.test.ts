/**
 * Tests for resolveMarkdownReviewTarget — the shared path/workspace/fetchMode
 * resolution used by BOTH the floating MarkdownReviewDialog (via App.tsx) and
 * the docked source canvas's editable note body (AC-02).
 *
 * Guards the extraction of this logic out of App.tsx: the two surfaces must
 * compute identical {wsId, filePath, displayPath, fetchMode, taskRootPath}.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveMarkdownReviewTarget,
    type WorkspaceLike,
} from '../../../src/server/spa/client/react/shared/markdown-review/resolveMarkdownReviewTarget';

const WS: WorkspaceLike[] = [{ id: 'ws1', rootPath: '/home/u/proj' }];

describe('resolveMarkdownReviewTarget', () => {
    it('returns null for an empty file path', () => {
        expect(resolveMarkdownReviewTarget({ filePath: '' }, WS)).toBeNull();
    });

    it('returns null when no workspace contains the path', () => {
        expect(
            resolveMarkdownReviewTarget({ filePath: '/elsewhere/x.md' }, WS),
        ).toBeNull();
    });

    it('resolves an absolute path under .vscode/tasks to tasks mode + task-relative filePath', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: '/home/u/proj/.vscode/tasks/plan.md' },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: 'plan.md',
            displayPath: '/home/u/proj/.vscode/tasks/plan.md',
            fetchMode: 'tasks',
        });
    });

    it('resolves an absolute path outside tasks to auto mode + full filePath', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: '/home/u/proj/docs/readme.md' },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: '/home/u/proj/docs/readme.md',
            displayPath: '/home/u/proj/docs/readme.md',
            fetchMode: 'auto',
        });
    });

    it('uses the wsId hint fast-path for an absolute tasks path (carries taskRootPath)', () => {
        const target = resolveMarkdownReviewTarget(
            {
                filePath: '/home/u/proj/.vscode/tasks/plan.md',
                wsId: 'ws1',
                taskRootPath: '/home/u/proj/.vscode/tasks',
            },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: 'plan.md',
            displayPath: '/home/u/proj/.vscode/tasks/plan.md',
            fetchMode: 'tasks',
            taskRootPath: '/home/u/proj/.vscode/tasks',
        });
    });

    it('uses the wsId hint fast-path for a task-relative path (builds displayPath from taskRootPath)', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: 'plan.md', wsId: 'ws1', taskRootPath: '/home/u/proj/.vscode/tasks' },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: 'plan.md',
            displayPath: '/home/u/proj/.vscode/tasks/plan.md',
            fetchMode: 'tasks',
            taskRootPath: '/home/u/proj/.vscode/tasks',
        });
    });

    it('derives the tasks displayPath from the workspace root when no taskRootPath is given', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: 'plan.md', wsId: 'ws1' },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: 'plan.md',
            displayPath: '/home/u/proj/.vscode/tasks/plan.md',
            fetchMode: 'tasks',
            taskRootPath: undefined,
        });
    });

    it('falls through to prefix matching when the wsId hint is unknown', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: '/home/u/proj/docs/x.md', wsId: 'nope' },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: '/home/u/proj/docs/x.md',
            displayPath: '/home/u/proj/docs/x.md',
            fetchMode: 'auto',
        });
    });

    it('resolves a relative path against the source file directory', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: '../notes/x.md', sourceFilePath: '/home/u/proj/src/a.ts' },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: '/home/u/proj/notes/x.md',
            displayPath: '/home/u/proj/notes/x.md',
            fetchMode: 'auto',
        });
    });

    it('picks the longest-prefix (most specific) workspace root', () => {
        const nested: WorkspaceLike[] = [
            { id: 'parent', rootPath: '/home/u/proj' },
            { id: 'child', rootPath: '/home/u/proj/sub' },
        ];
        const target = resolveMarkdownReviewTarget(
            { filePath: '/home/u/proj/sub/docs/x.md' },
            nested,
        );
        expect(target?.wsId).toBe('child');
    });
});
