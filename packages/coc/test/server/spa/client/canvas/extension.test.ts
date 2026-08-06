/**
 * Layer D (extension) — offline view-only body builder tests.
 *
 * `buildExtensionExportBody` is pure string assembly (no DOM / no `fetch`), so
 * these run in the plain vitest node project. They cover: the sandboxed iframe
 * surface (sandbox stays `allow-scripts`, never `allow-same-origin`); the offline
 * `CanvasHost` (frozen state delivered to `onState`, `invoke`/`setState` rejecting
 * with `code: 'offline'` rather than hanging a v2 extension, no postMessage/parent
 * access, `capabilitiesJs` never present); frozen-state
 * parsing (valid / empty / malformed → safe fallback + warning); script-breakout
 * and attribute-escaping safety; external-reference neutralization (`<script src>`,
 * `<link>`, residual network URLs); the view-only banner; and byte-determinism.
 */

import { describe, it, expect } from 'vitest';
import {
    buildExtensionExportBody,
    type ExtensionExportInput,
} from '../../../../../src/server/spa/client/react/features/canvas/html-export/extension';
import { CANVAS_HOST_VERSION } from '../../../../../src/server/spa/client/react/features/canvas/canvas-host-protocol';

const SIMPLE_UI = '<div id="app">Hello</div><script>CanvasHost.onState(function (s) { document.title = s.n; });</script>';

/**
 * Extract and HTML-unescape the iframe `srcdoc` attribute value — this is the
 * exact inner document string the browser parses, so assertions on the offline
 * `CanvasHost` bootstrap read it rather than the attribute-escaped outer HTML.
 * `&amp;` is reversed last (it is the escape for `&`, which every entity opens with).
 */
function decodeSrcdoc(bodyHtml: string): string {
    const start = bodyHtml.indexOf('srcdoc="') + 'srcdoc="'.length;
    const end = bodyHtml.indexOf('">', start);
    return bodyHtml
        .slice(start, end)
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
}

function build(overrides: Partial<ExtensionExportInput> = {}) {
    return buildExtensionExportBody({
        uiHtml: SIMPLE_UI,
        stateContent: '{"n":"x"}',
        title: 'My Widget',
        ...overrides,
    });
}

describe('buildExtensionExportBody — sandbox & surface', () => {
    it('renders the extension inside a sandboxed iframe (allow-scripts only, never allow-same-origin)', () => {
        const { bodyHtml } = build();
        expect(bodyHtml).toContain('<iframe');
        expect(bodyHtml).toContain('sandbox="allow-scripts"');
        expect(bodyHtml).not.toContain('allow-same-origin');
        expect(bodyHtml).toContain('srcdoc="');
    });

    it('shows a view-only banner identifying the snapshot', () => {
        const { bodyHtml } = build();
        expect(bodyHtml).toContain('canvas-export__viewonly-banner');
        expect(bodyHtml).toMatch(/view-only snapshot/i);
        expect(bodyHtml).toMatch(/no data is saved/i);
    });

    it('sets the iframe title from the canvas title (attribute-escaped)', () => {
        const { bodyHtml } = build({ title: 'A & "B"' });
        expect(bodyHtml).toContain('title="A &amp; &quot;B&quot;"');
    });
});

