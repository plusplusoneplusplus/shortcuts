// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROWSER_DEMO_BINDING, buildBrowserDemoCaptureSource, redactDemoText, redactDemoUrl, sanitizeDemoObservation, type BrowserDemoObservation } from '../src/browser-demo-capture';

let sent: BrowserDemoObservation[];
let trusted: boolean;
const realAdd = window.addEventListener.bind(window);
const added: [string, EventListener][] = [];

/** jsdom cannot mint trusted events; present them as trusted to the capture listeners only. */
function install() {
    window.addEventListener = ((type: string, listener: EventListener, options?: AddEventListenerOptions) => {
        const wrapped: EventListener = event => listener(new Proxy(event, {
            get(target, key) {
                if (key === 'isTrusted') return trusted;
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }));
        added.push([type, wrapped]);
        realAdd(type, wrapped, options);
    }) as typeof window.addEventListener;
    window.eval(buildBrowserDemoCaptureSource());
    window.addEventListener = realAdd as typeof window.addEventListener;
}

beforeEach(() => {
    sent = [];
    trusted = true;
    document.body.innerHTML = '';
    (window as unknown as Record<string, unknown>)[BROWSER_DEMO_BINDING] = (payload: string) => sent.push(JSON.parse(payload));
    install();
});

afterEach(() => {
    for (const [type, listener] of added.splice(0)) window.removeEventListener(type, listener, { capture: true });
    Reflect.deleteProperty(window, '__cocDemoInstalled');
    Reflect.deleteProperty(window, BROWSER_DEMO_BINDING);
});

function type(element: HTMLElement, value: string) {
    (element as HTMLInputElement).value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('browser demo capture script', () => {
    it('records a button click by its accessible label and role', () => {
        document.body.innerHTML = '<button aria-label="Create issue"><span>+</span></button>';
        document.querySelector('span')!.click();
        expect(sent).toEqual([expect.objectContaining({ kind: 'click', role: 'button', label: 'Create issue' })]);
        expect(sent[0].url).toBe(location.href);
    });

    it('ignores untrusted script-generated events', () => {
        trusted = false;
        document.body.innerHTML = '<button>Delete</button><input aria-label="Name">';
        document.querySelector('button')!.click();
        type(document.querySelector('input')!, 'x');
        document.querySelector('input')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        expect(sent).toEqual([]);
    });

    it('reports that a field was typed into without its value', () => {
        document.body.innerHTML = '<label for="q">Search</label><input id="q" placeholder="find">';
        const input = document.querySelector('input')!;
        type(input, 'my secret query');
        type(input, 'my secret query 2');
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        expect(sent).toEqual([expect.objectContaining({ kind: 'type', role: 'textbox', label: 'Search' })]);
        expect(JSON.stringify(sent)).not.toContain('secret');
    });

    it('never labels an editable field by its contents', () => {
        document.body.innerHTML = '<div contenteditable="true">typed private note</div><textarea>draft text</textarea>';
        const [editor, area] = [document.querySelector('div')!, document.querySelector('textarea')!];
        Object.defineProperty(editor, 'isContentEditable', { value: true });
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        type(area, 'draft text 2');
        area.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        expect(sent.map(item => item.kind)).toEqual(['type', 'type']);
        expect(JSON.stringify(sent)).not.toMatch(/private|draft/);
    });

    it('drops a wrapped control and its value from a label', () => {
        document.body.innerHTML = '<label>Email <input value="me@example.com"></label>';
        const input = document.querySelector('input')!;
        type(input, 'me@example.com');
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        expect(sent[0]).toMatchObject({ kind: 'type', label: 'Email' });
    });

    it('marks password and secret fields sensitive', () => {
        document.body.innerHTML = '<input type="password" aria-label="Password"><input name="api_token" aria-label="Key">';
        for (const input of document.querySelectorAll('input')) {
            type(input, 'hunter2');
            input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        }
        expect(sent).toEqual([expect.objectContaining({ sensitive: true }), expect.objectContaining({ sensitive: true })]);
        expect(JSON.stringify(sent)).not.toContain('hunter2');
    });

    it('records toggles with state, selects and files without values', () => {
        document.body.innerHTML = '<label><input type="checkbox"> Remember</label><select aria-label="Country"><option>Iceland</option></select><input type="file" aria-label="Upload">';
        const box = document.querySelector('input[type=checkbox]') as HTMLInputElement;
        document.querySelector('label')!.click();
        expect(box.checked).toBe(true);
        document.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('input[type=file]')!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(sent).toEqual([
            expect.objectContaining({ kind: 'toggle', role: 'checkbox', label: 'Remember', checked: true }),
            expect.objectContaining({ kind: 'select', role: 'combobox', label: 'Country' }),
            expect.objectContaining({ kind: 'file', label: 'Upload' }),
        ]);
        expect(JSON.stringify(sent)).not.toContain('Iceland');
    });

    it('flushes typing before Enter and form submit', () => {
        document.body.innerHTML = '<form aria-label="Login"><input aria-label="User"><button>Go</button></form>';
        const input = document.querySelector('input')!;
        type(input, 'alice');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        type(input, 'bob');
        document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
        expect(sent.map(item => item.kind)).toEqual(['type', 'key', 'type', 'submit']);
        expect(sent[3]).toMatchObject({ role: 'generic', label: 'Login' });
    });

    it('ignores plain keystrokes and clicks on non-interactive content', () => {
        document.body.innerHTML = '<p>Hello</p>';
        document.querySelector('p')!.click();
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        expect(sent).toEqual([]);
    });

    it('installs once per document', () => {
        window.eval(buildBrowserDemoCaptureSource());
        document.body.innerHTML = '<a href="#x">Next</a>';
        document.querySelector('a')!.click();
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ role: 'link', label: 'Next' });
    });
});

