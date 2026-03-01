/**
 * Tests for RepoGitTab component source structure.
 *
 * Validates exports, props, API usage, state management, and rendering
 * of the git commit history tab.
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
    });

    describe('rendering', () => {
        it('renders CommitList component', () => {
            expect(source).toContain('<CommitList');
        });

        it('imports CommitList', () => {
            expect(source).toContain("import { CommitList }");
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
    });
});