describe('buildExtensionExportBody — offline CanvasHost', () => {
    it('delivers the frozen state to onState and makes invoke/setState offline', () => {
        const inner = decodeSrcdoc(build({ stateContent: '{"count":5}' }).bodyHtml);
        // Frozen state embedded as a JS literal inside the bootstrap.
        expect(inner).toContain('var STATE = {"count":5};');
        // onState delivers the frozen snapshot synchronously.
        expect(inner).toContain('cb(STATE, META)');
        // invoke/setState reject — no server, no persistence.
        expect(inner).toContain("invoke: offline('invoke')");
        expect(inner).toContain("setState: offline('setState')");
        expect(inner).toContain("listFiles: offline('listFiles')");
        expect(inner).toContain("readFile: offline('readFile')");
        expect(inner).toContain("err.code = 'offline'");
    });

    it('advertises the same protocol version as the live host', () => {
        const inner = decodeSrcdoc(build().bodyHtml);
        expect(inner).toContain(`version: ${CANVAS_HOST_VERSION}`);
    });

    it('never posts to a parent host or references postMessage', () => {
        const { bodyHtml } = build();
        expect(bodyHtml).not.toContain('postMessage');
        expect(bodyHtml).not.toContain('parent.');
        expect(bodyHtml).not.toContain('invoke-capability');
        expect(bodyHtml).not.toContain('set-state');
    });

    it('surfaces revision + title to the extension via onState meta', () => {
        const inner = decodeSrcdoc(build({ title: 'Widget', revision: 7 }).bodyHtml);
        expect(inner).toContain('var META = {"revision":7,"title":"Widget"};');
    });

    it('defaults the meta revision to 0 when not provided', () => {
        const inner = decodeSrcdoc(build({ title: 'Widget', revision: undefined }).bodyHtml);
        expect(inner).toContain('"revision":0');
    });

    it('never ships capability code (capabilitiesJs is server-only)', () => {
        const { bodyHtml } = build();
        expect(bodyHtml).not.toContain('capabilitiesJs');
        expect(bodyHtml).not.toContain('capabilities =');
    });
});

/**
 * The offline bootstrap is executed for real here (it is plain ES5 needing only
 * `window`), because the contract that matters is runtime behaviour: under
 * protocol v2 an extension `await`s `invoke`/`setState`, so these must REJECT
 * promptly. A no-op returning `undefined` — or a promise that never settles —
 * would hang the exported page, which no string assertion would catch.
 */
describe('buildExtensionExportBody — offline calls reject rather than no-op', () => {
    function runOfflineBootstrap() {
        const inner = decodeSrcdoc(build({ stateContent: '{"count":5}', title: 'Widget', revision: 3 }).bodyHtml);
        const body = inner.slice(inner.indexOf('<script>') + '<script>'.length, inner.indexOf('</script>'));
        const frameWindow = { CanvasHost: undefined as any };
        // eslint-disable-next-line no-new-func
        new Function('window', body)(frameWindow);
        return frameWindow.CanvasHost as {
            version: number;
            onState: (cb: (state: unknown, meta: unknown) => void) => void;
            invoke: (name: string, params?: unknown) => Promise<unknown>;
            setState: (state: unknown) => Promise<unknown>;
            listFiles: () => Promise<unknown>;
            readFile: (path: string, options?: unknown) => Promise<unknown>;
        };
    }

    it('rejects invoke and setState with code "offline"', async () => {
        const host = runOfflineBootstrap();

        await expect(host.invoke('bump', {})).rejects.toMatchObject({ code: 'offline' });
        await expect(host.setState({ count: 6 })).rejects.toMatchObject({ code: 'offline' });
    });

    /**
     * The canvas's files are NOT inlined into an export — it would multiply the
     * size with no bound. So the file bridge must fail loudly and immediately;
     * a promise left pending would hang an artifact that awaits its data at
     * mount, leaving a blank page with no explanation.
     */
    it('rejects listFiles and readFile with code "offline"', async () => {
        const host = runOfflineBootstrap();

        await expect(host.listFiles()).rejects.toMatchObject({ code: 'offline' });
        await expect(host.readFile('data.csv')).rejects.toMatchObject({ code: 'offline' });
    });

    it('says why the file is unavailable rather than reading as a missing file', async () => {
        const host = runOfflineBootstrap();
        const error = await host.readFile('data.csv').catch((err: Error) => err);

        expect(String((error as Error).message)).toContain('readFile');
        expect(String((error as Error).message)).toContain('view-only snapshot');
    });

    it('rejects a file read promptly — it never hangs', async () => {
        const host = runOfflineBootstrap();
        const outcome = await Promise.race([
            host.readFile('data.csv').then(() => 'resolved', (err: any) => err.code),
            new Promise(resolve => setTimeout(() => resolve('hung'), 50)),
        ]);
        expect(outcome).toBe('offline');
    });

    it('rejects promptly — the promise settles, it never hangs', async () => {
        const host = runOfflineBootstrap();
        const outcome = await Promise.race([
            host.invoke('bump').then(() => 'resolved', (err: any) => err.code),
            new Promise(resolve => setTimeout(() => resolve('hung'), 50)),
        ]);
        expect(outcome).toBe('offline');
    });

    it('does not surface an unhandled rejection when the extension ignores the result', async () => {
        const host = runOfflineBootstrap();
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
        process.on('unhandledRejection', onUnhandled);
        try {
            // A fire-and-forget v1-style call — the return value is discarded.
            host.invoke('bump', {});
            host.setState({ count: 6 });
            // Let Node run its unhandled-rejection checkpoints.
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setImmediate(resolve));
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
        expect(unhandled).toEqual([]);
    });

    it('still delivers the frozen state synchronously to onState', () => {
        const host = runOfflineBootstrap();
        const seen: Array<[unknown, unknown]> = [];
        host.onState((state, meta) => { seen.push([state, meta]); });
        expect(seen).toEqual([[{ count: 5 }, { revision: 3, title: 'Widget' }]]);
        expect(host.version).toBe(CANVAS_HOST_VERSION);
    });
});

