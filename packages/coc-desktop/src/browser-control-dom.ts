/** Serialized into the URL guest by browser-control-page. No host dependencies. */
export interface BrowserDomElement {
    ref: string;
    role: string;
    name: string;
    depth: number;
    checked?: boolean;
}

export interface BrowserDomSnapshot {
    title: string;
    url: string;
    elements: BrowserDomElement[];
    nextRef: number;
}

export interface BrowserDomSnapshotChunk {
    chunk: string;
    token: number;
    offset: number;
    total: number;
    nextRef: number;
}

export interface BrowserDomReadPage {
    text: string;
    textTotal: number;
}

export interface BrowserDomTarget {
    x: number;
    y: number;
    width: number;
    height: number;
    optionSteps?: number;
    optionSearch?: { text: string; selected: boolean; count: number };
}

export type BrowserDomCommand =
    | { action: 'snapshot'; ref?: string; all?: boolean; nextRef: number }
    | { action: 'snapshot-chunk'; token: number; offset: number }
    | { action: 'text'; text: string }
    | { action: 'read'; ref?: string; paged?: true; offset?: number }
    | { action: 'target'; ref: string; editable?: boolean; option?: string; resetTypeAhead?: true };

/** Keep this function self-contained: its compiled source runs in either engine. */
function browserDom(command: BrowserDomCommand): BrowserDomSnapshot | BrowserDomSnapshotChunk | BrowserDomReadPage | BrowserDomTarget | boolean | string {
    interface Registry {
        document: Document;
        url: string;
        refs: Map<string, Element>;
        ids: WeakMap<Element, string>;
        nextRef: number;
        snapshotSequence: number;
        snapshot?: { token: number; json: string; nextRef: number };
    }
    const page = window as Window & { __cocBrowserControl?: Registry };
    let state = page.__cocBrowserControl;
    if (!state || state.document !== document) {
        state = { document, url: location.href, refs: new Map(), ids: new WeakMap(), nextRef: 1, snapshotSequence: 0 };
        Object.defineProperty(page, '__cocBrowserControl', { value: state, configurable: true });
        const owned = state;
        // BFCache restores this document and its globals; old refs must still expire.
        page.addEventListener('pagehide', () => { owned.refs.clear(); owned.ids = new WeakMap(); owned.snapshot = undefined; });
    }
    const registry = state;
    if (registry.url !== location.href) {
        registry.refs.clear(); registry.ids = new WeakMap(); registry.url = location.href; registry.snapshot = undefined;
    }
    if (command.action === 'snapshot') registry.nextRef = Math.max(registry.nextRef, command.nextRef);
    // JSON escaping can expand each character sixfold; stay below native's 900000-byte cap.
    const snapshotChunkSize = 64000;
    const snapshotChunk = (offset: number): BrowserDomSnapshotChunk => {
        const cached = registry.snapshot!;
        const result = { chunk: cached.json.slice(offset, offset + snapshotChunkSize), token: cached.token, offset, total: cached.json.length, nextRef: cached.nextRef };
        if (offset + result.chunk.length >= result.total) registry.snapshot = undefined;
        return result;
    };
    if (command.action === 'snapshot-chunk') {
        if (!registry.snapshot || command.token !== registry.snapshot.token) throw new Error('snapshot expired, re-snapshot');
        return snapshotChunk(command.offset);
    }
    const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
    const parent = (element: Element): Element | null => {
        if (element.parentElement) return element.parentElement;
        const root = element.getRootNode() as ShadowRoot;
        if (root.host) return root.host;
        return element.ownerDocument.defaultView?.frameElement ?? null;
    };
    const current = (element: Element): boolean => {
        if (!element.isConnected) return false;
        try {
            return element.ownerDocument.defaultView?.document === element.ownerDocument;
        } catch (error) {
            if (error instanceof DOMException && error.name === 'SecurityError') return false;
            throw error;
        }
    };
    const hidden = (element: Element): boolean => {
        for (let node: Element | null = element; node; node = parent(node)) {
            const style = node.ownerDocument.defaultView!.getComputedStyle(node);
            if (node.hasAttribute('hidden') || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true'
                || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
                || style.contentVisibility === 'hidden') return true;
        }
        return false;
    };
    const disabled = (element: Element) => {
        if (element.matches(':disabled')) return true;
        for (let node: Element | null = element; node; node = parent(node)) {
            if (node.getAttribute('aria-disabled') === 'true') return true;
        }
        return false;
    };
    const resolve = (ref: string): Element => {
        const element = registry.refs.get(ref);
        if (!element || !current(element)) throw new Error('stale ref, re-snapshot');
        return element;
    };
    const role = (element: Element): string => {
        const explicit = clean(element.getAttribute('role')).split(' ')[0];
        if (explicit) return explicit;
        const tag = element.localName;
        if (/^h[1-6]$/.test(tag)) return 'heading';
        if (tag === 'a' && element.hasAttribute('href')) return 'link';
        if (tag === 'button' || tag === 'summary') return 'button';
        if (tag === 'textarea' || element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') return 'textbox';
        if (tag === 'select') return (element as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
        if (tag === 'input') {
            const type = (element as HTMLInputElement).type;
            if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
            return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox' } as Record<string, string>)[type] ?? 'textbox';
        }
        return ({ img: 'img', nav: 'navigation', main: 'main', ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', th: 'columnheader', td: 'cell', iframe: 'iframe' } as Record<string, string>)[tag] ?? 'generic';
    };
    const name = (element: Element): string => {
        const root = element.getRootNode() as Document | ShadowRoot;
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const text = clean(labelledBy.split(/\s+/).map(id => root.getElementById(id)?.textContent ?? '').join(' '));
            if (text) return text;
        }
        const aria = clean(element.getAttribute('aria-label'));
        if (aria) return aria;
        const labels = (element as HTMLInputElement).labels;
        if (labels?.length) return clean(Array.from(labels, label => {
            const copy = label.cloneNode(true) as Element;
            for (const control of Array.from(copy.querySelectorAll('input,select,textarea,button'))) control.remove();
            return copy.textContent;
        }).join(' '));
        if (element.localName === 'input') {
            const input = element as HTMLInputElement;
            return clean(['button', 'submit', 'reset'].includes(input.type) ? input.value : input.alt || input.placeholder || input.title);
        }
        if (element.localName === 'img') return clean(element.getAttribute('alt'));
        if (element.localName === 'select' || element.localName === 'textarea') return clean(element.getAttribute('title') || element.getAttribute('placeholder'));
        return clean(element.getAttribute('title') || element.textContent);
    };

    if (command.action === 'text') {
        const parts: string[] = [];
        const seen = new Set<Node>();
        const text = (node: Node) => {
            if (seen.has(node)) return;
            seen.add(node);
            if (node.nodeType === Node.TEXT_NODE) { parts.push(node.textContent ?? ''); return; }
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (hidden(element) || ['script', 'style', 'noscript'].includes(element.localName)) return;
                if (element.localName === 'iframe') {
                    try {
                        const body = (element as HTMLIFrameElement).contentDocument?.body;
                        if (body) text(body);
                    } catch { /* Cross-origin frame. */ }
                }
                if (element.localName === 'slot') {
                    const assigned = (element as HTMLSlotElement).assignedNodes({ flatten: true });
                    if (assigned.length) { for (const child of assigned) text(child); return; }
                }
                for (const child of Array.from((element.shadowRoot ?? element).childNodes)) text(child);
            }
        };
        if (document.body) text(document.body);
        return clean(parts.join(' ')).includes(clean(command.text));
    }

    if (command.action === 'read') {
        const root = command.ref ? resolve(command.ref) : document.body;
        const seen = new Set<Node>();
        const markdown = (node: Node): string => {
            if (seen.has(node)) return '';
            seen.add(node);
            if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            const element = node as Element;
            const tag = element.localName;
            if (hidden(element) || ['script', 'style', 'noscript'].includes(tag)) return '';
            let children: Node[] = Array.from((element.shadowRoot ?? element).childNodes);
            if (tag === 'slot') {
                const assigned = (element as HTMLSlotElement).assignedNodes({ flatten: true });
                if (assigned.length) children = assigned;
            }
            if (tag === 'iframe') {
                try {
                    const body = (element as HTMLIFrameElement).contentDocument?.body;
                    if (body) children.push(body);
                } catch { /* Cross-origin frame stays opaque. */ }
            }
            const text = children.map(markdown).join('');
            if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${text.trim()}\n\n`;
            if (tag === 'a') {
                const href = (element as HTMLAnchorElement).href;
                return text.trim() && /^https?:/.test(href) ? `[${text.trim()}](${href})` : text;
            }
            if (tag === 'br') return '\n';
            if (tag === 'li') return `\n- ${text.trim()}`;
            if (tag === 'pre') return `\n\n\`\`\`\n${element.textContent ?? ''}\n\`\`\`\n\n`;
            if (['p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'table', 'tr'].includes(tag)) return `\n\n${text}\n\n`;
            if (tag === 'strong' || tag === 'b') return `**${text}**`;
            if (tag === 'em' || tag === 'i') return `*${text}*`;
            return text;
        };
        const text = root ? markdown(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
        return command.paged ? { text: text.slice(command.offset ?? 0, (command.offset ?? 0) + 8000), textTotal: text.length } : text;
    }

    if (command.action === 'snapshot') {
        for (const [ref, element] of registry.refs) if (!current(element)) registry.refs.delete(ref);
        const elements: BrowserDomElement[] = [];
        const seen = new Set<Element>();
        const interactive = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'slider', 'spinbutton', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem', 'option', 'heading']);
        const walk = (element: Element, depth: number) => {
            if (seen.has(element) || hidden(element)) return;
            seen.add(element);
            const elementRole = role(element);
            let childDepth = depth;
            if (!disabled(element) && element.getClientRects().length && (command.all || interactive.has(elementRole))) {
                let ref = registry.ids.get(element);
                if (!ref) { ref = `e${registry.nextRef++}`; registry.ids.set(element, ref); }
                registry.refs.set(ref, element);
                const entry: BrowserDomElement = { ref, role: elementRole, name: name(element), depth };
                if (elementRole === 'checkbox' || elementRole === 'radio' || elementRole === 'switch') {
                    entry.checked = element.getAttribute('aria-checked') === 'true' || (element as HTMLInputElement).checked === true;
                }
                elements.push(entry);
                childDepth++;
            }
            if (element.localName === 'iframe') {
                // Access may throw for cross-origin frames. They stay opaque.
                try {
                    const body = (element as HTMLIFrameElement).contentDocument?.body;
                    if (body) walk(body, childDepth);
                } catch { /* Cross-origin frame. */ }
            }
            if (element.localName === 'slot') {
                const assigned = (element as HTMLSlotElement).assignedElements({ flatten: true });
                if (assigned.length) { for (const child of assigned) walk(child, childDepth); return; }
            }
            for (const child of Array.from((element.shadowRoot ?? element).children)) walk(child, childDepth);
        };
        const root = command.ref ? resolve(command.ref) : document.body;
        if (root) walk(root, 0);
        const result = { title: document.title, url: location.href, elements, nextRef: registry.nextRef };
        const json = JSON.stringify(result);
        registry.snapshot = undefined;
        if (json.length <= snapshotChunkSize) return result;
        registry.snapshot = { token: ++registry.snapshotSequence, json, nextRef: registry.nextRef };
        return snapshotChunk(0);
    }

    const element = resolve(command.ref);
    if (hidden(element) || disabled(element)) throw new Error('Element is hidden or disabled');
    if (command.editable) {
        const input = element as HTMLInputElement;
        const textInput = element.localName === 'input' && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(input.type);
        if ((!textInput && element.localName !== 'textarea' && !(element as HTMLElement).isContentEditable)
            || input.readOnly) throw new Error('Element is not editable');
    }
    let optionSteps: number | undefined;
    let optionSearch: BrowserDomTarget['optionSearch'];
    if (command.option !== undefined) {
        if (element.localName !== 'select') throw new Error('Element is not a select');
        const options = Array.from((element as HTMLSelectElement).options).filter(option => !option.disabled && !option.parentElement?.matches('optgroup[disabled]'));
        const index = options.findIndex(option => option.value === command.option);
        if (index < 0) throw new Error('Option value is missing or disabled');
        optionSteps = index;
        const select = element as HTMLSelectElement;
        if (!select.multiple && select.size <= 1) {
            optionSearch = { text: options[index].label.trimStart(), selected: options[index].selected, count: options.length };
        }
    }
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const frames: Element[] = [];
    for (let frame = element.ownerDocument.defaultView?.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement) {
        frame.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        frames.push(frame);
    }
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Element has no visible bounds');
    let { x, y, width, height } = rect;
    for (const frame of frames) {
        const bounds = frame.getBoundingClientRect();
        const host = frame as HTMLElement;
        const scaleX = bounds.width / (host.offsetWidth || bounds.width);
        const scaleY = bounds.height / (host.offsetHeight || bounds.height);
        x = bounds.x + (host.clientLeft + x) * scaleX;
        y = bounds.y + (host.clientTop + y) * scaleY;
        width *= scaleX;
        height *= scaleY;
    }
    if (command.option !== undefined) {
        if (command.resetTypeAhead) (element as HTMLElement).blur();
        (element as HTMLElement).focus();
    }
    return { x, y, width, height, ...(optionSteps === undefined ? {} : { optionSteps }), ...(optionSearch ? { optionSearch } : {}) };
}

export function buildBrowserDomExpression(command: BrowserDomCommand): string {
    return `(${browserDom.toString()})(${JSON.stringify(command)})`;
}
