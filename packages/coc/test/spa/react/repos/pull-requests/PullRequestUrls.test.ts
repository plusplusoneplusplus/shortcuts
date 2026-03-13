/**
 * Regression tests: PR components must NOT produce double `/api` prefixes.
 *
 * `getApiBase()` already returns `/api`, so fetch URLs should use
 * `${base}/repos/...` — not `${base}/api/repos/...`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PR_DIR = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'pull-requests'
);

describe('PullRequestsTab — URL construction', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(PR_DIR, 'PullRequestsTab.tsx'), 'utf-8');
    });

    it('does not contain the double-api pattern /api/repos', () => {
        // getApiBase() already returns /api — concatenating /api/repos produces /api/api/repos
        expect(source).not.toMatch(/getApiBase\(\).*\/api\/repos/);
    });

    it('builds the pull-requests list URL using /repos without an extra /api segment', () => {
        expect(source).toMatch(/getApiBase\(\).*\/repos\//);
    });
});

describe('PullRequestDetail — URL construction', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(PR_DIR, 'PullRequestDetail.tsx'), 'utf-8');
    });

    it('does not contain the double-api pattern /api/repos in prUrl', () => {
        expect(source).not.toMatch(/`\$\{base\}\/api\/repos/);
    });

    it('builds prUrl using /repos without an extra /api segment', () => {
        expect(source).toMatch(/`\$\{base\}\/repos\//);
    });

    it('builds threadsUrl using /repos without an extra /api segment', () => {
        expect(source).toMatch(/`\$\{base\}\/repos\/.*\/threads`/);
    });
});
