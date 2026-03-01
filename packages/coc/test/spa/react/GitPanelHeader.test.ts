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
            expect(source).toContain('max-w-[180px]');
        });

        it('renders a git branch SVG icon', () => {
            expect(source).toContain('<svg');
            expect(source).toContain('fillRule="evenodd"');
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

        it('has a spacer div between badge and refresh button', () => {
            expect(source).toContain('flex-1');
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

        it('GitPanelHeader appears before BranchChanges in left panel', () => {
            const headerIdx = gitTabSource.indexOf('<GitPanelHeader');
            const branchIdx = gitTabSource.indexOf('<BranchChanges');
            expect(headerIdx).toBeGreaterThan(-1);
            expect(branchIdx).toBeGreaterThan(-1);
            expect(headerIdx).toBeLessThan(branchIdx);
        });
    });
});
