import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import { RUST_PRESET } from '../../../src/server/language-servers/presets';
import {
    RUST_ANALYZER_INSTALL_GUIDANCE,
    RUST_ANALYZER_RECOVERY_COMMAND,
    RUSTUP_RESOLUTION_TIMEOUT_MS,
    findExecutableOnPath,
    resolveRustRuntime,
    resolveRustServerRoot,
} from '../../../src/server/language-servers/rust-adapter';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

const rootPath = path.resolve(path.sep, 'repos', 'rust-app');
const rustupAnalyzer = path.resolve(
    path.sep,
    'home',
    'user',
    '.rustup',
    'toolchains',
    'stable-x86_64-unknown-linux-gnu',
    'bin',
    'rust-analyzer',
);
const pathAnalyzer = path.resolve(path.sep, 'tools', 'bin', process.platform === 'win32' ? 'rust-analyzer.exe' : 'rust-analyzer');

function preset(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return { ...RUST_PRESET, enabled: true, ...overrides };
}

describe('resolveRustRuntime', () => {
    it('prefers rustup and resolves it from the project root with a bounded timeout', () => {
        let invocation: { rootPath: string; timeoutMs: number } | undefined;
        const runtime = resolveRustRuntime(preset(), rootPath, {
            runRustupWhich: (cwd, timeoutMs) => {
                invocation = { rootPath: cwd, timeoutMs };
                return rustupAnalyzer;
            },
            resolveOnPath: () => pathAnalyzer,
        });

        expect(invocation).toEqual({ rootPath, timeoutMs: RUSTUP_RESOLUTION_TIMEOUT_MS });
        expect(runtime).toEqual({
            command: rustupAnalyzer,
            args: [],
            origin: 'rustup',
            label: 'Server: rustup (stable)',
            notes: [],
        });
        expect(runtime.label).not.toContain(rustupAnalyzer);
    });

    it('falls back to a rust-analyzer discovered on PATH', () => {
        const runtime = resolveRustRuntime(preset(), rootPath, {
            runRustupWhich: () => undefined,
            resolveOnPath: () => pathAnalyzer,
            isRustupProxy: () => false,
        });

        expect(runtime).toEqual({
            command: pathAnalyzer,
            args: [],
            origin: 'path',
            label: 'Server: system PATH',
            notes: [],
        });
    });

    it('classifies a rustup proxy on PATH as a missing component', () => {
        const runtime = resolveRustRuntime(preset(), rootPath, {
            runRustupWhich: () => undefined,
            resolveOnPath: () => pathAnalyzer,
            isRustupProxy: () => true,
        });

        expect(runtime).toEqual({
            command: pathAnalyzer,
            args: [],
            origin: 'rustup',
            label: 'Server: rustup proxy',
            notes: [RUST_ANALYZER_INSTALL_GUIDANCE],
            recoveryCommand: RUST_ANALYZER_RECOVERY_COMMAND,
        });
    });

    describe('resolveRustServerRoot', () => {
        it('selects the outermost Cargo workspace above the nearest crate manifest', () => {
            const member = path.join(rootPath, 'crates', 'member');
            const manifests = new Map([
                [path.join(rootPath, 'Cargo.toml'), '[workspace]\nmembers = ["crates/member"]'],
                [path.join(member, 'Cargo.toml'), '[package]\nname = "member"'],
            ]);

            expect(resolveRustServerRoot(
                preset(),
                rootPath,
                'crates/member/src/lib.rs',
                {
                    exists: candidate => manifests.has(candidate),
                    readFile: file => manifests.get(file),
                },
            )).toBe(rootPath);
        });

        it('falls back to the nearest Cargo manifest for a standalone crate', () => {
            const crate = path.join(rootPath, '独立-crate');
            const manifest = path.join(crate, 'Cargo.toml');

            expect(resolveRustServerRoot(
                preset(),
                rootPath,
                '独立-crate\\src\\lib.rs',
                {
                    exists: candidate => candidate === manifest,
                    readFile: () => '[package]\nname = "standalone"',
                },
            )).toBe(crate);
        });

        it.each([
            ['unreadable', () => { throw new Error('EACCES'); }],
            ['unparseable', () => '[workspace'],
        ])('degrades to the nearest marker when a manifest is %s', (_label, readFile) => {
            const crate = path.join(rootPath, 'crate');
            const manifest = path.join(crate, 'Cargo.toml');

            expect(resolveRustServerRoot(
                preset(),
                rootPath,
                'crate/src/lib.rs',
                {
                    exists: candidate => candidate === manifest,
                    readFile,
                },
            )).toBe(crate);
        });
    });

    it('keeps the executable name for unavailable classification and gives install guidance', () => {
        const runtime = resolveRustRuntime(preset(), rootPath, {
            runRustupWhich: () => undefined,
            resolveOnPath: () => undefined,
        });

        expect(runtime).toEqual({
            command: 'rust-analyzer',
            args: [],
            origin: 'unavailable',
            label: 'Server: unavailable',
            notes: [RUST_ANALYZER_INSTALL_GUIDANCE],
            recoveryCommand: RUST_ANALYZER_RECOVERY_COMMAND,
        });
    });
});

describe('findExecutableOnPath', () => {
    it('uses PATH order without invoking a shell', () => {
        const first = path.posix.resolve('/', 'first', 'rust-analyzer');
        const second = path.posix.resolve('/', 'second', 'rust-analyzer');

        expect(findExecutableOnPath('rust-analyzer', {
            env: { PATH: [path.posix.dirname(first), path.posix.dirname(second)].join(path.posix.delimiter) },
            platform: 'linux',
            isExecutable: candidate => candidate === second,
        })).toBe(second);
    });

    it('honors PATHEXT when resolving on Windows', () => {
        const executable = path.win32.resolve('C:\\tools', 'rust-analyzer.exe');

        expect(findExecutableOnPath('rust-analyzer', {
            env: { PATH: 'C:\\tools', PATHEXT: '.COM;.EXE' },
            platform: 'win32',
            isExecutable: candidate => path.win32.normalize(candidate).toLowerCase() === executable.toLowerCase(),
        })).toBe(executable);
    });
});

describe('prepareDefinitionForRoot with Rust', () => {
    it('prepares the built-in Rust preset without exposing the resolved host path', () => {
        const prepared = prepareDefinitionForRoot(preset(), rootPath, {
            runRustupWhich: () => rustupAnalyzer,
            resolveOnPath: () => undefined,
        });

        expect(prepared.definition.command).toBe(rustupAnalyzer);
        expect(prepared.runtimeLabel).toBe('Server: rustup (stable)');
        expect(prepared.commandLabel).toBe('rust-analyzer');
        expect(prepared.notes).toEqual([]);
        expect(JSON.stringify({
            runtimeLabel: prepared.runtimeLabel,
            commandLabel: prepared.commandLabel,
            notes: prepared.notes,
        })).not.toContain(rustupAnalyzer);
    });

    it('leaves a repointed Rust preset untouched', () => {
        const repointed = preset({ command: 'custom-rust-server', args: ['--stdio'] });
        const prepared = prepareDefinitionForRoot(repointed, rootPath, {
            runRustupWhich: () => rustupAnalyzer,
            resolveOnPath: () => pathAnalyzer,
        });

        expect(prepared).toEqual({ definition: repointed });
        expect(prepared.definition).toBe(repointed);
    });
});
