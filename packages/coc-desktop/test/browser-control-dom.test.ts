// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBrowserDomExpression, type BrowserDomCommand, type BrowserDomReadPage, type BrowserDomScope, type BrowserDomSnapshot, type BrowserDomSnapshotChunk, type BrowserDomTarget, type BrowserDomTextMatch } from '../src/browser-control-dom';
import { BrowserControlPage } from '../src/browser-control-page';

function geometry(element: Element, x = 10, y = 20, width = 80, height = 30) {
    const rect = { x, y, width, height, top: y, left: x, bottom: y + height, right: x + width, toJSON() {} };
    Object.defineProperty(element, 'getClientRects', { value: () => width && height ? [rect] : [], configurable: true });
    Object.defineProperty(element, 'getBoundingClientRect', { value: () => rect, configurable: true });
    Object.defineProperty(element, 'scrollIntoView', { value: vi.fn(), configurable: true });
}

function layout(root: ParentNode = document) {
    for (const element of root.querySelectorAll('*')) geometry(element);
}

function run<T>(command: BrowserDomCommand): T {
    return window.eval(buildBrowserDomExpression(command)) as T;
}

function snapshot(options: { all?: boolean; ref?: string; nextRef?: number } = {}) {
    return run<BrowserDomSnapshot>({ action: 'snapshot', nextRef: 1, ...options });
}

beforeEach(() => {
    Reflect.deleteProperty(window, '__cocBrowserControl');
    document.body.innerHTML = '';
    document.title = 'Fixture';
});

