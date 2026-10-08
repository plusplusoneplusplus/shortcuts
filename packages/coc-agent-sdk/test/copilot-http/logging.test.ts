import { afterEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { CopilotHttpClient } from '../../src/copilot-http';
import { initSDKLogger, resetSDKLogger } from '../../src/logger';

afterEach(resetSDKLogger);
describe('completion summary sanitization', () => {
    it('records categories, timings and safe request IDs without prompts, credentials, errors or cache fingerprints', async () => {
        let logs = '';
        const stream = new Writable({ write(chunk, _encoding, done) { logs += String(chunk); done(); } });
        initSDKLogger(pino({ level: 'debug' }, stream));
        const client = new CopilotHttpClient({ credential: { source: 'resolver', resolve: async () => ({ token: 'gho_secret_credential', host: 'github.com', login: 'test' }) },
            fetch: async url => String(url).endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: 'gpt-5.4-mini' }] }))
                : new Response(JSON.stringify({ error: { message: 'private prompt and response' } }), { status: 500, headers: { 'x-request-id': 'request-1' } }) });
        try {
            await expect(client.complete({ model: 'gpt-5.4-mini', api: 'responses', messages: [{ role: 'user', content: 'private prompt and response' }] })).rejects.toMatchObject({ code: 'DIRECT_UPSTREAM_FAILED' });
            const entries = logs.trim().split('\n').map(line => JSON.parse(line));
            expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({ outcome: 'DIRECT_UPSTREAM_FAILED', requestId: 'request-1', transport: 'direct' });
            expect(logs).not.toContain('gho_secret_credential'); expect(logs).not.toContain('private prompt'); expect(logs).not.toContain('authorization'); expect(logs).not.toContain('fingerprint');
        } finally { client.dispose(); }
    });
});
