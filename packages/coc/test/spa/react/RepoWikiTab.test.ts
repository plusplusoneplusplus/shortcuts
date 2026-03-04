import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('RepoWikiTab', () => {
    const componentPath = path.resolve(__dirname, '../../../src/server/spa/client/react/repos/RepoWikiTab.tsx');
    let content: string;

    beforeAll(() => {
        content = fs.readFileSync(componentPath, 'utf-8');
    });

    describe('file structure', () => {
        it('should exist at the expected path', () => {
            expect(fs.existsSync(componentPath)).toBe(true);
        });

        it('should export a RepoWikiTab component', () => {
            expect(content).toMatch(/export\s+(function|const)\s+RepoWikiTab/);
        });
    });

    describe('props interface', () => {
        it('should accept workspaceId prop', () => {
            expect(content).toContain('workspaceId');
        });

        it('should accept workspacePath prop', () => {
            expect(content).toContain('workspacePath');
        });

        it('should accept initialWikiId prop', () => {
            expect(content).toContain('initialWikiId');
        });

        it('should accept initialTab prop', () => {
            expect(content).toContain('initialTab');
        });

        it('should accept initialAdminTab prop', () => {
            expect(content).toContain('initialAdminTab');
        });

        it('should accept initialComponentId prop', () => {
            expect(content).toContain('initialComponentId');
        });
    });

    describe('empty state rendering', () => {
        it('should display a "No Wiki Found" heading', () => {
            expect(content).toContain('No Wiki Found');
        });

        it('should include a Generate Wiki button', () => {
            expect(content).toMatch(/Generate Wiki/);
        });

        it('should filter state.wikis by workspacePath', () => {
            expect(content).toMatch(/repoPath\s*===\s*workspacePath/);
        });
    });

    describe('disabled state when no workspacePath', () => {
        it('should disable the button when workspacePath is missing', () => {
            expect(content).toMatch(/disabled=\{!workspacePath\}/);
        });

        it('should include a tooltip explaining why generation is disabled', () => {
            expect(content).toContain('repository path is required');
        });
    });

    describe('generate wiki action', () => {
        it('should POST to /api/wikis endpoint', () => {
            expect(content).toContain('/api/wikis');
        });

        it('should send repoPath in the request body', () => {
            expect(content).toContain('repoPath');
        });

        it('should include id in the POST body derived from slugified repo name', () => {
            expect(content).toMatch(/JSON\.stringify\(\s*\{[^}]*\bid\b[^}]*\}/);
        });

        it('should include name in the POST body', () => {
            expect(content).toMatch(/JSON\.stringify\(\s*\{[^}]*\bname\b[^}]*\}/);
        });

        it('should slugify the repo name for id generation', () => {
            expect(content).toContain('slugify');
        });

        it('should show a toast on POST failure', () => {
            expect(content).toContain('addToast');
        });

        it('should handle non-ok response with error toast', () => {
            expect(content).toMatch(/res\.ok[\s\S]*?else/);
        });

        it('should dispatch SET_WIKI_AUTO_GENERATE before navigating', () => {
            expect(content).toContain("SET_WIKI_AUTO_GENERATE");
            // Ensure auto-generate is dispatched before the hash change
            const autoGenIdx = content.indexOf('SET_WIKI_AUTO_GENERATE');
            const hashIdx = content.indexOf("location.hash = '#wiki/'");
            expect(autoGenIdx).toBeLessThan(hashIdx);
        });
    });

    describe('retry generation action', () => {
        it('should dispatch SET_WIKI_AUTO_GENERATE on retry', () => {
            const retryMatch = content.match(/handleRetryGeneration[\s\S]*?\}, \[/);
            expect(retryMatch).toBeTruthy();
            expect(retryMatch![0]).toContain('SET_WIKI_AUTO_GENERATE');
        });

        it('should navigate to wiki admin page on retry', () => {
            const retryMatch = content.match(/handleRetryGeneration[\s\S]*?\}, \[/);
            expect(retryMatch).toBeTruthy();
            expect(retryMatch![0]).toContain("location.hash = '#wiki/'");
        });

        it('should not call the old /api/dw/generate endpoint', () => {
            expect(content).not.toContain('/api/dw/generate');
        });
    });

    describe('single wiki inline view (state 2)', () => {
        it('should import WikiDetail', () => {
            expect(content).toMatch(/import.*WikiDetail.*from/);
        });

        it('should render WikiDetail with embedded prop for single wiki', () => {
            expect(content).toMatch(/WikiDetail\s+wikiId=\{repoWikis\[0\]\.id\}\s+embedded/);
        });

        it('should check repoWikis.length === 1 for single wiki state', () => {
            expect(content).toMatch(/repoWikis\.length\s*===\s*1/);
        });

        it('should pass onHashChange to WikiDetail in single wiki state', () => {
            expect(content).toContain('onHashChange={handleWikiHashChange}');
        });
    });

    describe('multi-wiki selector (state 3)', () => {
        it('should render a wiki selector with data-testid', () => {
            expect(content).toContain('data-testid="repo-wiki-selector"');
        });

        it('should check repoWikis.length > 1 for multi-wiki state', () => {
            expect(content).toMatch(/repoWikis\.length\s*>\s*1/);
        });

        it('should sort wikis by generatedAt descending', () => {
            expect(content).toContain('generatedAt');
            expect(content).toContain('localeCompare');
        });

        it('should show wiki count badge', () => {
            expect(content).toContain('wikis');
        });

        it('should handle wiki selection with handleWikiSelect', () => {
            expect(content).toContain('handleWikiSelect');
        });

        it('should update location.hash on wiki selection', () => {
            expect(content).toMatch(/location\.hash.*repos.*wiki/);
        });

        it('should dispatch CLEAR_REPO_WIKI_INITIAL after consuming deep-link', () => {
            expect(content).toContain("'CLEAR_REPO_WIKI_INITIAL'");
        });
    });

    describe('deep-link support', () => {
        it('should have handleWikiHashChange callback', () => {
            expect(content).toContain('handleWikiHashChange');
        });

        it('should pass initial deep-link props conditionally to WikiDetail in multi-wiki state', () => {
            expect(content).toContain('activeWikiId === initialWikiId ? initialTab : null');
        });
    });

    describe('integration with RepoDetail', () => {
        const detailPath = path.resolve(__dirname, '../../../src/server/spa/client/react/repos/RepoDetail.tsx');
        let detailContent: string;

        beforeAll(() => {
            detailContent = fs.readFileSync(detailPath, 'utf-8');
        });

        it('should be imported in RepoDetail', () => {
            expect(detailContent).toMatch(/import.*RepoWikiTab.*from/);
        });

        it('should be rendered when activeSubTab is wiki', () => {
            expect(detailContent).toMatch(/activeSubTab\s*===\s*['"]wiki['"]/);
            expect(detailContent).toContain('RepoWikiTab');
        });

        it('should receive workspaceId and workspacePath props', () => {
            expect(detailContent).toMatch(/RepoWikiTab\s+workspaceId=\{ws\.id\}\s+workspacePath=\{ws\.rootPath\}/);
        });

        it('should pass initialWikiId from state', () => {
            expect(detailContent).toContain('initialWikiId={state.selectedRepoWikiId}');
        });

        it('should pass initialTab from state', () => {
            expect(detailContent).toContain('initialTab={state.repoWikiInitialTab}');
        });

        it('should pass initialAdminTab from state', () => {
            expect(detailContent).toContain('initialAdminTab={state.repoWikiInitialAdminTab}');
        });

        it('should pass initialComponentId from state', () => {
            expect(detailContent).toContain('initialComponentId={state.repoWikiInitialComponentId}');
        });
    });
});
