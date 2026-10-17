import { browserClipRect } from './browser-control-clip';

/** Serialized into the URL guest by browser-control-page. No host dependencies. */
export interface BrowserDomElement {
    ref: string;
    role: string;
    name: string;
    depth: number;
    checked?: boolean;
    frame?: string;
}

export interface BrowserDomSnapshot {
    title: string;
    url: string;
    elements: BrowserDomElement[];
    nextRef: number;
    visited?: number;
    consumed?: number;
    truncated?: string;
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
    visited?: number;
    consumed?: number;
    truncated?: string;
}

export interface BrowserDomTextMatch {
    found: boolean;
    visited: number;
    consumed: number;
    truncated?: string;
}

export interface BrowserDomTarget {
    x: number;
    y: number;
    width: number;
    height: number;
    optionSteps?: number;
    optionSearch?: { text: string; selected: boolean; count: number };
}

export interface BrowserDomScope {
    nodes: number;
    chars: number;
    refs: number;
    generation: string;
}

export type BrowserDomCommand = (
    | { action: 'snapshot'; ref?: string; all?: boolean; nextRef: number }
    | { action: 'snapshot-chunk'; token: number; offset: number }
    | { action: 'text'; text: string }
    | { action: 'read'; ref?: string; paged?: true; offset?: number; limit?: number }
    | { action: 'target'; ref: string; editable?: boolean; option?: string; resetTypeAhead?: true }
    | { action: 'hit'; ref: string; x: number; y: number }
    | { action: 'viewport' }
    | { action: 'focus' }
) & { scope?: BrowserDomScope };