describe('buildExtensionExportBody — frozen state parsing', () => {
    it('freezes valid JSON state and pretty-prints it as recoverable source', () => {
        const { stateJson, warnings } = build({ stateContent: '{"a":1,"b":[2,3]}' });
        expect(JSON.parse(stateJson)).toEqual({ a: 1, b: [2, 3] });
        expect(stateJson).toContain('\n'); // pretty-printed (2-space indent)
        expect(warnings).toEqual([]);
    });

    it('treats empty / whitespace content as an empty state with no warning', () => {
        for (const stateContent of ['', '   ', '\n\t']) {
            const { bodyHtml, stateJson, warnings } = build({ stateContent });
            expect(bodyHtml).toContain('var STATE = {};');
            expect(JSON.parse(stateJson)).toEqual({});
            expect(warnings).toEqual([]);
        }
    });

    it('falls back to an empty state with a warning on malformed JSON (never crashes)', () => {
        const { bodyHtml, stateJson, warnings } = build({ stateContent: '{not valid json' });
        expect(bodyHtml).toContain('var STATE = {};');
        expect(JSON.parse(stateJson)).toEqual({});
        expect(warnings.some(w => /not valid json/i.test(w))).toBe(true);
    });
});

describe('buildExtensionExportBody — escaping & breakout safety', () => {
    it('escapes `<` in the embedded state so a </script> in a value cannot break out', () => {
        const { bodyHtml } = build({ stateContent: JSON.stringify({ note: '</script><img src=x>' }) });
        // The literal closing tag must not appear verbatim from the state value.
        expect(bodyHtml).not.toContain('</script><img src=x>');
        expect(bodyHtml).toContain('\\u003c/script>');
    });

    it('escapes the srcdoc attribute so embedded quotes cannot terminate it', () => {
        const { bodyHtml } = build({ uiHtml: '<div data-x="a &amp; b">"quoted"</div>' });
        // Inside srcdoc, `"` is escaped to &quot; and `&` to &amp; — the outer
        // srcdoc attribute stays well-formed.
        expect(bodyHtml).toContain('&quot;quoted&quot;');
        // No unescaped double-quote from the UI leaks into the attribute value.
        const srcdoc = bodyHtml.slice(bodyHtml.indexOf('srcdoc="') + 'srcdoc="'.length);
        const attrValue = srcdoc.slice(0, srcdoc.indexOf('">'));
        expect(attrValue).not.toContain('"');
    });
});

