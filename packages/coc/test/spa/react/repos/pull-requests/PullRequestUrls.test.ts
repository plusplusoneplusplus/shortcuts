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
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'pull-requests'
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

    it('uses the typed cocClient for pull requests (no raw getApiBase() URL construction)', () => {
        // After migrating to cocClient, URLs are built inside the client library.
        // AC-07 routes the PR tab through the clone-aware useCocClient(workspaceId)
        // so a remote clone targets its server; either typed client entry point
        // satisfies "no raw URL building".
        expect(source).toMatch(/getSpaCocClient\(\)|useCocClient\(/);
        expect(source).not.toMatch(/getApiBase\(\).*\/repos\//);
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

    it('uses the typed cocClient for PR detail (no raw template-literal URL construction)', () => {
        // After migrating to cocClient, URLs are built inside the client library.
        expect(source).toMatch(/getSpaCocClient\(\)/);
        expect(source).not.toMatch(/`\$\{base\}\/repos\//);
    });

    it('does not construct a raw threadsUrl with template literals', () => {
        expect(source).not.toMatch(/`\$\{base\}\/repos\/.*\/threads`/);
    });
});