describe('shared injected DOM snapshot', () => {
    it('pages megabyte markdown and snapshots before CDP serialization while preserving complete names and refs', async () => {
        document.body.innerHTML = '<h1>Large</h1><pre></pre><button>Last</button>';
        const text = 'read-body-'.repeat(110000);
        document.querySelector('pre')!.textContent = text;
        const label = 'quote"slash\\'.repeat(110000);
        document.querySelector('button')!.setAttribute('aria-label', label);
        layout();
        const sizes: number[] = [];
        const page = new BrowserControlPage(async (_method, params) => {
            const value = await window.eval(String(params?.expression));
            const response = { result: { value } };
            const size = new TextEncoder().encode(JSON.stringify(response)).length;
            sizes.push(size);
            if (size > 900000) throw new Error('Native transport limit exceeded');
            return response;
        });
        const firstRead = await page.readPage();
        expect(firstRead.text.length).toBe(8000);
        expect(firstRead.textTotal).toBeGreaterThan(1100000);
        const full = run<string>({ action: 'read' });
        expect(await page.readPage(undefined, 8000)).toEqual({ text: full.slice(8000, 16000), textTotal: full.length });
        expect(await page.readPage(undefined, full.length - 20)).toEqual({ text: full.slice(-20), textTotal: full.length });
        const snapshot = await page.snapshot();
        const button = snapshot.elements.find(element => element.role === 'button')!;
        expect(button.name).toBe(label);
        expect((await page.snapshot()).elements).toEqual(snapshot.elements);
        expect(await page.evaluateForTool("'eval-body'.repeat(150000)")).toMatchObject({ valueTruncated: true });
        expect(await page.evaluate('Promise.resolve({answer:42})')).toEqual({ answer: 42 });
        expect(await page.evaluate('NaN')).toBe('NaN');
        expect(await page.evaluate('7n')).toBe('7n');
        expect(await page.evaluate('undefined')).toBeNull();
        expect(Math.max(...sizes)).toBeLessThan(900000);
        window.dispatchEvent(new Event('pagehide'));
        await expect(page.click(button.ref)).rejects.toThrow('stale ref');
        const restored = await page.snapshot();
        expect(restored.elements.find(element => element.role === 'button')?.ref).not.toBe(button.ref);
    });

    it('expires staged snapshot chunks on URL changes and pagehide instead of mixing documents', () => {
        document.body.innerHTML = '<button>Large</button>';
        document.querySelector('button')!.setAttribute('aria-label', 'x'.repeat(100000));
        layout();
        const first = run<{ token: number }>({ action: 'snapshot', nextRef: 1 });
        window.dispatchEvent(new Event('pagehide'));
        expect(() => run({ action: 'snapshot-chunk', token: first.token, offset: 64000 })).toThrow('snapshot expired');
        const second = run<{ token: number }>({ action: 'snapshot', nextRef: 1 });
        window.history.replaceState(null, '', '#changed');
        try {
            expect(() => run({ action: 'snapshot-chunk', token: second.token, offset: 64000 })).toThrow('snapshot expired');
        } finally { window.history.replaceState(null, '', '/'); }
    });

    it('reads visible page or ref content as markdown, including same-origin frames and open shadow roots', () => {
        document.body.innerHTML = '<h1>Article</h1><p>Useful <strong>text</strong> <a href="https://fixture.test/">Link</a></p><p hidden>Hidden</p><script>secret</script><iframe></iframe><div id="host"></div>';
        document.querySelector('iframe')!.contentDocument!.body.innerHTML = '<h2>Frame</h2><p>Nested</p>';
        document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow</p>';
        layout();
        const text = run<string>({ action: 'read' });
        expect(text).toContain('# Article');
        expect(text).toContain('**text**');
        expect(text).toContain('[Link](https://fixture.test/)');
        expect(text).toContain('## Frame');
        expect(text).toContain('Shadow');
        expect(text).not.toMatch(/Hidden|secret/);
        const heading = snapshot().elements.find(element => element.name === 'Article')!;
        expect(run<string>({ action: 'read', ref: heading.ref })).toBe('# Article');
        expect(() => run({ action: 'read', ref: 'e999' })).toThrow('stale ref, re-snapshot');
    });
    it('uses native and ARIA roles/names, labels and heading anchors in a form', () => {
        document.body.innerHTML = `<h1>Account</h1><p>Ordinary text</p>
            <label for="email">Email address</label><input id="email" placeholder="Fallback">
            <label>Password <input type="password" value="never-a-name"></label>
            <input type="submit" value="Submit"><input type="checkbox" aria-label="Remember" checked>
            <span id="label">Help center</span><a href="/help" aria-labelledby="label">Ignored</a>
            <button aria-label="Save">Ignored</button><div role="button" tabindex="0">Custom</div>
            <label for="choice">Plan</label><select id="choice"><option>One</option></select>
            <input type="search" placeholder="Search">`;
        layout();
        const result = snapshot();
        expect(result.title).toBe('Fixture');
        expect(result.url).toBe(location.href);
        expect(result.elements.map(({ role, name }) => [role, name])).toEqual([
            ['heading', 'Account'], ['textbox', 'Email address'], ['textbox', 'Password'], ['button', 'Submit'],
            ['checkbox', 'Remember'], ['link', 'Help center'], ['button', 'Save'], ['button', 'Custom'],
            ['combobox', 'Plan'], ['searchbox', 'Search'],
        ]);
        expect(result.elements.find(entry => entry.name === 'Remember')?.checked).toBe(true);
        expect(JSON.stringify(result)).not.toContain('never-a-name');
    });

    it('skips hidden and disabled controls, hidden ancestors and layoutless elements', () => {
        document.body.innerHTML = `<button>Visible</button><button hidden>Hidden</button><button disabled>Disabled</button>
            <button aria-disabled="true">Aria disabled</button><div aria-hidden="true"><button>Aria hidden</button></div>
            <div style="display:none"><button>Display none</button></div><button style="visibility:hidden">Invisible</button>
            <div inert><button>Inert</button></div><fieldset disabled><input placeholder="Disabled field"></fieldset>
            <input type="hidden"><button id="zero">No layout</button>`;
        layout();
        geometry(document.querySelector('#zero')!, 0, 0, 0, 0);
        expect(snapshot().elements.map(entry => entry.name)).toEqual(['Visible']);
    });

    it('retains refs on repeats, text changes, subtree/all snapshots and reorder', () => {
        document.body.innerHTML = '<h2>Heading</h2><button>A</button><button>B</button>';
        layout();
        const first = snapshot();
        expect(snapshot().elements).toEqual(first.elements);
        const a = document.querySelector('button')!;
        a.textContent = 'Changed';
        document.body.append(a);
        const changed = snapshot();
        expect(changed.elements.at(-1)).toMatchObject({ ref: first.elements[1].ref, name: 'Changed' });
        expect(snapshot({ ref: first.elements[1].ref }).elements).toEqual([{ ...changed.elements.at(-1), depth: 0 }]);
        expect(snapshot({ all: true }).elements).toEqual(expect.arrayContaining(changed.elements.map(entry => expect.objectContaining({ ref: entry.ref, name: entry.name }))));
    });

    it('covers nested same-origin frames and open shadow roots with slotted content once', () => {
        document.body.innerHTML = '<iframe id="outer"></iframe><div id="host"><button slot="actions">Slotted</button></div>';
        const outer = document.querySelector('iframe')!.contentDocument!;
        outer.body.innerHTML = '<button>Frame</button><iframe></iframe>';
        const inner = outer.querySelector('iframe')!.contentDocument!;
        inner.body.innerHTML = '<label for="nested">Nested name</label><input id="nested">';
        const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<span id="shadow-label">Shadow name</span><button aria-labelledby="shadow-label">Ignored</button><slot name="actions"></slot>';
        for (const root of [document, outer, inner, shadow]) layout(root);
        const entries = snapshot().elements;
        expect(entries.map(entry => entry.name)).toEqual(['Frame', 'Nested name', 'Shadow name', 'Slotted']);
        expect(new Set(entries.map(entry => entry.ref)).size).toBe(4);
        expect(snapshot().elements).toEqual(entries);
        document.querySelector('#host')!.setAttribute('hidden', '');
        expect(snapshot().elements.map(entry => entry.name)).toEqual(['Frame', 'Nested name']);
    });

    it('treats inaccessible cross-origin frames and closed shadow roots as opaque', () => {
        document.body.innerHTML = '<iframe></iframe><div id="host"></div><button>Reachable</button>';
        Object.defineProperty(document.querySelector('iframe'), 'contentDocument', { get() { throw new DOMException('Cross origin', 'SecurityError'); } });
        document.querySelector('#host')!.attachShadow({ mode: 'closed' }).innerHTML = '<button>Closed</button>';
        layout();
        expect(snapshot().elements.map(entry => entry.name)).toEqual(['Reachable']);
    });

    it('expires iframe refs and keeps snapshots usable after a same-origin frame becomes inaccessible', () => {
        document.body.innerHTML = '<iframe></iframe><button>Reachable</button>';
        const frame = document.querySelector('iframe')!;
        const oldDocument = frame.contentDocument!;
        oldDocument.body.innerHTML = '<button>Frame button</button>';
        layout(); layout(oldDocument);
        const ref = snapshot().elements.find(element => element.name === 'Frame button')!.ref;
        Object.defineProperty(oldDocument, 'defaultView', {
            configurable: true,
            value: { get document() { throw new DOMException('Cross origin', 'SecurityError'); } },
        });
        Object.defineProperty(frame, 'contentDocument', {
            configurable: true,
            get() { throw new DOMException('Cross origin', 'SecurityError'); },
        });
        expect(() => run({ action: 'target', ref })).toThrow('stale ref, re-snapshot');
        expect(snapshot().elements.map(element => element.name)).toEqual(['Reachable']);
        expect(() => snapshot({ ref })).toThrow('stale ref, re-snapshot');
    });

    it('finds visible wait text through frames and shadow roots without matching scripts or hidden text', () => {
        document.body.innerHTML = '<p>Visible text</p><script>script secret</script><p hidden>hidden secret</p><iframe></iframe><div id="host"></div>';
        document.querySelector('iframe')!.contentDocument!.body.innerHTML = '<p>Frame ready</p>';
        document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow ready</p>';
        for (const text of ['Visible text', 'Frame ready', 'Shadow ready']) expect(run({ action: 'text', text })).toBe(true);
        for (const text of ['script secret', 'hidden secret', 'missing']) expect(run({ action: 'text', text })).toBe(false);
    });

    it('rejects removed refs and never reuses their numbers after document navigation', () => {
        document.body.innerHTML = '<button>Before</button><iframe></iframe>';
        const frame = document.querySelector('iframe')!;
        frame.contentDocument!.body.innerHTML = '<button>Old frame</button>';
        layout(); layout(frame.contentDocument!);
        const first = snapshot();
        document.querySelector('button')!.remove();
        expect(() => snapshot({ ref: first.elements[0].ref })).toThrow('stale ref, re-snapshot');
        frame.remove();
        expect(() => run({ action: 'target', ref: first.elements[1].ref })).toThrow('stale ref, re-snapshot');
        // A navigation gives the page a new registry; the host retains its monotonic counter.
        Reflect.deleteProperty(window, '__cocBrowserControl');
        document.body.innerHTML = '<button>After</button>';
        layout();
        const next = snapshot({ nextRef: first.nextRef });
        expect(next.elements[0].ref).toBe(`e${first.nextRef}`);
        expect(() => run({ action: 'target', ref: first.elements[0].ref })).toThrow('stale ref, re-snapshot');
        expect(() => run({ action: 'target', ref: 'e99999' })).toThrow('stale ref, re-snapshot');
    });

    it('returns a full tree only on all:true, with subtree-local depths', () => {
        document.body.innerHTML = '<main><div><h1>Title</h1><p>Content</p><button>Action</button></div></main>';
        layout();
        expect(snapshot().elements.map(entry => entry.role)).toEqual(['heading', 'button']);
        const full = snapshot({ all: true });
        expect(full.elements.map(entry => entry.role)).toEqual(['generic', 'main', 'generic', 'heading', 'generic', 'button']);
        const main = full.elements.find(entry => entry.role === 'main')!;
        expect(snapshot({ ref: main.ref, all: true }).elements[0]).toEqual({ ...main, depth: 0 });
    });
});

