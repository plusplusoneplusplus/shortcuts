import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CopilotHttpClient } from '../../src/copilot-http/client';

const directories: string[] = [];
afterEach(async () => {
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('direct HTTP with built Rust credential acquisition', () => {
    it('uses native config reads for readiness/inference and rejects account token changes before HTTP', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'direct-native-fixture-'));
        directories.push(directory);
        const configPath = join(directory, 'config.json');
        const write = async (token: string) => writeFile(configPath, '// fixture\n' + JSON.stringify({
            lastLoggedInUser: { host: 'https://GitHub.COM', login: 'fixture' },
            copilotTokens: { 'https://GitHub.COM:fixture': token, 'github.com:fixture': 'gho_wrong' },
        }));
        await write('gho_fixture');
        const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer gho_fixture');
            return new Response(JSON.stringify(String(url).endsWith('/models')
                ? { data: [{ id: 'gpt-6-luna', supported_endpoints: ['/responses'] }] }
                : { model: 'gpt-6-luna', status: 'completed', output: [{ type: 'message', role: 'assistant',
                    status: 'completed', content: [{ type: 'output_text', text: 'Fixture Title' }] }] }));
        });
        const client = new CopilotHttpClient({
            credential: { source: 'cli-config', account: 'active-cli-account', configPath }, fetch: fetcher,
        });
        try {
            expect(await client.isAvailable('gpt-6-luna')).toEqual({ available: true });
            expect((await client.complete({ model: 'gpt-6-luna', api: 'responses',
                messages: [{ role: 'user', content: 'Generate a fixture title' }] })).text).toBe('Fixture Title');
            expect(fetcher).toHaveBeenCalledTimes(2);
            await write('ghp_unsupported');
            expect(await client.isAvailable('gpt-6-luna')).toMatchObject({
                available: false, errorCode: 'DIRECT_CREDENTIAL_UNAVAILABLE',
            });
            await expect(client.complete({ model: 'gpt-6-luna', api: 'responses',
                messages: [{ role: 'user', content: 'Generate another fixture title' }] }))
                .rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE', inferenceDispatched: false });
            expect(fetcher).toHaveBeenCalledTimes(2);
        } finally { client.dispose(); }
    });
});
