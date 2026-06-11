import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The Features-card copy now lives in the FEATURE_FLAGS registry (coc-client),
// which the Admin UI renders generically.
const REGISTRY_PATH = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'coc-client',
    'src',
    'contracts',
    'feature-flags.ts',
);

describe('AdminPanel — remote work item provider integration copy', () => {
    it('describes workItems.sync.enabled as remote provider integration, not manual GitHub sync', () => {
        const src = fs.readFileSync(REGISTRY_PATH, 'utf-8');

        expect(src).toContain('Remote Work Items');
        expect(src).toContain('remote provider integration');
        expect(src).toContain('save-to-provider updates');
        expect(src).toContain('background polling');
        expect(src).not.toContain('Work Items GitHub Sync');
        expect(src).not.toContain('Manual GitHub Issues import/export/sync controls');
    });
});