describe('ref resolution before trusted input', () => {
    it.each(['linux', 'darwin', 'win32'] as const)('focuses the editable target before inserting text when a %s click leaves focus unchanged', async platform => {
        document.body.innerHTML = '<button>Other focus</button><label>Message<input></label>';
        layout();
        const input = document.querySelector('input')!;
        const button = document.querySelector('button')!;
        button.focus();
        const ref = snapshot().elements.find(element => element.name === 'Message')!.ref;
        const page = new BrowserControlPage(async (method, params) => {
            if (method === 'Runtime.evaluate') return { result: { value: window.eval(String(params?.expression)) } };
            // A native activation click can leave DOM focus unchanged. Insertion
            // must still address the requested field, never the previous control.
            if (method === 'Input.insertText') {
                expect(document.activeElement).toBe(input);
                input.value = String(params?.text);
            }
            return {};
        }, platform);
        await page.type(ref, 'isolated relay works');
        expect(input.value).toBe('isolated relay works');
        expect(document.activeElement).toBe(input);
    });

    describe('document-scoped frame serialization', () => {
        const scope: BrowserDomScope = { nodes: 20000, chars: 1000000, refs: 10000, generation: 'document-1' };
        const scopedSnapshot = (options: Partial<BrowserDomScope> = {}, nextRef = 1) =>
            run<BrowserDomSnapshot>({ action: 'snapshot', scope: { ...scope, ...options }, nextRef });

        it('leaves same-origin child documents opaque while preserving open shadow roots and slots once', () => {
            document.body.innerHTML = '<button>Main</button><iframe></iframe><div id="host"><button slot="actions">Slotted</button></div>';
            const frame = document.querySelector('iframe')!;
            frame.contentDocument!.body.innerHTML = '<button>Child only</button>';
            const access = vi.spyOn(frame, 'contentDocument', 'get');
            const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<button>Shadow</button><slot name="actions"></slot>';
            const assigned = vi.spyOn(shadow.querySelector('slot')!, 'assignedNodes').mockImplementation(() => { throw new Error('Unbounded assigned node array'); });
            layout(); layout(shadow);
            expect(scopedSnapshot().elements.map(element => element.name)).toEqual(['Main', 'Shadow', 'Slotted']);
            const read = run<BrowserDomReadPage>({ action: 'read', paged: true, scope });
            expect(read.text).toContain('Main');
            expect(read.text.match(/Slotted/g)).toHaveLength(1);
            expect(read.text).not.toContain('Child only');
            expect(run({ action: 'text', text: 'Child only', scope })).toMatchObject({ found: false });
            expect(run({ action: 'text', text: 'Shadow', scope })).toMatchObject({ found: true });
            expect(access).not.toHaveBeenCalled();
            expect(assigned).not.toHaveBeenCalled();
        });

        it('does not consult the embedding frame for visibility or local geometry', () => {
            document.body.innerHTML = '<button>Local</button>';
            layout();
            const embedding = document.createElement('iframe');
            embedding.hidden = true;
            const frameElement = vi.spyOn(window, 'frameElement', 'get').mockReturnValue(embedding);
            const hit = vi.fn(() => document.querySelector('button'));
            Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
            try {
                const ref = scopedSnapshot().elements[0].ref;
                expect(run({ action: 'target', ref, scope })).toEqual({ x: 10, y: 20, width: 80, height: 30 });
                expect(frameElement).not.toHaveBeenCalled();
                expect(embedding.scrollIntoView).toBeUndefined();
            } finally { frameElement.mockRestore(); }
        });

        it('uses the global high-water mark, preserves live refs and expires refs across generations', () => {
            document.body.innerHTML = '<button>Control</button>';
            layout();
            const first = scopedSnapshot({}, 73);
            expect(first.elements[0].ref).toBe('e73');
            expect(scopedSnapshot().elements[0].ref).toBe('e73');
            const second = scopedSnapshot({ generation: 'document-2' });
            expect(second.elements[0].ref).toBe('e74');
            expect(() => run({ action: 'target', ref: first.elements[0].ref, scope: { ...scope, generation: 'document-2' } })).toThrow('stale ref');
            expect(() => run({ action: 'read', ref: second.elements[0].ref, scope: { ...scope, generation: 'document-3' } })).toThrow('stale ref');
        });

        it('stages bounded snapshots and expires pending transport chunks when the generation changes', () => {
            document.body.innerHTML = '<button aria-label="Bounded snapshot label"></button>'.repeat(1000);
            layout();
            const first = run<BrowserDomSnapshotChunk>({ action: 'snapshot', nextRef: 1, scope });
            expect(first.chunk).toHaveLength(64000);
            expect(first.total).toBeLessThanOrEqual(scope.chars);
            let json = first.chunk;
            while (json.length < first.total) {
                const chunk = run<BrowserDomSnapshotChunk>({ action: 'snapshot-chunk', token: first.token, offset: json.length, scope });
                expect(chunk.chunk.length).toBeLessThanOrEqual(64000);
                json += chunk.chunk;
            }
            const result = JSON.parse(json) as BrowserDomSnapshot;
            expect(result.elements).toHaveLength(1000);
            expect(result.consumed).toBeGreaterThanOrEqual(json.length);
            const pending = run<BrowserDomSnapshotChunk>({ action: 'snapshot', nextRef: result.nextRef, scope });
            expect(() => run({
                action: 'snapshot-chunk', token: pending.token, offset: 64000,
                scope: { ...scope, generation: 'replacement-document' },
            })).toThrow('snapshot expired');
        });

        it('bounds accessible names without reading unbounded textContent or cloning label subtrees', () => {
            document.body.innerHTML = '<label>Choice <select><option>Excluded option</option></select></label><button></button><span id="name"></span><input aria-labelledby="name">';
            document.querySelector('button')!.append(document.createTextNode('x'.repeat(1000000)));
            document.querySelector('#name')!.append(document.createTextNode('y'.repeat(1000000)));
            for (const element of document.querySelectorAll('*')) {
                Object.defineProperty(element, 'textContent', { configurable: true, get() { throw new Error('Unbounded textContent'); } });
                Object.defineProperty(element, 'cloneNode', { configurable: true, value() { throw new Error('Unbounded clone'); } });
            }
            layout();
            const names = scopedSnapshot().elements.map(element => element.name);
            expect(names).toEqual(['Choice', 'x'.repeat(160), 'y'.repeat(160)]);
        });

        it('uses referenced hidden labels but excludes disabled and hidden controls from scoped snapshots', () => {
            document.body.innerHTML = '<span id="name" hidden>Accessible name</span><button aria-labelledby="name">Ignored</button><button disabled>Disabled</button><div aria-disabled="true"><button>Inherited disabled</button></div><div hidden><button>Hidden</button></div>';
            layout();
            expect(scopedSnapshot().elements.map(element => element.name)).toEqual(['Accessible name']);
        });

        it('caps node visits and emitted snapshot data before allocating refs', () => {
            document.body.innerHTML = '<div><button>First</button><button>Second</button></div>';
            layout();
            const nodes = scopedSnapshot({ nodes: 1 });
            expect(nodes.visited).toBe(1);
            expect(nodes.truncated).toBe('node-limit');
            const chars = scopedSnapshot({ chars: 16 });
            expect(chars.elements).toEqual([]);
            expect(chars.consumed).toBeGreaterThanOrEqual(JSON.stringify(chars).length);
            expect(chars.truncated).toBe('char-limit');
            const refs = scopedSnapshot({ refs: 1 });
            expect(refs.elements).toHaveLength(1);
            expect(refs.truncated).toBe('ref-limit');
            expect(scopedSnapshot({ refs: 0 }).elements).toEqual([]);
            expect(() => run({ action: 'read', ref: refs.elements[0].ref, scope })).toThrow('stale ref');
        });

        it('charges escaped entry fields and mandatory metadata against aggregate staged snapshot budgets', () => {
            document.body.innerHTML = '<button></button>'.repeat(100);
            for (const button of document.querySelectorAll('button')) button.setAttribute('aria-label', '"\\\u0000'.repeat(60));
            layout();
            const result = scopedSnapshot({ chars: 2000 });
            expect(result.elements.length).toBeGreaterThan(0);
            expect(result.truncated).toBe('char-limit');
            expect(result.consumed).toBeGreaterThanOrEqual(JSON.stringify(result).length);
            expect(result.consumed).toBeLessThanOrEqual(2000);
            expect(result.consumed).toBeGreaterThan(result.elements.reduce((total, element) => total + element.name.length, 0));
            for (const chars of [0, 1, 16]) {
                const tiny = scopedSnapshot({ chars });
                expect(tiny.elements).toEqual([]);
                expect(tiny.truncated).toBe('char-limit');
                expect(tiny.consumed).toBeGreaterThanOrEqual(JSON.stringify(tiny).length);
                expect(tiny.consumed).toBeGreaterThan(chars);
            }
        });

        it('clamps live mappings to the hard ceiling and never reuses evicted capabilities', () => {
            document.body.innerHTML = '<button>Control</button>';
            layout();
            const first = scopedSnapshot();
            const state = (window as unknown as { __cocBrowserControl: {
                refs: Map<string, Element>; ids: WeakMap<Element, string>; nextRef: number;
            } }).__cocBrowserControl;
            const button = document.querySelector('button')!;
            for (let index = 2; index <= 10005; index++) state.refs.set(`e${index}`, button);
            state.nextRef = 10006;
            const capped = scopedSnapshot({ refs: 1000000 });
            expect(state.refs.size).toBe(10000);
            expect(capped.truncated).toBe('ref-limit');
            expect(() => run({ action: 'target', ref: first.elements[0].ref, scope })).toThrow('stale ref');
            state.refs.clear();
            state.ids = new WeakMap();
            expect(scopedSnapshot().elements[0].ref).toBe('e10006');
        });

        it('bounds root text, excludes scripts and reports read work truncation separately from pagination', () => {
            document.body.innerHTML = '<script></script><pre></pre><p>Unvisited tail</p>';
            document.querySelector('script')!.textContent = 'forbidden '.repeat(200000);
            document.querySelector('pre')!.textContent = 'read-body-'.repeat(150000);
            const first = run<BrowserDomReadPage>({ action: 'read', paged: true, scope });
            expect(first.text).toHaveLength(8000);
            expect(first.textTotal).toBeLessThanOrEqual(1000000);
            expect(first.consumed).toBeLessThanOrEqual(1000000);
            expect(first.truncated).toBe('char-limit');
            expect(first.text).not.toContain('forbidden');
            const second = run<BrowserDomReadPage>({ action: 'read', paged: true, offset: 8000, limit: 40, scope });
            const full = run<string>({ action: 'read', scope });
            expect(second.text).toBe(full.slice(8000, 8040));
            expect(second.textTotal).toBe(full.length);
            expect(run({ action: 'text', text: 'Unvisited tail', scope: { ...scope, chars: 50 } })).toMatchObject({ found: false, truncated: 'char-limit' });
            expect(run({ action: 'text', text: 'forbidden', scope })).toMatchObject({ found: false, truncated: 'char-limit' });
            expect(run({ action: 'text', text: 'read-body', scope: { ...scope, chars: 0 } })).toMatchObject({ found: false, consumed: 0, truncated: 'char-limit' });
            const limited = run<BrowserDomReadPage>({ action: 'read', paged: true, scope: { ...scope, nodes: 2 } });
            expect(limited.visited).toBe(2);
            expect(limited.truncated).toBe('node-limit');
        });

        it('reports scoped wait-text work for aggregate accounting while preserving the boolean disabled path', () => {
            document.body.innerHTML = '<p>Ready <strong>now</strong></p><p>Tail</p>';
            const result = run<BrowserDomTextMatch>({ action: 'text', text: 'Ready now', scope });
            expect(result.found).toBe(true);
            expect(result.visited).toBeGreaterThan(0);
            expect(result.visited).toBeLessThanOrEqual(scope.nodes);
            expect(result.consumed).toBeLessThanOrEqual(scope.chars);
            expect(result.truncated).toBeUndefined();
            expect(run({ action: 'text', text: 'Ready now', scope: { ...scope, nodes: 2 } }))
                .toMatchObject({ found: false, visited: 2, truncated: 'node-limit' });
            expect(run({ action: 'text', text: 'Ready now', scope: { ...scope, chars: 3 } }))
                .toMatchObject({ found: false, consumed: 3, truncated: 'char-limit' });
            expect(run({ action: 'text', text: 'Ready now' })).toBe(true);
        });

        it('keeps deep traversal iterative and honors zero and nonfinite budgets', () => {
            let parent: Element = document.body;
            for (let index = 0; index < 300; index++) parent = parent.appendChild(document.createElement('div'));
            parent.appendChild(document.createTextNode('Deep content'));
            const limited = run<BrowserDomReadPage>({ action: 'read', paged: true, scope: { ...scope, nodes: 30 } });
            expect(limited.visited).toBe(30);
            expect(limited.truncated).toBe('node-limit');
            expect(run<BrowserDomReadPage>({ action: 'read', paged: true, scope: { ...scope, nodes: 0 } }).text).toBe('');
            expect(scopedSnapshot({ nodes: Infinity }).visited).toBe(0);
        });

        it('clips local targets to overflow ancestors and the viewport before hit-testing', () => {
            document.body.innerHTML = '<div style="overflow:hidden"><button>Clipped</button></div>';
            layout();
            const button = document.querySelector('button')!;
            geometry(document.querySelector('div')!, 20, 25, 50, 20);
            geometry(button, -10, 10, 100, 100);
            const hit = vi.fn(() => button);
            Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
            const ref = scopedSnapshot().elements[0].ref;
            expect(run({ action: 'target', ref, scope })).toEqual({ x: 20, y: 25, width: 50, height: 20 });
            expect(hit).toHaveBeenCalledWith(45, 35);
            geometry(button, window.innerWidth - 10, window.innerHeight - 10, 40, 40);
            document.querySelector('div')!.style.overflow = 'visible';
            expect(run({ action: 'target', ref, scope })).toEqual({ x: window.innerWidth - 10, y: window.innerHeight - 10, width: 10, height: 10 });
            geometry(button, -100, -100, 30, 30);
            expect(() => run({ action: 'target', ref, scope })).toThrow('no visible bounds');
        });

        it('rejects covering overlays and selects a hit-tested visible subrectangle for partial cover', () => {
            document.body.innerHTML = '<button>Target</button><div>Overlay</div>';
            layout();
            const button = document.querySelector('button')!;
            const overlay = document.querySelector('div')!;
            const ref = scopedSnapshot().elements[0].ref;
            Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => overlay });
            expect(() => run({ action: 'target', ref, scope })).toThrow('obscured');
            Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (x: number) => x < 40 ? button : overlay });
            const target = run<BrowserDomTarget>({ action: 'target', ref, scope });
            expect(target.x + target.width / 2).toBeLessThan(40);
            expect(target.width).toBeGreaterThan(0);
            expect(target.width).toBeLessThan(80);
        });

        it('verifies the final clipped input point without scrolling or changing focus', () => {
            document.body.innerHTML = '<input><button>Target</button><div>Overlay</div>';
            layout();
            const input = document.querySelector('input')!;
            const button = document.querySelector('button')!;
            const overlay = document.querySelector('div')!;
            const ref = scopedSnapshot().elements.find(element => element.name === 'Target')!.ref;
            input.focus();
            Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (x: number) => x < 40 ? button : overlay });
            expect(run({ action: 'hit', ref, x: 20, y: 30, scope })).toBe(true);
            expect(run({ action: 'hit', ref, x: 50, y: 30, scope })).toBe(false);
            expect(run({ action: 'hit', ref, x: -1, y: 30, scope })).toBe(false);
            expect(run({ action: 'hit', ref, x: window.innerWidth, y: 30, scope })).toBe(false);
            expect(button.scrollIntoView).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(input);
            expect(() => run({ action: 'hit', ref, x: 20, y: 30 })).toThrow('disabled');
            const replacement = scopedSnapshot().elements.find(element => element.name === 'Target')!.ref;
            button.disabled = true;
            expect(run({ action: 'hit', ref: replacement, x: 20, y: 30, scope })).toBe(false);
            button.disabled = false; button.hidden = true;
            expect(run({ action: 'hit', ref: replacement, x: 20, y: 30, scope })).toBe(false);
            expect(() => run({ action: 'hit', ref: replacement, x: 20, y: 30, scope: { ...scope, generation: 'new-document' } })).toThrow('stale ref');
        });

        it('hit-tests open shadow descendants and focuses only explicit editable or document targets', () => {
            document.body.innerHTML = '<input aria-label="Editor"><div id="host"></div>';
            const host = document.querySelector('#host')!;
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<button>Shadow button</button>';
            layout(); layout(shadow);
            const input = document.querySelector('input')!;
            const button = shadow.querySelector('button')!;
            Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => host });
            Object.defineProperty(shadow, 'elementFromPoint', { configurable: true, value: () => button });
            const first = scopedSnapshot();
            run({ action: 'target', ref: first.elements.find(element => element.name === 'Shadow button')!.ref, scope });
            expect(run({ action: 'hit', ref: first.elements.find(element => element.name === 'Shadow button')!.ref, x: 20, y: 30, scope })).toBe(true);
            input.focus();
            run({ action: 'read', paged: true, scope });
            expect(document.activeElement).toBe(input);
            expect(run({ action: 'viewport', scope })).toEqual({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
            expect(run({ action: 'focus', scope })).toBe(true);
            expect(document.activeElement).toBe(document.body);
            expect(document.body.hasAttribute('tabindex')).toBe(false);
            Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => input });
            run({ action: 'target', ref: first.elements[0].ref, editable: true, scope });
            expect(document.activeElement).toBe(input);
        });

        it.each(['input', 'select'] as const)('focuses scoped %s without scrolling before measuring and hit-testing its current bounds', tag => {
            document.body.innerHTML = tag === 'input' ? '<input aria-label="Control">' : '<select aria-label="Control"><option value="a">A</option><option value="b">B</option></select>';
            layout();
            const element = document.querySelector(tag)!;
            const ref = scopedSnapshot().elements[0].ref;
            const nativeFocus = element.focus.bind(element);
            const scroll = element.scrollIntoView;
            const focus = vi.spyOn(element, 'focus').mockImplementation(options => {
                nativeFocus(options);
                geometry(element, 45, 65, 90, 40);
            });
            const hit = vi.fn(() => element);
            Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
            const options = tag === 'input' ? { editable: true } : { option: 'b', resetTypeAhead: true as const };
            const target = run<BrowserDomTarget>({ action: 'target', ref, scope, ...options });
            expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
            expect(scroll).toHaveBeenCalledOnce();
            expect(target).toMatchObject({ x: 45, y: 65, width: 90, height: 40 });
            expect(hit).toHaveBeenCalledWith(90, 85);
            expect(document.activeElement).toBe(element);
        });

        it('retains disabled-option filtering, option metadata and editable focus rules in scoped targets', () => {
            document.body.innerHTML = '<input readonly aria-label="Locked"><select aria-label="Choice"><option value="a">A</option><option disabled value="disabled">Disabled</option><optgroup disabled><option value="group">Group</option></optgroup><option value="b" label="  Choice">Other</option></select>';
            layout();
            const entries = scopedSnapshot().elements;
            const select = document.querySelector('select')!;
            const ref = entries.find(element => element.name === 'Choice')!.ref;
            Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => select });
            expect(run<BrowserDomTarget>({ action: 'target', ref, option: 'b', scope })).toMatchObject({
                optionSteps: 1, optionSearch: { text: 'Choice', selected: false, count: 2 },
            });
            expect(document.activeElement).toBe(select);
            for (const option of ['disabled', 'group', 'missing']) {
                expect(() => run({ action: 'target', ref, option, scope })).toThrow('missing or disabled');
            }
            expect(() => run({ action: 'target', ref, option: 'b', scope: { ...scope, nodes: 1 } })).toThrow('work limit');
            expect(() => run({ action: 'target', ref: entries[0].ref, editable: true, scope })).toThrow('not editable');
            select.options[3].removeAttribute('label');
            select.options[3].replaceChildren(document.createTextNode('Z'.repeat(1000000)));
            Object.defineProperty(select.options[3], 'label', { configurable: true, get() { throw new Error('Unbounded option label'); } });
            expect(run<BrowserDomTarget>({ action: 'target', ref, option: 'b', scope }).optionSearch?.text).toBe('Z'.repeat(160));
        });
    });

    it('scrolls and translates target bounds through nested, scaled frame content borders', () => {
        document.body.innerHTML = '<iframe></iframe>';
        const outer = document.querySelector('iframe')!;
        outer.contentDocument!.body.innerHTML = '<iframe></iframe>';
        const inner = outer.contentDocument!.querySelector('iframe')!;
        inner.contentDocument!.body.innerHTML = '<button>Nested</button>';
        const button = inner.contentDocument!.querySelector('button')!;
        for (const root of [document, outer.contentDocument!, inner.contentDocument!]) layout(root);
        geometry(button, 10, 20, 40, 20);
        geometry(inner, 100, 200, 200, 100);
        geometry(outer, 300, 400, 800, 600);
        Object.defineProperties(inner, { offsetWidth: { value: 200 }, offsetHeight: { value: 100 }, clientLeft: { value: 2 }, clientTop: { value: 3 } });
        Object.defineProperties(outer, { offsetWidth: { value: 400 }, offsetHeight: { value: 300 }, clientLeft: { value: 4 }, clientTop: { value: 5 } });
        const ref = snapshot().elements[0].ref;
        expect(run<BrowserDomTarget>({ action: 'target', ref })).toEqual({ x: 532, y: 856, width: 80, height: 40 });
        for (const node of [button, inner, outer]) expect(node.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'center', behavior: 'instant' });
    });

    it('rechecks visibility, disabled state, readOnly and editability after snapshot', () => {
        document.body.innerHTML = '<input><button>Button</button>';
        layout();
        const [inputRef, buttonRef] = snapshot().elements.map(entry => entry.ref);
        expect(() => run({ action: 'target', ref: buttonRef, editable: true })).toThrow('not editable');
        const input = document.querySelector('input')!;
        input.readOnly = true;
        expect(() => run({ action: 'target', ref: inputRef, editable: true })).toThrow('not editable');
        input.disabled = true;
        expect(() => run({ action: 'target', ref: inputRef })).toThrow('hidden or disabled');
        input.disabled = false; input.hidden = true;
        expect(() => run({ action: 'target', ref: inputRef })).toThrow('hidden or disabled');
    });

    it('excludes nested control content from a wrapping label name', () => {
        document.body.innerHTML = '<label>Plan <select><option>A</option><option>B</option></select></label>';
        layout();
        expect(snapshot().elements[0].name).toBe('Plan');
    });

    it('expires refs on same-document URL navigation and pagehide/BFCache restoration', () => {
        document.body.innerHTML = '<button>Before</button>';
        layout();
        const first = snapshot();
        history.replaceState(null, '', '#new-location');
        expect(() => run({ action: 'target', ref: first.elements[0].ref })).toThrow('stale ref, re-snapshot');
        const next = snapshot();
        expect(next.elements[0].ref).not.toBe(first.elements[0].ref);
        window.dispatchEvent(new Event('pagehide'));
        expect(() => run({ action: 'target', ref: next.elements[0].ref })).toThrow('stale ref, re-snapshot');
        expect(snapshot().elements[0].ref).not.toBe(next.elements[0].ref);
        history.replaceState(null, '', location.pathname);
    });

    it('finds selectable values, skips disabled options/optgroups and focuses the select', () => {
        document.body.innerHTML = `<select><option value="a">A</option><option value="disabled" disabled>Disabled</option>
            <optgroup disabled><option value="group">Group</option></optgroup><option value="b">B</option></select>`;
        layout();
        const ref = snapshot().elements[0].ref;
        expect(run<BrowserDomTarget>({ action: 'target', ref, option: 'b' }).optionSteps).toBe(1);
        expect(document.activeElement).toBe(document.querySelector('select'));
        expect(() => run({ action: 'target', ref, option: 'disabled' })).toThrow('missing or disabled');
        expect(() => run({ action: 'target', ref, option: 'group' })).toThrow('missing or disabled');
        expect(() => run({ action: 'target', ref, option: 'missing' })).toThrow('missing or disabled');
    });

    it('reports native-menu typeahead state and resets only the requested select focus', () => {
        document.body.innerHTML = '<select><option value="a">A</option><option value="b" label="  Choice">Other</option></select>';
        layout();
        const ref = snapshot().elements[0].ref;
        const select = document.querySelector('select')!;
        const blur = vi.spyOn(select, 'blur');
        expect(run<BrowserDomTarget>({ action: 'target', ref, option: 'b' }).optionSearch)
            .toEqual({ text: 'Choice', selected: false, count: 2 });
        expect(blur).not.toHaveBeenCalled();
        select.value = 'b';
        expect(run<BrowserDomTarget>({ action: 'target', ref, option: 'b', resetTypeAhead: true }).optionSearch)
            .toEqual({ text: 'Choice', selected: true, count: 2 });
        expect(blur).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(select);
        select.multiple = true;
        expect(run<BrowserDomTarget>({ action: 'target', ref, option: 'b' }).optionSearch).toBeUndefined();
        select.multiple = false;
        select.size = 3;
        expect(run<BrowserDomTarget>({ action: 'target', ref, option: 'b' }).optionSearch).toBeUndefined();
    });
});


