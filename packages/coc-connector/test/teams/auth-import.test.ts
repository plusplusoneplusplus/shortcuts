import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:child_process', () => ({
    get execFile() {
        throw new Error('Subprocess capabilities must not be initialized during import or construction');
    },
}));

import { TeamsOAuthCredential } from '../../src/teams/auth';

describe('Teams OAuth initialization boundary', () => {
    it('imports and constructs credentials without resolving Windows subprocess capabilities', () => {
        const credential = new TeamsOAuthCredential({
            dataDir: join(tmpdir(), 'teams-auth-import-fixture'),
            serverUrl: 'https://teams.example/tenants/11111111-1111-4111-8111-111111111111/mcp',
        });
        try {
            expect(credential.getStatus()).toBe('unauthenticated');
        } finally {
            credential.dispose();
        }
    });
});
