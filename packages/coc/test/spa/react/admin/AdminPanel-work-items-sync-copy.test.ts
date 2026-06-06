import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ADMIN_PANEL_PATH = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'src',
    'server',
    'spa',
    'client',
    'react',
    'admin',
    'AdminPanel.tsx',
);

describe('AdminPanel — remote work item provider integration copy', () => {
    it('describes workItems.sync.enabled as remote provider integration, not manual GitHub sync', () => {
        const src = fs.readFileSync(ADMIN_PANEL_PATH, 'utf-8');

        expect(src).toContain('Remote Work Items');
        expect(src).toContain('remote provider integration');
        expect(src).toContain('save-to-provider updates');
        expect(src).toContain('background polling');
        expect(src).not.toContain('Work Items GitHub Sync');
        expect(src).not.toContain('Manual GitHub Issues import/export/sync controls');
    });
});
