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
        };
    }

    it('rejects invoke and setState with code "offline"', async () => {
        const host = runOfflineBootstrap();

        await expect(host.invoke('bump', {})).rejects.toMatchObject({ code: 'offline' });
        await expect(host.setState({ count: 6 })).rejects.toMatchObject({ code: 'offline' });
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