describe('buildExtensionExportBody — external reference neutralization', () => {
    it('removes an external <script src> and warns', () => {
        const ui = '<div>ok</div><script src="https://cdn.example.com/lib.js"></script>';
        const { bodyHtml, warnings } = build({ uiHtml: ui });
        expect(bodyHtml).not.toContain('cdn.example.com');
        expect(bodyHtml).toContain('external script removed');
        expect(warnings.some(w => /external <script src>/i.test(w))).toBe(true);
    });

    it('does not gobble a later inline <script> when removing an unterminated external one', () => {
        const ui =
            '<script src="https://cdn.example.com/a.js"></script>' +
            '<div>body</div>' +
            '<script>CanvasHost.onState(function () {});</script>';
        const { bodyHtml } = build({ uiHtml: ui });
        expect(bodyHtml).not.toContain('cdn.example.com');
        // The inline extension script survives.
        expect(bodyHtml).toContain('CanvasHost.onState(function () {})');
        expect(bodyHtml).toContain('<div>body</div>');
    });

    it('removes a <link> stylesheet reference and warns', () => {
        const ui = '<link rel="stylesheet" href="https://cdn.example.com/style.css"><div>ok</div>';
        const { bodyHtml, warnings } = build({ uiHtml: ui });
        expect(bodyHtml).not.toContain('style.css');
        expect(bodyHtml).toContain('external link removed');
        expect(warnings.some(w => /<link> reference/i.test(w))).toBe(true);
    });

    it('warns about a residual absolute network URL (e.g. an inline fetch)', () => {
        const ui = '<script>fetch("https://api.example.com/data").then(r => r.json());</script>';
        const { warnings } = build({ uiHtml: ui });
        expect(warnings.some(w => /external URL/i.test(w))).toBe(true);
    });

    it('does not warn about w3.org XML namespaces (never fetched)', () => {
        const ui = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
        const { warnings } = build({ uiHtml: ui });
        expect(warnings.some(w => /external URL/i.test(w))).toBe(false);
    });
});

describe('buildExtensionExportBody — determinism', () => {
    it('produces byte-identical output for the same input', () => {
        const input: ExtensionExportInput = {
            uiHtml: SIMPLE_UI,
            stateContent: '{"n":"x","list":[1,2,3]}',
            title: 'Deterministic',
            revision: 3,
        };
        expect(buildExtensionExportBody(input).bodyHtml).toBe(buildExtensionExportBody(input).bodyHtml);
    });
});

/**
 * The JSX authoring path. A `uiJs` extension ships no HTML of its own: the
 * snapshot inlines the vendored bundles and mounts through the same runtime the
 * live panel uses, so an artifact that renders in the panel renders here.
 */
