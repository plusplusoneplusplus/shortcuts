/**
 * Real rust-analyzer coverage for the Rust preset. The fixture is a Cargo
 * workspace with cross-crate symbols, build-script output, a derive macro, and
 * a crates.io dependency, so every answer depends on Rust project analysis.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import { RUST_PRESET } from '../../../src/server/language-servers/presets';
import { resolveRustRuntime } from '../../../src/server/language-servers/rust-adapter';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';
import { safeRm } from '../../helpers/safe-rm';

interface Position {
    line: number;
    character: number;
}

interface Diagnostic {
    message: string;
    source?: string;
}

const CORE_RS = `pub struct Widget {
    pub id: String,
    pub label: String,
}

/// Builds a widget from its parts.
pub fn make_widget(id: &str, label: &str) -> Widget {
    Widget { id: id.to_owned(), label: label.to_owned() }
}

include!(concat!(env!("OUT_DIR"), "/generated.rs"));
`;

const DERIVE_RS = `use proc_macro::TokenStream;

#[proc_macro_derive(FixtureLabel)]
pub fn fixture_label(input: TokenStream) -> TokenStream {
    let source = input.to_string();
    let name = source.split_whitespace()
        .skip_while(|token| *token != "struct")
        .nth(1)
        .expect("derive input must contain a struct");
    format!(
        "impl {name} {{ pub fn generated_label(&self) -> &'static str {{ \\"derived\\" }} }}"
    ).parse().expect("generated impl must parse")
}
`;

const APP_RS = `use core_fixture::{generated_by_build_script, make_widget, Widget};
use fixture_derive::FixtureLabel;
use unicode_ident::is_xid_start;

#[derive(FixtureLabel)]
pub struct Derived;

pub fn render() -> String {
    let widget = make_widget("one", "One");
    let derived = Derived;
    let _macro_value = derived.generated_label();
    let _generated = generated_by_build_script();
    let _external = is_xid_start('A');
    consume_widget(widget)
}

fn consume_widget(widget: Widget) -> String {
    widget.label.to_owned()
}
`;

const APP_WITH_ERROR_RS = APP_RS.replace(
    '    consume_widget(widget)',
    '    let broken = ;\n    consume_widget(widget)',
);

let root: string;
let session: LanguageServerSession;
const diagnostics = new Map<string, Diagnostic[]>();
let appVersion = 1;

function write(file: string, content: string): void {
    const destination = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
}

function createProject(): string {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-lsp-rust-'));
    root = dir;
    write('Cargo.toml', `[workspace]
resolver = "2"
members = ["core-fixture", "fixture-derive", "app"]
`);
    write('core-fixture/Cargo.toml', `[package]
name = "core-fixture"
version = "0.1.0"
edition = "2024"
build = "build.rs"
`);
    write('core-fixture/build.rs', `fn main() {
    let output = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("generated.rs");
    std::fs::write(output, "pub fn generated_by_build_script() -> &'static str { \\"generated\\" }\\n").unwrap();
}
`);
    write('core-fixture/src/lib.rs', CORE_RS);
    write('fixture-derive/Cargo.toml', `[package]
name = "fixture-derive"
version = "0.1.0"
edition = "2024"

[lib]
proc-macro = true
`);
    write('fixture-derive/src/lib.rs', DERIVE_RS);
    write('app/Cargo.toml', `[package]
name = "app"
version = "0.1.0"
edition = "2024"

[dependencies]
core-fixture = { path = "../core-fixture" }
fixture-derive = { path = "../fixture-derive" }
unicode-ident = "1.0"
`);
    write('app/src/lib.rs', APP_RS);
    execFileSync('cargo', ['fetch', '--quiet'], { cwd: root, timeout: 120_000 });
    return dir;
}

function uriFor(relative: string): string {
    return pathToFileURL(path.join(root, ...relative.split('/'))).href;
}

function fileUriKey(uri: string): string {
    if (!uri.startsWith('file:')) {
        return uri;
    }
    let resolved: string;
    try {
        resolved = fs.realpathSync.native(fileURLToPath(uri));
    } catch {
        resolved = path.resolve(fileURLToPath(uri));
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function positionAt(text: string, marker: string, offsetInMarker = 0): Position {
    const index = text.indexOf(marker);
    if (index < 0) {
        throw new Error(`Marker not found: ${marker}`);
    }
    const target = index + offsetInMarker;
    const before = text.slice(0, target);
    const line = before.split('\n').length - 1;
    return { line, character: target - (before.lastIndexOf('\n') + 1) };
}

function openApp(text: string): void {
    session.sendNotification('textDocument/didOpen', {
        textDocument: { uri: uriFor('app/src/lib.rs'), languageId: 'rust', version: appVersion, text },
    });
}

function changeApp(text: string): void {
    appVersion += 1;
    session.sendNotification('textDocument/didChange', {
        textDocument: { uri: uriFor('app/src/lib.rs'), version: appVersion },
        contentChanges: [{ text }],
    });
}

async function waitFor<T>(
    produce: () => T | undefined | Promise<T | undefined>,
    description: string,
    timeoutMs = 90_000,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await produce();
        if (value !== undefined) {
            return value;
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${description}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

async function waitForRequest<T>(
    method: string,
    params: unknown,
    check: (result: T) => boolean,
    description: string,
): Promise<T> {
    return waitFor(async () => {
        try {
            const result = await session.sendRequest<T>(method, params);
            return check(result) ? result : undefined;
        } catch (error) {
            if (error instanceof Error && error.message === 'content modified') {
                return undefined;
            }
            throw error;
        }
    }, description);
}

async function waitForDiagnostics(check: (found: Diagnostic[]) => boolean): Promise<Diagnostic[]> {
    const key = fileUriKey(uriFor('app/src/lib.rs'));
    try {
        return await waitFor(() => {
            const found = diagnostics.get(key);
            return found && check(found) ? found : undefined;
        }, 'Rust diagnostics');
    } catch (error) {
        throw new Error(`${String(error)}; received ${JSON.stringify([...diagnostics])}`);
    }
}

function targetUris(result: unknown): string[] {
    const entries = Array.isArray(result) ? result : result ? [result] : [];
    return entries.flatMap((entry) => {
        const location = entry as { uri?: unknown; targetUri?: unknown };
        const uri = typeof location.targetUri === 'string' ? location.targetUri : location.uri;
        return typeof uri === 'string' ? [uri] : [];
    });
}

function hoverText(result: unknown): string {
    const contents = (result as { contents?: unknown } | null)?.contents;
    if (typeof contents === 'string') {
        return contents;
    }
    if (Array.isArray(contents)) {
        return contents.map((entry) => hoverText({ contents: entry })).join('\n');
    }
    const value = (contents as { value?: unknown } | undefined)?.value;
    return typeof value === 'string' ? value : '';
}

function completionLabels(result: unknown): string[] {
    const items = Array.isArray(result) ? result : ((result as { items?: unknown[] } | null)?.items ?? []);
    return items.flatMap((item) => {
        const label = (item as { label?: unknown }).label;
        return typeof label === 'string' ? [label] : [];
    });
}

beforeAll(async () => {
    root = createProject();
    const runtime = resolveRustRuntime(RUST_PRESET, root);
    if (runtime.origin === 'unavailable') {
        throw new Error('rust-analyzer is required; install it with `rustup component add rust-analyzer`');
    }
    const enabled: LanguageServerDefinition = { ...RUST_PRESET, enabled: true };
    const prepared = prepareDefinitionForRoot(enabled, root);
    session = new LanguageServerSession({
        definition: prepared.definition,
        rootPath: root,
        runtimeLabel: prepared.runtimeLabel,
        commandLabel: prepared.commandLabel,
        startTimeoutMs: 120_000,
        requestTimeoutMs: 120_000,
        idleTimeoutMs: 10 * 60_000,
    });
    session.onNotification('textDocument/publishDiagnostics', (params) => {
        const payload = params as { uri?: unknown; diagnostics?: Diagnostic[] };
        if (typeof payload.uri === 'string') {
            diagnostics.set(fileUriKey(payload.uri), payload.diagnostics ?? []);
        }
    });
    await session.start();
    openApp(APP_WITH_ERROR_RS);
    await waitForRequest(
        'textDocument/hover',
        {
            textDocument: { uri: uriFor('app/src/lib.rs') },
            position: positionAt(APP_WITH_ERROR_RS, 'make_widget("one"', 2),
        },
        (result) => hoverText(result).includes('fn make_widget'),
        'rust-analyzer project loading',
    );
}, 180_000);

afterAll(async () => {
    await session?.dispose();
    if (root) {
        await safeRm(root);
    }
});

describe('real rust-analyzer runtime', () => {
    it('uses rustup discovery and keeps host paths out of browser state', () => {
        const runtime = resolveRustRuntime(RUST_PRESET, root);
        expect(runtime.origin).toBe('rustup');
        expect(path.isAbsolute(runtime.command)).toBe(true);
        expect(session.getState()).toMatchObject({
            displayName: 'Rust',
            runtime: expect.stringContaining('rustup'),
        });
        expect(['ready', 'indexing']).toContain(session.getState().status);
        expect(JSON.stringify(session.getState())).not.toContain(runtime.command);
    });

    it('negotiates every shipped Rust language capability', () => {
        const capabilities = session.getState().capabilities as Record<string, unknown>;
        expect(capabilities.hoverProvider).toBeTruthy();
        expect(capabilities.definitionProvider).toBeTruthy();
        expect(capabilities.referencesProvider).toBeTruthy();
        expect(capabilities.completionProvider).toBeTruthy();
        expect(capabilities.signatureHelpProvider).toBeTruthy();
        expect(capabilities.textDocumentSync).toBeDefined();
        expect(capabilities.positionEncoding ?? 'utf-16').toBe('utf-16');
    });

    it('ships in-memory diagnostics with build scripts and proc macros enabled', () => {
        expect(RUST_PRESET.initializationOptions).toEqual({
            checkOnSave: false,
            cargo: { buildScripts: { enable: true } },
            procMacro: { enable: true },
        });
    });
});

describe('Rust language features over a real Cargo workspace', () => {
    it('hovers a cross-crate function with its resolved signature and docs', async () => {
        const result = await session.sendRequest('textDocument/hover', {
            textDocument: { uri: uriFor('app/src/lib.rs') },
            position: positionAt(APP_RS, 'make_widget("one"', 2),
        });
        expect(hoverText(result)).toContain('fn make_widget');
        expect(hoverText(result)).toContain('Builds a widget from its parts.');
    });

    it('goes to a definition in another workspace crate', async () => {
        const result = await session.sendRequest('textDocument/definition', {
            textDocument: { uri: uriFor('app/src/lib.rs') },
            position: positionAt(APP_RS, 'make_widget("one"', 2),
        });
        expect(targetUris(result).map(fileUriKey)).toContain(fileUriKey(uriFor('core-fixture/src/lib.rs')));
    });

    it('finds references to a type across workspace crates', async () => {
        const result = await session.sendRequest('textDocument/references', {
            textDocument: { uri: uriFor('core-fixture/src/lib.rs') },
            position: positionAt(CORE_RS, 'struct Widget', 'struct '.length),
            context: { includeDeclaration: true },
        });
        const targets = targetUris(result).map(fileUriKey);
        expect(targets).toContain(fileUriKey(uriFor('core-fixture/src/lib.rs')));
        expect(targets).toContain(fileUriKey(uriFor('app/src/lib.rs')));
    });

    it('completes fields and derive-macro generated methods', async () => {
        const completionText = APP_RS
            .replace('widget.label', 'widget.')
            .replace('derived.generated_label()', 'derived.');
        changeApp(completionText);
        const widgetResult = await session.sendRequest('textDocument/completion', {
            textDocument: { uri: uriFor('app/src/lib.rs') },
            position: positionAt(completionText, 'widget.', 'widget.'.length),
            context: { triggerKind: 1 },
        });
        expect(completionLabels(widgetResult)).toContain('label');

        const macroResult = await waitForRequest(
            'textDocument/completion',
            {
                textDocument: { uri: uriFor('app/src/lib.rs') },
                position: positionAt(completionText, 'derived.', 'derived.'.length),
                context: { triggerKind: 1 },
            },
            (result) => completionLabels(result).includes('generated_label'),
            'derive-macro completion',
        );
        expect(completionLabels(macroResult)).toContain('generated_label');
        changeApp(APP_RS);
    });

    it('answers signature help inside a cross-crate call', async () => {
        const result = (await session.sendRequest('textDocument/signatureHelp', {
            textDocument: { uri: uriFor('app/src/lib.rs') },
            position: positionAt(APP_RS, '"One")', 2),
            context: { triggerKind: 1, isRetrigger: false },
        })) as { signatures?: { label?: string }[]; activeParameter?: number } | null;
        expect(result?.signatures?.[0]?.label).toContain('id: &str');
        expect(result?.signatures?.[0]?.label).toContain('label: &str');
        expect(result?.activeParameter).toBe(1);
    });

    it('resolves build-script output with the preset defaults', async () => {
        const result = await waitForRequest(
            'textDocument/hover',
            {
                textDocument: { uri: uriFor('app/src/lib.rs') },
                position: positionAt(APP_RS, 'generated_by_build_script();', 2),
            },
            (candidate) => hoverText(candidate).includes('fn generated_by_build_script'),
            'build-script symbol',
        );
        expect(hoverText(result)).toContain('fn generated_by_build_script');
    });

    it('treats a crates.io definition as an external target', async () => {
        const result = await session.sendRequest('textDocument/definition', {
            textDocument: { uri: uriFor('app/src/lib.rs') },
            position: positionAt(APP_RS, "is_xid_start('A')", 2),
        });
        const targets = targetUris(result).map(fileURLToPath);
        expect(targets.some((target) => !target.startsWith(`${root}${path.sep}`) && target.includes('unicode-ident'))).toBe(true);
    });
});

describe('unsaved Rust buffers', () => {
    afterAll(async () => {
        changeApp(APP_RS);
        await waitForDiagnostics((found) => found.length === 0);
    });

    it('publishes diagnostics for content that was never written to disk', async () => {
        changeApp(APP_WITH_ERROR_RS);
        const found = await waitForDiagnostics((entries) => entries.some((entry) => /expected.*expression/i.test(entry.message)));
        expect(found.length).toBeGreaterThan(0);
        expect(fs.readFileSync(path.join(root, 'app', 'src', 'lib.rs'), 'utf8')).toBe(APP_RS);
    });

    it('answers hover from the unsaved content and clears its diagnostic', async () => {
        const unsaved = APP_RS.replace('let _external', 'let unsaved_name');
        changeApp(unsaved);
        await waitForDiagnostics((found) => found.length === 0);
        const result = await session.sendRequest('textDocument/hover', {
            textDocument: { uri: uriFor('app/src/lib.rs') },
            position: positionAt(unsaved, 'unsaved_name', 2),
        });
        expect(hoverText(result)).toContain('bool');
        expect(fs.readFileSync(path.join(root, 'app', 'src', 'lib.rs'), 'utf8')).toBe(APP_RS);
    });
});

describe('workspace check settings', () => {
    it('reach rust-analyzer and can turn checking on', async () => {
        const marker = path.join(root, 'check-ran.txt');
        const script = path.join(root, 'check-command.cjs');
        fs.writeFileSync(script, `require('fs').appendFileSync(process.argv[2], 'ran\\n');\n`);
        const definition: LanguageServerDefinition = {
            ...RUST_PRESET,
            enabled: true,
            settings: {
                'rust-analyzer': {
                    checkOnSave: true,
                    check: { overrideCommand: [process.execPath, script, marker] },
                },
            },
        };
        const prepared = prepareDefinitionForRoot(definition, root);
        const configured = new LanguageServerSession({
            definition: prepared.definition,
            rootPath: root,
            startTimeoutMs: 120_000,
            requestTimeoutMs: 120_000,
        });
        try {
            await configured.start();
            configured.sendNotification('textDocument/didOpen', {
                textDocument: { uri: uriFor('app/src/lib.rs'), languageId: 'rust', version: 1, text: APP_RS },
            });
            configured.sendNotification('textDocument/didSave', {
                textDocument: { uri: uriFor('app/src/lib.rs') },
                text: APP_RS,
            });
            await waitFor(() => fs.existsSync(marker) ? true : undefined, 'configured cargo check command');
        } finally {
            await configured.dispose();
        }
        expect(fs.readFileSync(marker, 'utf8')).toContain('ran');
    }, 180_000);
});
