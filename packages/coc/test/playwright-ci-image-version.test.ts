/**
 * Regression guard for the e2e CI container image.
 *
 * Playwright requires the JS library version and the Docker image
 * (mcr.microsoft.com/playwright:vX.Y.Z-noble) to match exactly — the
 * image ships the browser binaries for that exact version. When the
 * `@playwright/test` dependency was bumped (npm audit remediation) to
 * 1.61.1 without bumping the pinned image in ci.yml, every e2e test
 * failed at browser launch:
 *
 *   browserType.launch: Executable doesn't exist ...
 *   current: v1.58.2-noble / required: v1.61.1-noble
 *
 * This test fails fast (in the unit suite, not e2e) if the two ever
 * drift apart again.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../../..');

function lockedPlaywrightVersion(): string {
    const lock = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf-8'),
    );
    const version = lock?.packages?.['node_modules/@playwright/test']?.version;
    if (!version) {
        throw new Error('Could not resolve @playwright/test version from package-lock.json');
    }
    return version;
}

function ciImagePlaywrightVersion(): string {
    const ci = fs.readFileSync(
        path.join(repoRoot, '.github', 'workflows', 'ci.yml'),
        'utf-8',
    );
    const match = ci.match(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble/);
    if (!match) {
        throw new Error('Could not find the Playwright container image tag in .github/workflows/ci.yml');
    }
    return match[1];
}

describe('e2e CI Playwright container image', () => {
    it('image tag matches the installed @playwright/test version exactly', () => {
        expect(ciImagePlaywrightVersion()).toBe(lockedPlaywrightVersion());
    });
});
