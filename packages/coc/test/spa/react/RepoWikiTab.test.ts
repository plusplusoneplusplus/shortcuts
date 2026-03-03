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
    });
});