describe('demo redaction', () => {
    it('removes credentials, query values, token fragments and opaque path segments', () => {
        expect(redactDemoUrl('https://user:pw@example.com/a/b?q=secret&page=2#access_token=abc')).toBe('https://example.com/a/b?q=…&page=…');
        expect(redactDemoUrl('https://x.test/users/550e8400-e29b-41d4-a716-446655440000/files/1234567')).toBe('https://x.test/users/{id}/files/{id}');
        expect(redactDemoUrl('https://x.test/reset/aB3dE5fG7hJ9kL1mN3pQ5rS7tU9')).toBe('https://x.test/reset/{id}');
        expect(redactDemoUrl('https://x.test/u/me%40example.com')).toBe('https://x.test/u/{id}');
        expect(redactDemoUrl('https://app.test/#/inbox/settings')).toBe('https://app.test/#/inbox/settings');
        expect(redactDemoUrl('https://app.test/#/m/0123456789abcdef0123')).toBe('https://app.test/');
        expect(redactDemoUrl('file:///etc/passwd')).toBeUndefined();
        expect(redactDemoUrl('javascript:alert(1)')).toBeUndefined();
        expect(redactDemoUrl('not a url')).toBeUndefined();
    });

    it('hides emails, long numbers and token-like runs in labels', () => {
        expect(redactDemoText('Inbox (3) - alice@example.com')).toBe('Inbox (3) - [email]');
        expect(redactDemoText('Card 4111 1111 1111 1111')).toBe('Card [number]');
        expect(redactDemoText('key ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3')).toBe('key [token]');
        expect(redactDemoText('Save\n\tchanges')).toBe('Save changes');
        expect(redactDemoText('x'.repeat(500))).toHaveLength(120);
    });
});

describe('sanitizeDemoObservation', () => {
    const valid = { kind: 'click', role: 'button', label: 'Send to bob@corp.com', url: 'https://mail.test/c?id=9' };

    it('accepts a valid report and redacts its label and URL', () => {
        expect(sanitizeDemoObservation(JSON.stringify(valid))).toEqual({ kind: 'click', role: 'button', label: 'Send to [email]', url: 'https://mail.test/c?id=…' });
    });

    it('rejects malformed, oversized or unknown reports', () => {
        expect(sanitizeDemoObservation({})).toBeUndefined();
        expect(sanitizeDemoObservation('not json')).toBeUndefined();
        expect(sanitizeDemoObservation('[]')).toBeUndefined();
        expect(sanitizeDemoObservation(JSON.stringify({ ...valid, kind: 'screenshot' }))).toBeUndefined();
        expect(sanitizeDemoObservation(JSON.stringify({ ...valid, url: 'file:///x' }))).toBeUndefined();
        expect(sanitizeDemoObservation(JSON.stringify({ ...valid, label: 'x'.repeat(5000) }))).toBeUndefined();
        expect(sanitizeDemoObservation(JSON.stringify({ ...valid, kind: 'key', key: 'a' }))).toBeUndefined();
    });

    it('keeps only known fields and never passes a value through', () => {
        const action = sanitizeDemoObservation(JSON.stringify({ ...valid, kind: 'type', value: 'hunter2', role: '<script>', sensitive: true, checked: true }));
        expect(action).toEqual({ kind: 'type', role: 'generic', label: 'Send to [email]', url: 'https://mail.test/c?id=…', sensitive: true });
    });
});
