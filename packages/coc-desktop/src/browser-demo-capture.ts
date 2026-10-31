/**
 * Task demonstration capture. The page script runs in a private isolated world and queues
 * trusted user actions in that world, where main drains them with `Runtime.evaluate`; page
 * scripts cannot see or feed the queue, and it never reads typed values. Everything it hands
 * over is untrusted until `sanitizeDemoObservation` accepts it in main.
 */

export const BROWSER_DEMO_WORLD = 'coc-demo-recorder';
export const BROWSER_DEMO_DRAIN = '__cocDemoDrain';
/** Pending reports per document between drains; the rest are counted as dropped. */
export const BROWSER_DEMO_QUEUE_LIMIT = 100;

/** What one drain returns from a document's isolated world. */
export interface BrowserDemoDrain {
    /** Random per-document id, so main can tell a fresh document from one it already drained. */
    doc: string;
    items: string[];
    dropped: number;
}

export type BrowserDemoActionKind = 'click' | 'type' | 'toggle' | 'select' | 'file' | 'submit' | 'key';

/** One page report as the capture script builds it. */
export interface BrowserDemoObservation {
    kind: BrowserDemoActionKind;
    role: string;
    label: string;
    /** The field is a password, one-time code, payment or secret field. */
    sensitive?: boolean;
    checked?: boolean;
    key?: 'Enter' | 'Escape' | 'Tab';
    /** The main frame's document URL when the action happened. */
    url: string;
}

