/**
 * Tests for client entry point — pop-out route detection.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ENTRY_PATH = path.join(
    __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'entry.tsx'
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
        const appIdx = source.indexOf('<App />');
        expect(appIdx).toBeGreaterThan(-1);
        expect(gitReviewIdx).toBeLessThan(appIdx);
    });

    it('checks all three pop-out routes', () => {
        expect(source).toContain('#popout/activity/');
        expect(source).toContain('#popout/markdown');
        expect(source).toContain('#popout/git-review');
    });

    it('renders PopOutDevToolsShell for the dev-tools route before falling back to App', () => {
        expect(source).toContain("import { PopOutDevToolsShell }");
        expect(source).toContain('#popout/dev-tools');
        expect(source).toContain('<PopOutDevToolsShell />');
        const appIdx = source.indexOf('<App />');
        expect(appIdx).toBeGreaterThan(-1);
        expect(source.indexOf('#popout/dev-tools')).toBeLessThan(appIdx);
    });

    it('mounts the persistent browser layer only beside the main app, outside workspace routing', () => {
        expect(source).toContain('root.render(<><App /><BrowserWebviewLayer /></>)');
        expect(source.match(/<BrowserWebviewLayer\s*\/>/g)).toHaveLength(1);
        expect(source.indexOf('<BrowserWebviewLayer />')).toBeGreaterThan(source.indexOf('#popout/dev-tools'));
    });
});