describe('opaque human continuation stamps', () => {
    it('keeps untouched pages valid and invalidates same-document targets, input/focus, history and document generations without reading values', async () => {
        const old = (window as any).__cocHumanContinuation;
        old?.observer?.disconnect(); Reflect.deleteProperty(window, '__cocHumanContinuation');
        document.body.innerHTML = '<button>Continue</button><input type="password"><input autocomplete="one-time-code">';
        const page = new BrowserControlPage(async (method, params) => {
            expect(method).toBe('Runtime.evaluate');
            expect(String(params?.expression)).not.toContain('.value');
            return { result: { value: window.eval(String(params?.expression)) } };
        });
        const first = await page.continuationStamp(); expect(await page.continuationStamp()).toBe(first);
        document.querySelector('button')!.textContent = 'Submit';
        const changed = await page.continuationStamp(); expect(changed).not.toBe(first);
        document.querySelector('input')!.value = 'private-password';
        document.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
        const input = await page.continuationStamp(); expect(input).not.toBe(changed); expect(input).not.toContain('private-password');
        history.pushState(null, '', '#manual'); const historyStamp = await page.continuationStamp(); expect(historyStamp).not.toBe(input);
        (window as any).__cocHumanContinuation.observer.disconnect(); Reflect.deleteProperty(window, '__cocHumanContinuation');
        expect(await page.continuationStamp()).not.toBe(historyStamp);
        (window as any).__cocHumanContinuation.observer.disconnect(); Reflect.deleteProperty(window, '__cocHumanContinuation');
        history.replaceState(null, '', '#');
    });
});