describe('buildExtensionExportBody — JSX extensions', () => {
    const UI_JS = 'window.CanvasExtension = { mount: function (el, host) { host.onState(function () {}); } };';

    function buildJsx(overrides: Partial<ExtensionExportInput> = {}) {
        return buildExtensionExportBody({
            uiHtml: '',
            uiJs: UI_JS,
            libraries: ['react', 'recharts'],
            libraryBundles: new Map([
                ['react', 'window.React = { createElement: function () {} };'],
                ['recharts', 'window.Recharts = {};'],
            ] as [never, string][]),
            missingLibraries: [],
            stateContent: '{"rows":[{"v":1}]}',
            title: 'Sales',
            revision: 4,
            ...overrides,
        });
    }

    it('produces a self-contained document: bundles inlined, no external reference left', () => {
        const { bodyHtml } = buildJsx();
        const srcdoc = decodeSrcdoc(bodyHtml);

        expect(srcdoc).toContain('window.React = {');
        expect(srcdoc).toContain('window.Recharts = {};');
        expect(srcdoc).toContain('CanvasExtension');
        // Nothing is fetched at view time — that is the whole point.
        expect(srcdoc).not.toContain('<script src');
        expect(srcdoc).not.toContain('canvas-vendor');
        expect(srcdoc).not.toMatch(/https?:\/\//);
    });

    it('inlines bundles in dependency order, ahead of the code that uses them', () => {
        const { bodyHtml } = buildJsx();
        const srcdoc = decodeSrcdoc(bodyHtml);
        expect(srcdoc.indexOf('window.React = {')).toBeLessThan(srcdoc.indexOf('window.Recharts = {};'));
        expect(srcdoc.indexOf('window.Recharts = {};')).toBeLessThan(srcdoc.indexOf('CanvasExtension'));
    });

    it('keeps the offline host contract: frozen state in, invoke/setState rejecting, no capabilities', () => {
        const { bodyHtml, stateJson } = buildJsx();
        const srcdoc = decodeSrcdoc(bodyHtml);

        expect(srcdoc).toContain(`version: ${CANVAS_HOST_VERSION}`);
        expect(srcdoc).toContain("err.code = 'offline'");
        expect(srcdoc).toContain('"rows"');
        expect(srcdoc).not.toContain('capabilities =');
        expect(JSON.parse(stateJson)).toEqual({ rows: [{ v: 1 }] });
    });

    it('inlines a stylesheet library as <style>, not <link>', () => {
        const { bodyHtml } = buildJsx({
            libraries: ['tailwind', 'react'],
            libraryBundles: new Map([
                ['tailwind', '.p-4{padding:1rem}'],
                ['react', 'window.React = {};'],
            ] as [never, string][]),
        });
        const srcdoc = decodeSrcdoc(bodyHtml);
        expect(srcdoc).toContain('<style>');
        expect(srcdoc).toContain('.p-4{padding:1rem}');
        expect(srcdoc).not.toContain('<link');
    });

    it('degrades a missing bundle to an explicit banner, never a blank frame', () => {
        const { bodyHtml, warnings } = buildJsx({
            libraryBundles: new Map([['react', 'window.React = {};']] as [never, string][]),
            missingLibraries: ['recharts'],
        });
        const srcdoc = decodeSrcdoc(bodyHtml);

        expect(srcdoc).toContain('Libraries unavailable: recharts');
        expect(srcdoc).toContain('data-canvas-extension-error');
        expect(warnings.some(w => w.includes('Could not inline 1 canvas library'))).toBe(true);
        // The frame still has real content — the failure is visible, not silent.
        expect(srcdoc.length).toBeGreaterThan(200);
    });

    it('warns about the export size once the inlined bundles get large', () => {
        const { warnings } = buildJsx({
            libraryBundles: new Map([
                ['react', 'x'.repeat(140 * 1024)],
                ['recharts', 'y'.repeat(560 * 1024)],
            ] as [never, string][]),
        });
        expect(warnings.some(w => /bundles \d+ KB of libraries/.test(w))).toBe(true);
        expect(warnings.find(w => /bundles/.test(w))).toContain('react, recharts');
    });

    it('does not warn about the size for a small library set', () => {
        const { warnings } = buildJsx({
            libraries: ['papaparse'],
            libraryBundles: new Map([['papaparse', 'window.Papa = {};']] as [never, string][]),
        });
        expect(warnings.some(w => /bundles/.test(w))).toBe(false);
    });

    it('keeps the sandbox and cannot be broken out of by a </script> in a bundle', () => {
        const { bodyHtml } = buildJsx({
            libraryBundles: new Map([
                ['react', 'window.React = { s: "</script><img src=x>" };'],
                ['recharts', 'window.Recharts = {};'],
            ] as [never, string][]),
        });
        expect(bodyHtml).toContain('sandbox="allow-scripts"');
        expect(bodyHtml).not.toContain('allow-same-origin');
        expect(decodeSrcdoc(bodyHtml)).not.toContain('</script><img src=x>');
    });

    it('is deterministic', () => {
        expect(buildJsx().bodyHtml).toBe(buildJsx().bodyHtml);
    });
});
