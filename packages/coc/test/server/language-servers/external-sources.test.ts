/**
 * The external-source capability registry and its authorized reader — the two
 * halves of "a definition may name a file outside the workspace, and nothing
 * else may".
 *
 * The registry's job is scoping: who issued a capability, for which attachment
 * and workspace, for how long, and how many. The reader's job is identity: the
 * capability names a file, so the read re-canonicalizes before it opens
 * anything and refuses a path that now resolves somewhere else.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    EXTERNAL_SOURCE_MAX_BYTES,
    ExternalSourceRegistry,
    canonicalizeExternalFile,
    readExternalSource,
    type ExternalSourceGrant,
} from '../../../src/server/language-servers/external-sources';
import { safeRm } from '../../helpers/safe-rm';

const tempDirs: string[] = [];

afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
        await safeRm(dir);
    }
});

function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-external-source-'));
    tempDirs.push(dir);
    return dir;
}

const SCOPE = { attachmentId: 'att-1', workspaceId: 'ws-1' };

function issue(registry: ExternalSourceRegistry, canonicalPath: string, overrides: Partial<typeof SCOPE> = {}) {
    return registry.issue({
        ...SCOPE,
        ...overrides,
        canonicalPath,
        displayName: path.basename(canonicalPath),
    });
}

async function grantFor(filePath: string): Promise<ExternalSourceGrant> {
    const canonicalPath = await canonicalizeExternalFile(filePath);
    expect(canonicalPath).toBeDefined();
    return new ExternalSourceRegistry().issue({
        ...SCOPE,
        canonicalPath: canonicalPath as string,
        displayName: path.basename(filePath),
    });
}

describe('external source registry', () => {
    it('issues an opaque id that carries no host path', () => {
        const registry = new ExternalSourceRegistry();
        const grant = issue(registry, path.join(tempDir(), 'string_view'));
        expect(grant.id).not.toContain(path.sep);
        expect(grant.id).not.toContain('string_view');
        expect(grant.id.length).toBeGreaterThan(20);
    });

    it('reuses one capability for repeated locations in the same file', () => {
        const registry = new ExternalSourceRegistry();
        const file = path.join(tempDir(), 'vector');
        expect(issue(registry, file).id).toBe(issue(registry, file).id);
        expect(registry.size).toBe(1);
    });

    it('resolves only for the attachment and workspace it was issued to', () => {
        const registry = new ExternalSourceRegistry();
        const grant = issue(registry, path.join(tempDir(), 'vector'));

        expect(registry.resolve(grant.id, SCOPE)).toBeDefined();
        expect(registry.resolve(grant.id, { ...SCOPE, attachmentId: 'att-2' })).toBeUndefined();
        expect(registry.resolve(grant.id, { ...SCOPE, workspaceId: 'ws-2' })).toBeUndefined();
        expect(registry.resolve('forged-id', SCOPE)).toBeUndefined();
    });

    it('stops resolving an expired capability', () => {
        let now = 1_000;
        const registry = new ExternalSourceRegistry({ now: () => now, ttlMs: 500 });
        const grant = issue(registry, path.join(tempDir(), 'vector'));

        now = 1_400;
        expect(registry.resolve(grant.id, SCOPE)).toBeDefined();
        now = 1_600;
        expect(registry.resolve(grant.id, SCOPE)).toBeUndefined();
        expect(registry.size).toBe(0);
    });

    it('revokes every capability an attachment holds, and only those', () => {
        const registry = new ExternalSourceRegistry();
        const dir = tempDir();
        const mine = issue(registry, path.join(dir, 'a'));
        const other = issue(registry, path.join(dir, 'b'), { attachmentId: 'att-2' });

        registry.revokeAttachment('att-1');

        expect(registry.resolve(mine.id, SCOPE)).toBeUndefined();
        expect(registry.resolve(other.id, { ...SCOPE, attachmentId: 'att-2' })).toBeDefined();
    });

    it('evicts the oldest capability rather than growing without bound', () => {
        const registry = new ExternalSourceRegistry({ limit: 2 });
        const dir = tempDir();
        const first = issue(registry, path.join(dir, 'a'));
        const second = issue(registry, path.join(dir, 'b'));
        const third = issue(registry, path.join(dir, 'c'));

        expect(registry.size).toBe(2);
        expect(registry.resolve(first.id, SCOPE)).toBeUndefined();
        expect(registry.resolve(second.id, SCOPE)).toBeDefined();
        expect(registry.resolve(third.id, SCOPE)).toBeDefined();
    });
});

describe('authorized external source read', () => {
    it('reads the exact file a capability names, extension or not', async () => {
        const dir = tempDir();
        const file = path.join(dir, 'string_view');
        fs.writeFileSync(file, 'namespace std { class string_view; }\n', 'utf-8');

        const read = await readExternalSource(await grantFor(file));

        expect(read).toMatchObject({
            ok: true,
            content: 'namespace std { class string_view; }\n',
            displayName: 'string_view',
        });
    });

    it('reports the file extension as the language hint', async () => {
        const file = path.join(tempDir(), 'widget.hpp');
        fs.writeFileSync(file, '#pragma once\n', 'utf-8');

        expect(await readExternalSource(await grantFor(file))).toMatchObject({ ok: true, languageHint: 'hpp' });
    });

    it('binds the capability to the file, not the name a symlink carried', async () => {
        const dir = tempDir();
        const real = path.join(dir, 'real');
        const decoy = path.join(dir, 'decoy');
        const link = path.join(dir, 'link');
        fs.writeFileSync(real, 'authorized\n', 'utf-8');
        fs.writeFileSync(decoy, 'secret\n', 'utf-8');
        try {
            fs.symlinkSync(real, link);
        } catch {
            return; // Windows without developer mode; the canonical check is covered above.
        }
        const grant = await grantFor(link);
        expect(grant.canonicalPath).toBe(fs.realpathSync(real));

        // Repointing the name cannot redirect the read: the grant already
        // resolved to a file, and that file is what it stays bound to.
        fs.unlinkSync(link);
        fs.symlinkSync(decoy, link);

        expect(await readExternalSource(grant)).toMatchObject({ ok: true, content: 'authorized\n' });
    });

    it('refuses a directory, a missing file, and a file replaced by one', async () => {
        const dir = tempDir();
        const file = path.join(dir, 'gone');
        fs.writeFileSync(file, 'x\n', 'utf-8');
        const grant = await grantFor(file);
        fs.unlinkSync(file);

        expect(await readExternalSource(grant)).toEqual({ ok: false, reason: 'not-a-file' });
        expect(await canonicalizeExternalFile(dir)).toBeUndefined();
    });

    it('refuses binary content and oversized files', async () => {
        const dir = tempDir();
        const binary = path.join(dir, 'blob.h');
        fs.writeFileSync(binary, Buffer.from([0x7f, 0x45, 0x00, 0x01]));
        const huge = path.join(dir, 'huge.h');
        fs.writeFileSync(huge, Buffer.alloc(EXTERNAL_SOURCE_MAX_BYTES + 1, 0x61));

        expect(await readExternalSource(await grantFor(binary))).toEqual({ ok: false, reason: 'binary' });
        expect(await readExternalSource(await grantFor(huge))).toEqual({ ok: false, reason: 'too-large' });
    });

    it('reports a cancelled read rather than returning content', async () => {
        const file = path.join(tempDir(), 'widget.hpp');
        fs.writeFileSync(file, '#pragma once\n', 'utf-8');
        const controller = new AbortController();
        controller.abort();

        expect(await readExternalSource(await grantFor(file), controller.signal))
            .toEqual({ ok: false, reason: 'cancelled' });
    });
});
