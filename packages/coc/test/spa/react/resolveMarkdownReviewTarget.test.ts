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

    it('anchors a bare relative link to the workspace root (auto mode) when no taskRootPath is given', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: 'plan.md', wsId: 'ws1' },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: '/home/u/proj/plan.md',
            displayPath: '/home/u/proj/plan.md',
            fetchMode: 'auto',
            taskRootPath: undefined,
        });
    });

    it('resolves a relative chat link (no taskRootPath) against the workspace root with content (regression)', () => {
        // The reported bug: `[desktop-debug-logging.goal.md](desktop-debug-logging.goal.md)`
        // clicked in chat previously routed to `.vscode/tasks/…` and 404'd into a blank
        // editor. It must resolve to the repo-root file and load it via the auto adapter.
        const target = resolveMarkdownReviewTarget(
            { filePath: 'desktop-debug-logging.goal.md', wsId: 'ws1' },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: '/home/u/proj/desktop-debug-logging.goal.md',
            displayPath: '/home/u/proj/desktop-debug-logging.goal.md',
            fetchMode: 'auto',
            taskRootPath: undefined,
        });
    });

    it('still detects a .vscode/tasks/ file reached via root-anchoring (no taskRootPath)', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: '.vscode/tasks/plan.md', wsId: 'ws1' },
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

    it('anchors a relative link to the sourceFilePath directory (wins over the workspace root) in the fast-path', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: 'sibling.md', wsId: 'ws1', sourceFilePath: '/home/u/proj/docs/guide.md' },
            WS,
        );
        expect(target).toEqual({
            wsId: 'ws1',
            filePath: '/home/u/proj/docs/sibling.md',
            displayPath: '/home/u/proj/docs/sibling.md',
            fetchMode: 'auto',
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

describe('resolveMarkdownReviewTarget — tilde-prefixed CoC note hrefs', () => {
    // The screenshot link points at a CoC note under the workspace clone storage.
    // Assistant markdown links can carry the literal `~/.coc/repos/<wsId>/...`
    // href, which must expand to an absolute note path under the workspace so the
    // editable NoteEditor loads it (instead of misreading `~/...` as task-relative).
    const HOME_WS: WorkspaceLike[] = [
        { id: 'ws-hcv3mg', rootPath: '/Users/yihengtao/.coc/repos/ws-hcv3mg' },
    ];
    const NOTE_ABS = '/Users/yihengtao/.coc/repos/ws-hcv3mg/notes/Plans/SourceCanvas/chat-note-links.md';
    const NOTE_TILDE = '~/.coc/repos/ws-hcv3mg/notes/Plans/SourceCanvas/chat-note-links.md';

    it('expands the screenshot `~/.coc/repos/<wsId>/notes/...` href through the hinted workspace home (auto mode, no tasks misread)', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: NOTE_TILDE, wsId: 'ws-hcv3mg' },
            HOME_WS,
        );
        expect(target).toEqual({
            wsId: 'ws-hcv3mg',
            filePath: NOTE_ABS,
            displayPath: NOTE_ABS,
            fetchMode: 'auto',
            taskRootPath: undefined,
        });
    });

    it('expands a tilde note href with no wsId hint via a home-rooted workspace, then prefix-matches', () => {
        const target = resolveMarkdownReviewTarget(
            { filePath: '~/.coc/repos/ws-hcv3mg/notes/x.md' },
            HOME_WS,
        );
        expect(target).toEqual({
            wsId: 'ws-hcv3mg',
            filePath: '/Users/yihengtao/.coc/repos/ws-hcv3mg/notes/x.md',
            displayPath: '/Users/yihengtao/.coc/repos/ws-hcv3mg/notes/x.md',
            fetchMode: 'auto',
        });
    });

    it('derives home from the HINTED workspace in multi-repo (remote-clone home differs from local)', () => {
        const multi: WorkspaceLike[] = [
            { id: 'ws-local', rootPath: '/Users/local/.coc/repos/ws-local' },
            { id: 'ws-remote', rootPath: '/home/remote/.coc/repos/ws-remote' },
        ];
        const target = resolveMarkdownReviewTarget(
            { filePath: '~/.coc/repos/ws-remote/notes/r.md', wsId: 'ws-remote' },
            multi,
        );
        expect(target).toEqual({
            wsId: 'ws-remote',
            filePath: '/home/remote/.coc/repos/ws-remote/notes/r.md',
            displayPath: '/home/remote/.coc/repos/ws-remote/notes/r.md',
            fetchMode: 'auto',
            taskRootPath: undefined,
        });
    });

    it('leaves a tilde href unexpanded (returns null) when no workspace is home-rooted', () => {
        const nonHome: WorkspaceLike[] = [{ id: 'ws-opt', rootPath: '/opt/repos/ws-opt' }];
        expect(
            resolveMarkdownReviewTarget({ filePath: '~/.coc/repos/ws-opt/notes/x.md' }, nonHome),
        ).toBeNull();
    });
});
