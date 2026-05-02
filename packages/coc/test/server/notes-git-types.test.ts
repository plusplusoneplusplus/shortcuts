/**
 * Notes Git Types — compile-time type assertions.
 *
 * These tests verify that the exported interfaces accept the expected shapes.
 * They contain no runtime assertions — a passing build means the types are correct.
 */

import { describe, it, expectTypeOf } from 'vitest';
import type {
    NotesGitConfig,
    NotesGitAutoCommitConfig,
    NotesGitStatus,
    NotesGitLogEntry,
    NotesGitDiffFile,
    NotesGitDiff,
} from '../../src/server/notes/git/notes-git-types';

describe('NotesGitConfig', () => {
    it('accepts full config with all fields', () => {
        const config = {
            enabled: true,
            autoCommit: { enabled: true, scheduleId: 'sched-123' },
        } satisfies NotesGitConfig;
        expectTypeOf(config).toMatchTypeOf<NotesGitConfig>();
    });

    it('accepts minimal config with only enabled', () => {
        const config = { enabled: false } satisfies NotesGitConfig;
        expectTypeOf(config).toMatchTypeOf<NotesGitConfig>();
    });

    it('accepts autoCommit without scheduleId', () => {
        const config = {
            enabled: true,
            autoCommit: { enabled: false },
        } satisfies NotesGitConfig;
        expectTypeOf(config).toMatchTypeOf<NotesGitConfig>();
    });
});

describe('NotesGitAutoCommitConfig', () => {
    it('accepts full auto-commit config', () => {
        const ac = { enabled: true, scheduleId: 'abc' } satisfies NotesGitAutoCommitConfig;
        expectTypeOf(ac).toMatchTypeOf<NotesGitAutoCommitConfig>();
    });
});

describe('NotesGitStatus', () => {
    it('accepts a complete status object', () => {
        const status = {
            initialized: true,
            branch: 'main',
            clean: false,
            staged: ['file1.md'],
            unstaged: ['file2.md'],
            untracked: ['file3.md'],
            totalChanges: 3,
        } satisfies NotesGitStatus;
        expectTypeOf(status).toMatchTypeOf<NotesGitStatus>();
    });
});

describe('NotesGitLogEntry', () => {
    it('accepts a complete log entry', () => {
        const entry = {
            hash: 'abc123def456',
            shortHash: 'abc123d',
            message: 'Initial commit',
            date: '2024-01-15T10:30:00Z',
            filesChanged: 5,
        } satisfies NotesGitLogEntry;
        expectTypeOf(entry).toMatchTypeOf<NotesGitLogEntry>();
    });
});

describe('NotesGitDiffFile', () => {
    it('accepts a diff file entry', () => {
        const file = {
            path: 'notes/todo.md',
            status: 'M',
            diff: '--- a/notes/todo.md\n+++ b/notes/todo.md',
        } satisfies NotesGitDiffFile;
        expectTypeOf(file).toMatchTypeOf<NotesGitDiffFile>();
    });
});

describe('NotesGitDiff', () => {
    it('accepts a diff with files array', () => {
        const diff = {
            files: [
                { path: 'a.md', status: 'A', diff: '+new file' },
                { path: 'b.md', status: 'D', diff: '-deleted' },
            ],
        } satisfies NotesGitDiff;
        expectTypeOf(diff).toMatchTypeOf<NotesGitDiff>();
    });

    it('accepts an empty diff', () => {
        const diff = { files: [] } satisfies NotesGitDiff;
        expectTypeOf(diff).toMatchTypeOf<NotesGitDiff>();
    });
});