/** Keep this function self-contained: its compiled source runs in either engine. */
function browserDom(command: BrowserDomCommand, clipRect: typeof browserClipRect): BrowserDomSnapshot | BrowserDomSnapshotChunk | BrowserDomReadPage | BrowserDomTextMatch | BrowserDomTarget | boolean | string {
    interface Registry {
        document: Document;
        url: string;
        refs: Map<string, Element>;
        ids: WeakMap<Element, string>;
        nextRef: number;
        generation?: string;
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
    if (registry.url !== location.href || registry.generation !== command.scope?.generation) {
        registry.refs.clear(); registry.ids = new WeakMap(); registry.url = location.href; registry.snapshot = undefined;
        registry.generation = command.scope?.generation;
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
        return command.scope ? null : element.ownerDocument.defaultView?.frameElement ?? null;
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
        let ancestors = 0;
        for (let node: Element | null = element; node; node = parent(node)) {
            if (command.scope && ++ancestors > 20000) return true;
            const style = node.ownerDocument.defaultView!.getComputedStyle(node);
            if (node.hasAttribute('hidden') || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true'
                || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
                || style.contentVisibility === 'hidden') return true;
        }
        return false;
    };
    const disabled = (element: Element) => {
        if (element.matches(':disabled')) return true;
        let ancestors = 0;
        for (let node: Element | null = element; node; node = parent(node)) {
            if (command.scope && ++ancestors > 20000) return true;
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
        const attribute = element.getAttribute('role');
        const explicit = clean(command.scope ? attribute?.slice(0, 160) : attribute).split(' ')[0];
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
    const viewport = (): BrowserDomTarget => ({
        x: 0, y: 0,
        width: document.documentElement.clientWidth || window.innerWidth,
        height: document.documentElement.clientHeight || window.innerHeight,
    });
    const hitElement = (element: Element, x: number, y: number): boolean => {
        const bounds = viewport();
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return false;
        let candidate = document.elementFromPoint?.(x, y);
        if (!candidate) return false;
        let visited = 0;
        while (candidate.shadowRoot?.elementFromPoint) {
            if (++visited > 20000) return false;
            const inner = candidate.shadowRoot.elementFromPoint(x, y);
            if (!inner || inner === candidate) break;
            candidate = inner;
        }
        for (let node: Element | null = candidate; node; node = parent(node)) {
            if (++visited > 20000) return false;
            if (node === element) return true;
        }
        return false;
    };
    if (command.action === 'hit') {
        if (!command.scope) throw new Error('Frame-scoped hit testing is disabled');
        const element = resolve(command.ref);
        return !hidden(element) && !disabled(element) && hitElement(element, command.x, command.y);
    }
    if (command.action === 'viewport') return viewport();
    if (command.action === 'focus') {
        const body = document.body ?? document.documentElement;
        const tabindex = body.getAttribute('tabindex');
        body.setAttribute('tabindex', '-1');
        try { body.focus({ preventScroll: true }); }
        finally {
            if (tabindex === null) body.removeAttribute('tabindex');
            else body.setAttribute('tabindex', tabindex);
        }
        return document.activeElement === body;
    }
    if (command.scope && (command.action === 'snapshot' || command.action === 'read' || command.action === 'text')) {
        const scope = command.scope;
        const bound = (value: number, maximum: number) => Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : 0;
        const nodeLimit = bound(scope.nodes, 20000);
        const charLimit = bound(scope.chars, 1000000);
        const refLimit = bound(scope.refs, 10000);
        let visited = 0;
        let consumed = 0;
        let truncated: string | undefined;
        const stop = (reason: string) => { truncated ??= reason; };
        const visit = () => {
            if (visited >= nodeLimit) { stop('node-limit'); return false; }
            visited++;
            return true;
        };
        const visibility = new Map<Element, boolean>();
        const disability = new Map<Element, boolean>();
        const isDisabled = (element: Element) => {
            if (element.matches(':disabled')) return true;
            const pending: Element[] = [];
            let result = false;
            for (let node: Element | null = element; node; node = parent(node)) {
                const cached = disability.get(node);
                if (cached !== undefined) { result = cached; break; }
                if (!visit()) { result = true; break; }
                pending.push(node);
                if (node.getAttribute('aria-disabled') === 'true') { result = true; break; }
            }
            for (const node of pending) disability.set(node, result);
            return result;
        };
        const visible = (element: Element) => {
            const pending: Element[] = [];
            let result = true;
            for (let node: Element | null = element; node; node = parent(node)) {
                const cached = visibility.get(node);
                if (cached !== undefined) { result = cached; break; }
                if (!visit()) { result = false; break; }
                pending.push(node);
                const style = node.ownerDocument.defaultView!.getComputedStyle(node);
                if (node.hasAttribute('hidden') || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true'
                    || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
                    || style.contentVisibility === 'hidden') { result = false; break; }
            }
            for (const node of pending) visibility.set(node, result);
            return result;
        };
        function* children(node: Node): Generator<Node> {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const element = node as Element;
            if (element.localName === 'iframe') return;
            if (element.localName === 'slot') {
                const host = (element.getRootNode() as ShadowRoot).host;
                let assigned = false;
                for (let child = host?.firstChild; child; child = child.nextSibling) {
                    if (!visit()) return;
                    if ((child as Element | Text).assignedSlot === element) { assigned = true; yield child; }
                }
                if (assigned) return;
            }
            for (let child = (element.shadowRoot ?? element).firstChild; child; child = child.nextSibling) yield child;
        }
        function* walk(root: Node, excludeControls = false, requireVisible = true): Generator<{ node: Node; depth: number; entering: boolean }> {
            const seen = new Set<Node>();
            const stack = [{ node: root, depth: 0, children: undefined as Generator<Node> | undefined }];
            while (stack.length) {
                const frame = stack[stack.length - 1];
                if (!frame.children) {
                    if (seen.has(frame.node) || !visit()) { stack.pop(); if (truncated) return; continue; }
                    seen.add(frame.node);
                    if (frame.node.nodeType === Node.ELEMENT_NODE) {
                        const element = frame.node as Element;
                        if (['script', 'style', 'noscript'].includes(element.localName)
                            || excludeControls && frame.node !== root && ['input', 'select', 'textarea', 'button'].includes(element.localName)
                            || requireVisible && !visible(element)) { stack.pop(); if (truncated) return; continue; }
                    }
                    frame.children = children(frame.node);
                    yield { node: frame.node, depth: frame.depth, entering: true };
                }
                const child = frame.children.next();
                if (truncated) return;
                if (!child.done) stack.push({ node: child.value, depth: frame.depth + 1, children: undefined });
                else { stack.pop(); yield { node: frame.node, depth: frame.depth, entering: false }; }
            }
        }
        const boundedText = (root: Node, maximum: number, excludeControls = false): string => {
            if (maximum <= 0) return '';
            let text = '';
            for (const item of walk(root, excludeControls, false)) {
                if (item.entering && item.node.nodeType === Node.TEXT_NODE) {
                    text += (item.node as Text).data.slice(0, maximum - text.length);
                    if (text.length >= maximum) break;
                }
            }
            return clean(text);
        };
        const boundedName = (element: Element): string => {
            const maximum = Math.min(160, charLimit - consumed);
            const label = (value: string | null | undefined) => clean(value?.slice(0, maximum));
            const root = element.getRootNode() as Document | ShadowRoot;
            const labelledBy = element.getAttribute('aria-labelledby')?.slice(0, 160);
            if (labelledBy) {
                let text = '';
                for (const id of labelledBy.split(/\s+/)) {
                    const target = root.getElementById(id);
                    if (target) text += `${text ? ' ' : ''}${boundedText(target, maximum - text.length)}`;
                    if (text.length >= maximum || truncated) break;
                }
                if (clean(text)) return label(text);
            }
            const aria = label(element.getAttribute('aria-label'));
            if (aria) return aria;
            const labels = (element as HTMLInputElement).labels;
            if (labels?.length) {
                let text = '';
                for (let index = 0; index < labels.length && text.length < maximum && !truncated; index++) {
                    text += `${text ? ' ' : ''}${boundedText(labels[index], maximum - text.length, true)}`;
                }
                return label(text);
            }
            if (element.localName === 'input') {
                const input = element as HTMLInputElement;
                return label(['button', 'submit', 'reset'].includes(input.type) ? input.value : input.alt || input.placeholder || input.title);
            }
            if (element.localName === 'img') return label(element.getAttribute('alt'));
            if (element.localName === 'select' || element.localName === 'textarea') return label(element.getAttribute('title') || element.getAttribute('placeholder'));
            return label(element.getAttribute('title')) || boundedText(element, maximum);
        };
        const root = 'ref' in command && command.ref ? resolve(command.ref) : document.body;
        if (command.action === 'snapshot') {
            const titleElement = document.head?.querySelector('title');
            const title = titleElement ? boundedText(titleElement, Math.min(160, Math.floor(charLimit / 4))) : '';
            const url = location.href.slice(0, Math.min(2048, Math.floor(charLimit / 4)));
            // Reserve transport metadata, metrics and a truncation reason before entries.
            const metadata = JSON.stringify({ title, url, elements: [], nextRef: registry.nextRef }).length + 128;
            consumed = metadata;
            if (metadata > charLimit) stop('char-limit');
            for (const [ref, element] of registry.refs) if (!current(element)) {
                registry.refs.delete(ref);
                registry.ids.delete(element);
            }
            while (registry.refs.size > refLimit) {
                const [ref, element] = registry.refs.entries().next().value!;
                registry.refs.delete(ref); registry.ids.delete(element);
            }
            const elements: BrowserDomElement[] = [];
            const interactive = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'slider', 'spinbutton', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem', 'option', 'heading']);
            const depths: number[] = [];
            if (root && !truncated) for (const item of walk(root)) {
                if (!item.entering || item.node.nodeType !== Node.ELEMENT_NODE) continue;
                const element = item.node as Element;
                const depth = item.depth ? depths[item.depth - 1] ?? 0 : 0;
                depths[item.depth] = depth;
                const elementRole = role(element);
                if (!element.getClientRects().length || !command.all && !interactive.has(elementRole) || isDisabled(element)) continue;
                let ref = registry.ids.get(element);
                if (!ref && registry.refs.size >= refLimit) { stop('ref-limit'); break; }
                ref ??= `e${registry.nextRef}`;
                const entry: BrowserDomElement = { ref, role: elementRole.slice(0, 160), name: boundedName(element), depth };
                if (elementRole === 'checkbox' || elementRole === 'radio' || elementRole === 'switch') {
                    entry.checked = element.getAttribute('aria-checked') === 'true' || (element as HTMLInputElement).checked === true;
                }
                const size = JSON.stringify(entry).length + (elements.length ? 1 : 0);
                if (size > charLimit - consumed) { stop('char-limit'); break; }
                if (!registry.ids.has(element)) registry.nextRef++;
                registry.ids.set(element, ref); registry.refs.set(ref, element);
                elements.push(entry); consumed += size;
                depths[item.depth] = depth + 1;
                if (truncated) break;
            }
            const result: BrowserDomSnapshot = {
                title, url,
                elements, nextRef: registry.nextRef, visited, consumed, ...(truncated ? { truncated } : {}),
            };
            const json = JSON.stringify(result);
            registry.snapshot = undefined;
            if (json.length <= snapshotChunkSize) return result;
            registry.snapshot = { token: ++registry.snapshotSequence, json, nextRef: registry.nextRef };
            return snapshotChunk(0);
        }
        const parts: string[] = [];
        const append = (value: string) => {
            const remaining = charLimit - consumed;
            if (value.length > remaining) stop('char-limit');
            const text = value.slice(0, remaining);
            if (text) { parts.push(text); consumed += text.length; }
        };
        let preDepth = 0;
        if (root) for (const item of walk(root)) {
            if (item.node.nodeType === Node.TEXT_NODE && item.entering) {
                const data = (item.node as Text).data;
                const remaining = charLimit - consumed;
                const piece = data.slice(0, remaining);
                append(command.action === 'text' || !preDepth ? piece.replace(/\s+/g, ' ') : piece);
                if (data.length > remaining) stop('char-limit');
                if (command.action === 'text') append(' ');
            } else if (item.node.nodeType === Node.ELEMENT_NODE && command.action === 'read') {
                const element = item.node as Element;
                const tag = element.localName;
                const entering = item.entering;
                if (tag === 'pre') { append(entering ? '\n\n```\n' : '\n```\n\n'); preDepth += entering ? 1 : -1; }
                else if (/^h[1-6]$/.test(tag)) append(entering ? `\n\n${'#'.repeat(Number(tag[1]))} ` : '\n\n');
                else if (tag === 'br' && entering) append('\n');
                else if (tag === 'li') append(entering ? '\n- ' : '\n');
                else if (['p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'table', 'tr'].includes(tag)) append('\n\n');
                else if (tag === 'strong' || tag === 'b') append('**');
                else if (tag === 'em' || tag === 'i') append('*');
                else if (tag === 'a') {
                    const attribute = element.getAttribute('href') ?? '';
                    if (attribute.length > charLimit - consumed) { stop('char-limit'); break; }
                    const href = (element as HTMLAnchorElement).href;
                    if (/^https?:/.test(href)) {
                        if (entering) append('[');
                        else { append(']('); append(href); append(')'); }
                    }
                }
            }
            if (truncated) break;
        }
        const text = parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (command.action === 'text') {
            if (command.text.length > charLimit) stop('char-limit');
            return {
                found: command.text.length <= charLimit && clean(text).includes(clean(command.text)), visited, consumed,
                ...(truncated ? { truncated } : {}),
            };
        }
        const offset = bound(command.offset ?? 0, 1000000);
        const limit = bound(command.limit ?? 8000, 8000);
        return command.paged ? {
            text: text.slice(offset, offset + limit), textTotal: text.length, visited, consumed,
            ...(truncated ? { truncated } : {}),
        } : text;
    }
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
        const select = element as HTMLSelectElement;
        const optionLimit = command.scope ? Math.max(0, Math.min(20000, Math.floor(command.scope.nodes))) : Infinity;
        if (select.options.length > optionLimit) throw new Error('Option work limit exceeded');
        const options = Array.from(select.options).filter(option => !option.disabled && !option.parentElement?.matches('optgroup[disabled]'));
        const index = options.findIndex(option => option.value === command.option);
        if (index < 0) throw new Error('Option value is missing or disabled');
        optionSteps = index;
        if (!select.multiple && select.size <= 1) {
            let text: string;
            if (command.scope) {
                const option = options[index];
                const attribute = option.getAttribute('label');
                if (attribute !== null) text = attribute.slice(0, 160).trimStart();
                else {
                    text = '';
                    let visited = 0;
                    for (let node = option.firstChild; node && text.length < 160;) {
                        if (++visited > optionLimit) throw new Error('Option work limit exceeded');
                        if (node.nodeType === Node.TEXT_NODE) text += (node as Text).data.slice(0, 160 - text.length);
                        if (node.firstChild) node = node.firstChild;
                        else {
                            while (node && !node.nextSibling && node.parentNode !== option) node = node.parentNode as ChildNode | null;
                            node = node?.nextSibling ?? null;
                        }
                    }
                    text = clean(text);
                }
            } else text = options[index].label.trimStart();
            optionSearch = { text, selected: options[index].selected, count: options.length };
        }
    }
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const frames: Element[] = [];
    for (let frame = command.scope ? null : element.ownerDocument.defaultView?.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement) {
        frame.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        frames.push(frame);
    }
    if (command.scope && (command.editable || command.option !== undefined)) {
        if (command.resetTypeAhead) (element as HTMLElement).blur();
        (element as HTMLElement).focus({ preventScroll: true });
        if (hidden(element) || disabled(element)) throw new Error('Element is hidden or disabled');
    }
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Element has no visible bounds');
    let { x, y, width, height } = rect;
    if (command.scope) {
        const clip = clipRect(element);
        const left = Math.max(clip.left, rect.left), top = Math.max(clip.top, rect.top);
        const right = Math.min(clip.right, rect.right), bottom = Math.min(clip.bottom, rect.bottom);
        if (!(right > left && bottom > top)) throw new Error('Element has no visible bounds');
        x = left; y = top; width = right - left; height = bottom - top;
        if (!hitElement(element, x + width / 2, y + height / 2)) {
            let found = false;
            for (let row = 0; row < 3 && !found; row++) for (let column = 0; column < 3; column++) {
                const cellX = left + column * (right - left) / 3;
                const cellY = top + row * (bottom - top) / 3;
                const cellWidth = (right - left) / 3;
                const cellHeight = (bottom - top) / 3;
                if (hitElement(element, cellX + cellWidth / 2, cellY + cellHeight / 2)) {
                    x = cellX; y = cellY; width = cellWidth; height = cellHeight;
                    found = true; break;
                }
            }
            if (!found) throw new Error('Element is obscured by another element');
        }
    }
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
    if (!command.scope && (command.editable || command.option !== undefined)) {
        if (command.resetTypeAhead) (element as HTMLElement).blur();
        // The first native click may activate a guest without focusing its field.
        (element as HTMLElement).focus();
    }
    return { x, y, width, height, ...(optionSteps === undefined ? {} : { optionSteps }), ...(optionSearch ? { optionSearch } : {}) };
}

export function buildBrowserDomExpression(command: BrowserDomCommand): string {
    return `(${browserDom.toString()})(${JSON.stringify(command)},(${browserClipRect.toString()}))`;
}
