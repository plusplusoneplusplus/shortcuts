/**
 * Tests for GitPanelHeader component source structure.
 *
 * Validates exports, props, branch pill, ahead/behind badge, refresh button,
 * spin animation, and data-testid attributes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'GitPanelHeader.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

const REPO_GIT_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoGitTab.tsx'
);

describe('GitPanelHeader', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { GitPanelHeader }");
            expect(indexSource).toContain("from './GitPanelHeader'");
        });

        it('exports GitPanelHeader as a named export', () => {
            expect(source).toContain('export function GitPanelHeader');
        });
    });

    describe('component signature', () => {
        it('defines GitPanelHeaderProps interface', () => {
            expect(source).toContain('interface GitPanelHeaderProps');
        });

        it('accepts branch prop', () => {
            expect(source).toContain('branch: string');
        });

        it('accepts ahead prop', () => {
            expect(source).toContain('ahead: number');
        });

        it('accepts behind prop', () => {
            expect(source).toContain('behind: number');
        });

        it('accepts refreshing prop', () => {
            expect(source).toContain('refreshing: boolean');
        });

        it('accepts onRefresh prop', () => {
            expect(source).toContain('onRefresh: () => void');
        });

        it('accepts optional onFetch prop', () => {
            expect(source).toContain('onFetch?: () => void');
        });

        it('accepts optional onPull prop', () => {
            expect(source).toContain('onPull?: () => void');
        });

        it('accepts optional onPush prop', () => {
            expect(source).toContain('onPush?: () => void');
        });

        it('accepts optional fetching prop', () => {
            expect(source).toContain('fetching?: boolean');
        });

        it('accepts optional pulling prop', () => {
            expect(source).toContain('pulling?: boolean');
        });

        it('accepts optional pushing prop', () => {
            expect(source).toContain('pushing?: boolean');
        });
    });

    describe('branch pill', () => {
        it('renders branch name', () => {
            expect(source).toContain('{branch}');
        });

        it('has branch pill data-testid', () => {
            expect(source).toContain('data-testid="git-branch-pill"');
        });

        it('uses rounded-full for pill styling', () => {
            expect(source).toContain('rounded-full');
        });

        it('uses font-mono for branch name', () => {
            expect(source).toContain('font-mono');
        });

        it('shows branch name as title attribute for truncation', () => {
            expect(source).toContain('title={branch}');
        });

        it('has max-width for truncation', () => {
            expect(source).toContain('max-w-[360px]');
        });

        it('renders a git branch SVG icon', () => {
            expect(source).toContain('<svg');
            expect(source).toContain('fillRule="evenodd"');
        });

        it('branch pill is a button element', () => {
            expect(source).toContain('<button');
            expect(source).toContain('data-testid="git-branch-pill"');
            expect(source).not.toContain('<span\n');
        });

        it('accepts optional onBranchClick prop', () => {
            expect(source).toContain('onBranchClick?: () => void');
        });

        it('branch pill calls onBranchClick on click', () => {
            expect(source).toContain('onClick={onBranchClick}');
        });

        it('branch pill has cursor-pointer style when clickable', () => {
            expect(source).toContain('cursor-pointer');
        });
    });

    describe('ahead/behind badge', () => {
        it('conditionally shows badge when ahead or behind is non-zero', () => {
            expect(source).toContain('hasAheadBehind');
            expect(source).toContain('ahead > 0 || behind > 0');
        });

        it('has ahead/behind badge data-testid', () => {
            expect(source).toContain('data-testid="git-ahead-behind-badge"');
        });

        it('shows up-arrow with ahead count', () => {
            expect(source).toContain('↑{ahead}');
        });

        it('shows down-arrow with behind count', () => {
            expect(source).toContain('↓{behind}');
        });

        it('has separate data-testid for ahead count', () => {
            expect(source).toContain('data-testid="git-ahead-count"');
        });

        it('has separate data-testid for behind count', () => {
            expect(source).toContain('data-testid="git-behind-count"');
        });

        it('uses green color for ahead count', () => {
            expect(source).toContain('text-[#16825d]');
        });

        it('uses red color for behind count', () => {
            expect(source).toContain('text-[#d32f2f]');
        });

        it('only shows ahead count when ahead > 0', () => {
            expect(source).toContain('ahead > 0 &&');
        });

        it('only shows behind count when behind > 0', () => {
            expect(source).toContain('behind > 0 &&');
        });
    });

    describe('refresh button', () => {
        it('has refresh button data-testid', () => {
            expect(source).toContain('data-testid="git-refresh-btn"');
        });

        it('calls onRefresh on click', () => {
            expect(source).toContain('onClick={onRefresh}');
        });

        it('is disabled when refreshing', () => {
            expect(source).toContain('disabled={refreshing}');
        });

        it('has descriptive title', () => {
            expect(source).toContain('title="Refresh git data"');
        });

        it('has refresh icon data-testid', () => {
            expect(source).toContain('data-testid="git-refresh-icon"');
        });
    });

    describe('spin animation', () => {
        it('applies git-refresh-spin class when refreshing', () => {
            expect(source).toContain("refreshing ? 'git-refresh-spin' : ''");
        });

        it('defines spin keyframes', () => {
            expect(source).toContain('@keyframes gitRefreshSpin');
        });

        it('includes rotate(360deg) in keyframes', () => {
            expect(source).toContain('rotate(360deg)');
        });

        it('uses linear infinite animation', () => {
            expect(source).toContain('linear infinite');
        });

        it('injects style tag for keyframes', () => {
            expect(source).toContain('<style>{spinKeyframes}</style>');
        });
    });

    describe('layout and styling', () => {
        it('has outer data-testid', () => {
            expect(source).toContain('data-testid="git-panel-header"');
        });

        it('uses sticky positioning', () => {
            expect(source).toContain('sticky top-0');
        });

        it('uses high z-index for stacking above scroll content', () => {
            expect(source).toContain('z-20');
        });

        it('uses flex layout', () => {
            expect(source).toContain('flex items-center');
        });

        it('has a spacer div between badge and action buttons', () => {
            expect(source).toContain('flex-1');
        });
    });

    describe('git action buttons', () => {
        it('renders fetch button conditionally when onFetch is provided', () => {
            expect(source).toContain('{onFetch && (');
        });

        it('has fetch button data-testid', () => {
            expect(source).toContain('data-testid="git-fetch-btn"');
        });

        it('fetch button calls onFetch on click', () => {
            expect(source).toContain('onClick={onFetch}');
        });

        it('fetch button is disabled when fetching', () => {
            expect(source).toContain('disabled={fetching}');
        });

        it('fetch button has descriptive title', () => {
            expect(source).toContain('title="Fetch from remote"');
        });

        it('fetch button shows "Fetch" label', () => {
            expect(source).toMatch(/data-testid="git-fetch-btn"[\s\S]*?Fetch/);
        });

        it('fetch button shows spinner when fetching', () => {
            expect(source).toContain("fetching ? 'git-refresh-spin' : ''");
        });

        it('renders pull button conditionally when onPull is provided', () => {
            expect(source).toContain('{onPull && (');
        });

        it('has pull button data-testid', () => {
            expect(source).toContain('data-testid="git-pull-btn"');
        });

        it('pull button calls onPull on click', () => {
            expect(source).toContain('onClick={onPull}');
        });

        it('pull button is disabled when pulling', () => {
            expect(source).toContain('disabled={pulling}');
        });

        it('pull button has --rebase title', () => {
            expect(source).toContain('title="Pull --rebase from remote"');
        });

        it('pull button shows "Pull" label', () => {
            expect(source).toMatch(/data-testid="git-pull-btn"[\s\S]*?Pull/);
        });

        it('pull button shows spinner when pulling', () => {
            expect(source).toContain("pulling ? 'git-refresh-spin' : ''");
        });

        it('renders push button conditionally when onPush is provided', () => {
            expect(source).toContain('{onPush && (');
        });

        it('has push button data-testid', () => {
            expect(source).toContain('data-testid="git-push-btn"');
        });

        it('push button calls onPush on click', () => {
            expect(source).toContain('onClick={onPush}');
        });

        it('push button is disabled when pushing', () => {
            expect(source).toContain('disabled={pushing}');
        });

        it('push button has descriptive title', () => {
            expect(source).toContain('title="Push to remote"');
        });

        it('push button shows "Push" label', () => {
            expect(source).toMatch(/data-testid="git-push-btn"[\s\S]*?Push/);
        });

        it('push button shows spinner when pushing', () => {
            expect(source).toContain("pushing ? 'git-refresh-spin' : ''");
        });

        it('all action buttons use git-action-btn class', () => {
            const matches = source.match(/git-action-btn/g);
            expect(matches).toBeTruthy();
            expect(matches!.length).toBe(3);
        });

        it('action buttons appear between spacer and refresh button', () => {
            const spacerIdx = source.indexOf('flex-1');
            const fetchBtnIdx = source.indexOf('git-fetch-btn');
            const pullBtnIdx = source.indexOf('git-pull-btn');
            const pushBtnIdx = source.indexOf('git-push-btn');
            const refreshBtnIdx = source.indexOf('git-refresh-btn');
            expect(fetchBtnIdx).toBeGreaterThan(spacerIdx);
            expect(pullBtnIdx).toBeGreaterThan(fetchBtnIdx);
            expect(pushBtnIdx).toBeGreaterThan(pullBtnIdx);
            expect(refreshBtnIdx).toBeGreaterThan(pushBtnIdx);
        });
    });

    describe('integration with RepoGitTab', () => {
        let gitTabSource: string;

        beforeAll(() => {
            gitTabSource = fs.readFileSync(REPO_GIT_TAB_PATH, 'utf-8');
        });

        it('RepoGitTab imports GitPanelHeader', () => {
            expect(gitTabSource).toContain("import { GitPanelHeader } from './GitPanelHeader'");
        });

        it('RepoGitTab renders GitPanelHeader', () => {
            expect(gitTabSource).toContain('<GitPanelHeader');
        });

        it('RepoGitTab passes branch prop', () => {
            expect(gitTabSource).toMatch(/branch=\{branchName/);
        });

        it('RepoGitTab passes ahead prop', () => {
            expect(gitTabSource).toContain('ahead={ahead}');
        });

        it('RepoGitTab passes behind prop', () => {
            expect(gitTabSource).toContain('behind={behind}');
        });

        it('RepoGitTab passes refreshing prop', () => {
            expect(gitTabSource).toContain('refreshing={refreshing}');
        });

        it('RepoGitTab passes onRefresh prop', () => {
            expect(gitTabSource).toContain('onRefresh={refreshAll}');
        });

        it('RepoGitTab passes onFetch prop', () => {
            expect(gitTabSource).toContain('onFetch={handleFetch}');
        });

        it('RepoGitTab passes onPull prop', () => {
            expect(gitTabSource).toContain('onPull={handlePull}');
        });

        it('RepoGitTab passes onPush prop', () => {
            expect(gitTabSource).toContain('onPush={handlePush}');
        });

        it('RepoGitTab passes fetching prop', () => {
            expect(gitTabSource).toContain('fetching={fetching}');
        });

        it('RepoGitTab passes pulling prop', () => {
            expect(gitTabSource).toContain('pulling={pulling}');
        });

        it('RepoGitTab passes pushing prop', () => {
            expect(gitTabSource).toContain('pushing={pushing}');
        });

        it('GitPanelHeader appears before BranchChanges in left panel', () => {
            const headerIdx = gitTabSource.indexOf('<GitPanelHeader');
            const branchIdx = gitTabSource.indexOf('<BranchChanges');
            expect(headerIdx).toBeGreaterThan(-1);
            expect(branchIdx).toBeGreaterThan(-1);
            expect(headerIdx).toBeLessThan(branchIdx);
        });
    });
});
