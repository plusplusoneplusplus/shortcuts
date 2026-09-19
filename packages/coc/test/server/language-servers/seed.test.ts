/**
 * Seeding a never-configured workspace from the languages its files use.
 *
 * Fixtures are real temp directories: detection reads the filesystem, and the
 * point of these tests is that the on-disk config it produces is the one a
 * later read returns unchanged.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureLanguageServerConfigSeeded } from '../../../src/server/language-servers/seed';
import {
    getLanguageServerConfigPath,
    readLanguageServerConfigWithStatus,
    writeLanguageServerConfig,
} from '../../../src/server/language-servers/repository';

const WORKSPACE = 'ws-seed';

describe('ensureLanguageServerConfigSeeded', () => {
    let dataDir: string;
    let workspaceRoot: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-lsp-seed-data-'));
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-lsp-seed-root-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    function configPath(): string {
        return getLanguageServerConfigPath(dataDir, WORKSPACE);
    }

    function makeRustRepo(): void {
        fs.writeFileSync(path.join(workspaceRoot, 'Cargo.toml'), '[package]\nname = "demo"\n');
        fs.mkdirSync(path.join(workspaceRoot, 'src'));
        fs.writeFileSync(path.join(workspaceRoot, 'src', 'main.rs'), 'fn main() {}\n');
    }

    it('writes enabled support plus an override for each detected preset', () => {
        makeRustRepo();

        const result = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot);

        expect(result.status).toBe('ok');
        expect(result.value.enabled).toBe(true);
        expect(result.value.definitions.map(d => d.id)).toEqual(['rust']);
        expect(result.value.definitions[0].enabled).toBe(true);
        // The returned config is what is on disk, not an in-memory view of it.
        const stored = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
        expect(stored.enabled).toBe(true);
        expect(stored.definitions.map((d: { id: string }) => d.id)).toEqual(['rust']);
    });

    it('leaves undetected presets out of the file entirely', () => {
        makeRustRepo();

        const { value } = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot);

        expect(value.definitions.map(d => d.id)).not.toContain('python');
        expect(value.definitions.map(d => d.id)).not.toContain('typescript');
        expect(value.definitions.map(d => d.id)).not.toContain('clangd');
        // coc-symbols keeps its always-on preset default rather than an override.
        expect(value.definitions.map(d => d.id)).not.toContain('coc-symbols');
    });

    it('records every language a polyglot repo uses', () => {
        makeRustRepo();
        fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"name":"demo"}');
        fs.writeFileSync(path.join(workspaceRoot, 'pyproject.toml'), '[project]\nname = "demo"\n');

        const { value } = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot);

        expect(value.enabled).toBe(true);
        expect(new Set(value.definitions.map(d => d.id))).toEqual(new Set(['typescript', 'rust', 'python']));
    });

    it('writes the disabled default when nothing is detected, so the scan runs once', () => {
        const detect = vi.fn(() => []);

        const first = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot, { detect });
        const second = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot, { detect });

        expect(first.value).toEqual({ enabled: false, definitions: [] });
        expect(first.status).toBe('ok');
        expect(fs.existsSync(configPath())).toBe(true);
        expect(second.value).toEqual({ enabled: false, definitions: [] });
        expect(detect).toHaveBeenCalledTimes(1);
    });

    it('does not re-scan once a config exists', () => {
        makeRustRepo();
        const detect = vi.fn(() => ['rust']);

        ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot, { detect });
        const second = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot, { detect });

        expect(detect).toHaveBeenCalledTimes(1);
        expect(second.status).toBe('ok');
        expect(second.value.definitions.map(d => d.id)).toEqual(['rust']);
    });

    it('keeps a server the user turned off turned off', () => {
        makeRustRepo();
        const seeded = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot);
        const disabled = seeded.value.definitions.map(d => ({ ...d, enabled: false }));
        expect(writeLanguageServerConfig(dataDir, WORKSPACE, { enabled: true, definitions: disabled }).ok).toBe(true);

        const reread = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot);

        expect(reread.value.definitions.map(d => d.enabled)).toEqual([false]);
    });

    it('leaves an invalid config alone, warning instead of seeding', () => {
        makeRustRepo();
        fs.mkdirSync(path.dirname(configPath()), { recursive: true });
        fs.writeFileSync(configPath(), '{ not json');

        const result = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot);

        expect(result.status).toBe('invalid');
        expect(result.value).toEqual({ enabled: false, definitions: [] });
        expect(result.warnings).toHaveLength(1);
        // The user's file survives untouched so the bad edit can be fixed.
        expect(fs.readFileSync(configPath(), 'utf-8')).toBe('{ not json');
    });

    it('falls back to the plain read when detection throws', () => {
        const detect = vi.fn(() => { throw new Error('scan exploded'); });

        const result = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot, { detect });

        expect(result.status).toBe('missing');
        expect(fs.existsSync(configPath())).toBe(false);
    });

    it('skips seeding without a workspace root', () => {
        const detect = vi.fn(() => ['rust']);

        const result = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, '', { detect });

        expect(result.status).toBe('missing');
        expect(detect).not.toHaveBeenCalled();
        expect(fs.existsSync(configPath())).toBe(false);
    });

    it('seeds a config a later plain read returns verbatim', () => {
        makeRustRepo();

        const seeded = ensureLanguageServerConfigSeeded(dataDir, WORKSPACE, workspaceRoot);
        const plain = readLanguageServerConfigWithStatus(dataDir, WORKSPACE);

        expect(plain.status).toBe('ok');
        expect(plain.value).toEqual(seeded.value);
    });
});
