/**
 * Tests for client entry point — pop-out route detection.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ENTRY_PATH = path.join(
    __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'index.tsx'
);

describe('client entry point: pop-out routes', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(ENTRY_PATH, 'utf-8');
    });

    it('imports PopOutGitReviewShell', () => {
        expect(source).toContain("import { PopOutGitReviewShell }");
    });

    it('detects #popout/git-review hash', () => {
        expect(source).toContain("#popout/git-review");
    });

    it('renders PopOutGitReviewShell for git review routes', () => {
        expect(source).toContain('<PopOutGitReviewShell />');
    });

    it('checks git-review route before fallback to App', () => {
        const gitReviewIdx = source.indexOf('#popout/git-review');
        const appIdx = source.indexOf('root.render(<App />)');
        expect(gitReviewIdx).toBeLessThan(appIdx);
    });

    it('checks all three pop-out routes', () => {
        expect(source).toContain('#popout/activity/');
        expect(source).toContain('#popout/markdown');
        expect(source).toContain('#popout/git-review');
    });
});
