// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBrowserDomExpression, type BrowserDomCommand, type BrowserDomSnapshot, type BrowserDomTarget } from '../src/browser-control-dom';
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
