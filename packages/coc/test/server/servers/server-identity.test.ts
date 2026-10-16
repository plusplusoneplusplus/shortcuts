import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getOrCreateServerIdentity } from '../../../src/server/servers/server-identity';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-server-identity-'));
    directories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('server identity', () => {
    it('persists a UUID across reads, processes and workspace changes', async () => {
        const dataDir = temporaryDirectory();
        const identity = getOrCreateServerIdentity(dataDir);
        expect(identity).toMatch(/^[0-9a-f-]{36}$/);
        expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'server-identity.json'), 'utf8')))
            .toEqual({ serverIdentity: identity });
        fs.mkdirSync(path.join(dataDir, 'repos', 'workspace-a'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'repos', 'workspace-b'), { recursive: true });
        expect(getOrCreateServerIdentity(dataDir)).toBe(identity);
        expect(await readFromProcess(dataDir)).toBe(identity);
        expect(fs.readdirSync(dataDir).sort()).toEqual(['repos', 'server-identity.json']);
    });

    it('assigns separate identities to separate servers even with equal workspace IDs', () => {
        const first = temporaryDirectory();
        const second = temporaryDirectory();
        for (const directory of [first, second]) {
            fs.mkdirSync(path.join(directory, 'repos', 'same-workspace'), { recursive: true });
        }
        expect(getOrCreateServerIdentity(first)).not.toBe(getOrCreateServerIdentity(second));
    });

    it('creates missing data directories', () => {
        const directory = path.join(temporaryDirectory(), 'nested', 'data');
        const identity = getOrCreateServerIdentity(directory);
        expect(getOrCreateServerIdentity(directory)).toBe(identity);
    });

    it('concurrent server processes converge without publishing partial bytes or replacing identity', async () => {
        const directory = path.join(temporaryDirectory(), 'shared');
        const identities = await Promise.all(Array.from({ length: 8 }, () => readFromProcess(directory)));
        expect(new Set(identities).size).toBe(1);
        expect(getOrCreateServerIdentity(directory)).toBe(identities[0]);
        expect(fs.readdirSync(directory)).toEqual(['server-identity.json']);
    });

    it.each(['', '{', 'null', '{}', '{"serverIdentity":42}', '{"serverIdentity":"http://localhost:4000"}',
        '{"serverIdentity":"registry-alias"}'])('rejects corrupt identity without replacing it: %j', (contents) => {
        const directory = temporaryDirectory();
        const identityPath = path.join(directory, 'server-identity.json');
        fs.writeFileSync(identityPath, contents);
        expect(() => getOrCreateServerIdentity(directory)).toThrow();
        expect(fs.readFileSync(identityPath, 'utf8')).toBe(contents);
        expect(fs.readdirSync(directory)).toEqual(['server-identity.json']);
    });

    it('propagates filesystem errors without assigning a new identity', () => {
        const directory = temporaryDirectory();
        fs.mkdirSync(path.join(directory, 'server-identity.json'));
        expect(() => getOrCreateServerIdentity(directory)).toThrow();
        expect(fs.readdirSync(directory)).toEqual(['server-identity.json']);
    });
});

async function readFromProcess(directory: string): Promise<string> {
    const modulePath = path.resolve(__dirname, '../../../src/server/servers/server-identity.ts');
    const { stdout } = await execFileAsync(process.execPath, ['-e',
        'const { getOrCreateServerIdentity } = require(process.argv[1]); process.stdout.write(getOrCreateServerIdentity(process.argv[2]));',
        modulePath, directory]);
    return stdout;
}