/** Keep this function self-contained: its compiled source runs inside the URL guest. */
function browserDemoCapture(drain: string, limit: number): void {
    const scope = window as unknown as Record<string, unknown>;
    if (scope.__cocDemoInstalled) return;
    scope.__cocDemoInstalled = true;
    const queue: string[] = [];
    let dropped = 0;
    let active = true;
    const doc = Math.random().toString(36).slice(2, 12);
    scope[drain] = (enabled?: boolean): BrowserDemoDrain => {
        if (typeof enabled === 'boolean' && active !== enabled) {
            active = enabled;
            dirty = new WeakSet<Element>();
        }
        const result = { doc, items: queue.splice(0), dropped };
        dropped = 0;
        return result;
    };
    const send = (payload: string) => {
        if (!active) return;
        if (queue.length < limit) queue.push(payload); else dropped++;
    };
    let dirty = new WeakSet<Element>();
    const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const editable = (element: Element): boolean => {
        if (element.localName === 'textarea') return true;
        if ((element as HTMLElement).isContentEditable) return true;
        return element.localName === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden'].includes((element as HTMLInputElement).type);
    };
    const sensitive = (element: Element): boolean => {
        const input = element as HTMLInputElement;
        if (input.type === 'password') return true;
        const hints = [element.getAttribute('autocomplete'), element.getAttribute('name'), element.id, element.getAttribute('aria-label')].join(' ');
        return /pass|token|secret|otp|one-time|\bpin\b|cvv|cvc|cc-|card|ssn|api.?key|auth/i.test(hints);
    };
    const textOf = (element: Element): string => {
        // Labels may wrap their control; never read a control's own text.
        if (element.closest('input,select,textarea,[contenteditable]')) return '';
        const copy = element.cloneNode(true) as Element;
        for (const control of Array.from(copy.querySelectorAll('input,select,textarea,[contenteditable]'))) control.remove();
        return clean(copy.textContent);
    };
    const label = (element: Element): string => {
        const root = element.getRootNode() as Document | ShadowRoot;
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const text = clean(labelledBy.split(/\s+/).slice(0, 4).map(id => {
                const target = root.getElementById?.(id);
                return target ? textOf(target) : '';
            }).join(' '));
            if (text) return text;
        }
        const aria = clean(element.getAttribute('aria-label'));
        if (aria) return aria;
        const labels = (element as HTMLInputElement).labels;
        if (labels?.length) return clean(Array.from(labels, textOf).join(' '));
        if (element.localName === 'input') {
            const input = element as HTMLInputElement;
            return clean(['button', 'submit', 'reset'].includes(input.type) ? input.value : input.alt || input.placeholder || input.title);
        }
        if (element.localName === 'img') return clean(element.getAttribute('alt'));
        if (editable(element) || element.localName === 'select') return clean(element.getAttribute('placeholder') || element.getAttribute('title'));
        return clean(element.getAttribute('title')) || textOf(element);
    };
    const role = (element: Element): string => {
        const explicit = element.getAttribute('role');
        if (explicit) return clean(explicit.split(/\s+/)[0]);
        const input = element as HTMLInputElement;
        if (element.localName === 'a') return 'link';
        if (element.localName === 'button' || element.localName === 'summary' || element.localName === 'input' && ['button', 'submit', 'reset', 'image'].includes(input.type)) return 'button';
        if (element.localName === 'input' && ['checkbox', 'radio'].includes(input.type)) return input.type;
        if (element.localName === 'select') return 'combobox';
        if (editable(element)) return 'textbox';
        return element.localName === 'label' ? 'label' : 'generic';
    };
    const interactive = 'a[href],button,input,select,textarea,summary,label,[contenteditable=""],[contenteditable="true"],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch],[role=treeitem],[role=combobox],[onclick]';
    const target = (event: Event): Element | null => {
        const origin = event.composedPath()[0];
        return origin instanceof Element ? origin.closest(interactive) : null;
    };
    const report = (kind: BrowserDemoActionKind, element: Element, extra: Partial<BrowserDemoObservation> = {}) => {
        const observation: BrowserDemoObservation = { kind, role: role(element), label: label(element), url: location.href, ...extra };
        if (sensitive(element)) observation.sensitive = true;
        send(JSON.stringify(observation));
    };
    const flush = (element: Element) => {
        dirty.delete(element);
    };
    const options = { capture: true, passive: true };
    window.addEventListener('input', event => {
        const element = event.composedPath()[0];
        if (active && event.isTrusted && element instanceof Element && editable(element) && !dirty.has(element)) {
            dirty.add(element);
            report('type', element);
        }
    }, options);
    window.addEventListener('focusout', event => {
        const element = event.composedPath()[0];
        if (event.isTrusted && element instanceof Element) flush(element);
    }, options);
    window.addEventListener('click', event => {
        if (!event.isTrusted) return;
        const element = target(event);
        // Fields, toggles and selects report through input/change instead.
        // A label click reports through the control it activates.
        if (!element || editable(element) || element.localName === 'select' || (element as HTMLLabelElement).control
            || element.localName === 'input' && ['checkbox', 'radio', 'file'].includes((element as HTMLInputElement).type)) return;
        report('click', element);
    }, options);
    window.addEventListener('change', event => {
        const element = event.composedPath()[0];
        if (!event.isTrusted || !(element instanceof Element)) return;
        const input = element as HTMLInputElement;
        if (element.localName === 'select') report('select', element);
        else if (element.localName === 'input' && ['checkbox', 'radio'].includes(input.type)) report('toggle', element, { checked: input.checked });
        else if (element.localName === 'input' && input.type === 'file') report('file', element);
    }, options);
    window.addEventListener('keydown', event => {
        const element = event.composedPath()[0];
        if (!event.isTrusted || !(element instanceof Element) || !['Enter', 'Escape', 'Tab'].includes(event.key)) return;
        if (event.key === 'Tab' && !editable(element)) return;
        flush(element);
        if (event.key !== 'Tab') report('key', element, { key: event.key as BrowserDemoObservation['key'] });
    }, options);
    window.addEventListener('submit', event => {
        const form = event.target;
        if (!event.isTrusted || !(form instanceof HTMLFormElement)) return;
        for (const element of Array.from(form.elements)) flush(element);
        report('submit', form);
    }, options);
}

export function buildBrowserDemoCaptureSource(): string {
    return `(${browserDemoCapture.toString()})(${JSON.stringify(BROWSER_DEMO_DRAIN)}, ${BROWSER_DEMO_QUEUE_LIMIT})`;
}

