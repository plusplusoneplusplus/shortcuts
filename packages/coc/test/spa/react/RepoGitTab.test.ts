/**
 * Tests for RepoGitTab component source structure.
 *
 * Validates exports, props, API usage, split layout, state management,
 * auto-selection, and rendering of the git commit history tab.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoGitTab.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('RepoGitTab', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { RepoGitTab }");
            expect(indexSource).toContain("from './RepoGitTab'");
        });

        it('exports RepoGitTab as a named export', () => {
            expect(source).toContain('export function RepoGitTab');
        });
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });
    });

    describe('API integration', () => {
        it('fetches from /workspaces/:id/git/commits endpoint', () => {
            expect(source).toContain('/git/commits');
        });

        it('passes limit=50 query parameter', () => {
            expect(source).toContain('limit=50');
        });

        it('imports fetchApi from hooks', () => {
            expect(source).toContain("import { fetchApi } from '../hooks/useApi'");
        });
    });

    describe('state management', () => {
        it('tracks commits state', () => {
            expect(source).toContain('setCommits');
        });

        it('tracks unpushedCount state', () => {
            expect(source).toContain('setUnpushedCount');
        });

        it('tracks loading state', () => {
            expect(source).toContain('setLoading');
        });

        it('tracks error state', () => {
            expect(source).toContain('setError');
        });

        it('tracks selectedCommit state', () => {
            expect(source).toContain('selectedCommit');
            expect(source).toContain('setSelectedCommit');
        });
    });

    describe('auto-selection', () => {
        it('auto-selects the most recent commit on load', () => {
            expect(source).toContain('loaded[0]');
            expect(source).toContain('setSelectedCommit');
        });

        it('clears selection when no commits', () => {
            expect(source).toContain('setSelectedCommit(null)');
        });
    });

    describe('split layout', () => {
        it('has left panel for commit list', () => {
            expect(source).toContain('data-testid="git-commit-list-panel"');
        });

        it('has right panel for commit detail', () => {
            expect(source).toContain('data-testid="git-detail-panel"');
        });

        it('uses aside element for commit list panel', () => {
            expect(source).toContain('<aside');
        });

        it('uses main element for detail panel', () => {
            expect(source).toContain('<main');
        });

        it('has responsive breakpoint for stacked/split layout', () => {
            expect(source).toContain('md-split:');
        });

        it('sets fixed width on left panel at breakpoint', () => {
            expect(source).toContain('md-split:w-[320px]');
        });

        it('has empty state when no commit is selected', () => {
            expect(source).toContain('data-testid="git-detail-empty"');
            expect(source).toContain('Select a commit to view details');
        });
    });

    describe('rendering', () => {
        it('renders CommitList component', () => {
            expect(source).toContain('<CommitList');
        });

        it('renders CommitDetail component', () => {
            expect(source).toContain('<CommitDetail');
        });

        it('imports CommitList', () => {
            expect(source).toContain("import { CommitList }");
        });

        it('imports CommitDetail', () => {
            expect(source).toContain("import { CommitDetail }");
        });

        it('has loading state with Spinner', () => {
            expect(source).toContain('<Spinner');
            expect(source).toContain('data-testid="git-tab-loading"');
        });

        it('has error state rendering', () => {
            expect(source).toContain('data-testid="git-tab-error"');
        });

        it('has root data-testid', () => {
            expect(source).toContain('data-testid="repo-git-tab"');
        });

        it('renders unpushed section only when unpushedCount > 0', () => {
            expect(source).toContain('unpushedCount > 0');
        });

        it('renders "Unpushed" and "History" sections', () => {
            expect(source).toContain("title=\"Unpushed\"");
            expect(source).toContain("title=\"History\"");
        });

        it('splits commits into unpushed and history based on unpushedCount', () => {
            expect(source).toContain('commits.slice(0, unpushedCount)');
            expect(source).toContain('commits.slice(unpushedCount)');
        });

        it('passes selectedHash and onSelect to CommitList', () => {
            expect(source).toContain('selectedHash=');
            expect(source).toContain('onSelect=');
        });

        it('passes subject to CommitDetail', () => {
            expect(source).toContain('subject={selectedCommit.subject}');
        });

        it('uses key prop on CommitDetail to force remount on hash change', () => {
            expect(source).toContain('key={selectedCommit.hash}');
        });
    });
});