const KINDS = new Set<BrowserDemoActionKind>(['click', 'type', 'toggle', 'select', 'file', 'submit', 'key']);
const ROLES = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab',
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'label', 'generic']);
const MAX_LABEL = 120;
const KNOWN_CREDENTIAL = /\b(?:(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/;

/** Hide identifiers a label, title or URL could carry: emails, long numbers and token-like runs. */
export function redactDemoText(value: string, maximum = MAX_LABEL): string {
    return value.replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g, '[email]')
        .replace(new RegExp(KNOWN_CREDENTIAL.source, 'g'), '[token]')
        .replace(/\+?\d[\d -]{6,}\d/g, '[number]')
        .replace(/\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{24,}\b/g, '[token]')
        .replace(/\s+/g, ' ').trim().slice(0, maximum);
}

const SECRET_SEGMENT = /^(?:[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=.*\d)[A-Za-z0-9_\-]{24,}|\d{6,})$/i;

/**
 * Credential-free URL: no user info, query values or fragment parameters, and opaque path
 * segments become `{id}`. Parameter names stay so the step still says what the page was.
 */
export function redactDemoUrl(value: string): string | undefined {
    let url: URL;
    try { url = new URL(value); } catch { return undefined; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const path = url.pathname.split('/').map(segment => {
        let decoded = segment;
        try { decoded = decodeURIComponent(segment); } catch { /* keep the raw segment */ }
        return SECRET_SEGMENT.test(decoded) || KNOWN_CREDENTIAL.test(decoded) || /@/.test(decoded) ? '{id}' : segment;
    }).join('/');
    const names = [...new Set([...url.searchParams.keys()])].slice(0, 12).map(name => encodeURIComponent(redactDemoText(name, 40)));
    const query = names.length ? `?${names.map(name => `${name}=…`).join('&')}` : '';
    // Client routes (#/inbox) are page context; anything with parameters may be a token.
    const hash = /^#\/[\w\-/.]*$/.test(url.hash) && !url.hash.split('/').some(segment => SECRET_SEGMENT.test(segment) || KNOWN_CREDENTIAL.test(segment)) ? url.hash : '';
    const host = url.host.split('.').map(part => SECRET_SEGMENT.test(part) || KNOWN_CREDENTIAL.test(part) ? 'redacted' : part).join('.');
    return `${url.protocol}//${host}${path}${query}${hash}`.slice(0, 400);
}

export interface BrowserDemoAction {
    kind: BrowserDemoActionKind;
    role: string;
    label: string;
    url: string;
    sensitive?: true;
    checked?: boolean;
    key?: 'Enter' | 'Escape' | 'Tab';
}

/** Validate and redact one queued payload; `undefined` drops it. */
export function sanitizeDemoObservation(payload: unknown): BrowserDemoAction | undefined {
    if (typeof payload !== 'string' || payload.length > 4096) return undefined;
    let raw: unknown;
    try { raw = JSON.parse(payload); } catch { return undefined; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const value = raw as Record<string, unknown>;
    if (typeof value.kind !== 'string' || !KINDS.has(value.kind as BrowserDemoActionKind)) return undefined;
    const url = typeof value.url === 'string' ? redactDemoUrl(value.url) : undefined;
    if (!url) return undefined;
    const sensitive = value.sensitive === true;
    const role = typeof value.role === 'string' && ROLES.has(value.role) ? value.role : 'generic';
    const label = typeof value.label === 'string' ? redactDemoText(value.label) : '';
    const action: BrowserDemoAction = { kind: value.kind as BrowserDemoActionKind, role, label, url };
    if (sensitive) action.sensitive = true;
    if (typeof value.checked === 'boolean' && action.kind === 'toggle') action.checked = value.checked;
    if (action.kind === 'key') {
        if (value.key !== 'Enter' && value.key !== 'Escape' && value.key !== 'Tab') return undefined;
        action.key = value.key;
    }
    return action;
}
