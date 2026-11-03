export interface BrowserAnnotationPageSnapshot {
    url: string;
    title: string;
    viewport: { width: number; height: number; devicePixelRatio: number };
}

export interface BrowserAnnotationElementSnapshot {
    /** Selector within the element's document or open shadow root; null when no bounded unique path exists. */
    selector: string | null;
    /** Outermost first: select each host, enter its open shadow root, then use selector. */
    shadowHosts: (string | null)[];
    tag: string;
    id: string;
    classes: string[];
    text: string;
    outerHTML: string;
}

/** Serialized into the isolated world; keep every dependency inside this function. */
export function browserAnnotationSnapshot(element?: Element): {
    page: BrowserAnnotationPageSnapshot;
    element?: BrowserAnnotationElementSnapshot;
} {
    const bounded = (value: string, limit: number, bytes = false): string => {
        let result = '', size = 0;
        for (const character of value) {
            const code = character.codePointAt(0)!;
            const length = bytes ? code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4 : character.length;
            if (size + length > limit) break;
            result += character;
            size += length;
        }
        return result;
    };
    // Hex escapes also handle leading digits, punctuation and control characters without CSS.escape globals.
    const escape = (value: string) => Array.from(value, character => /[a-zA-Z_-]/.test(character)
        ? character : `\\${character.codePointAt(0)!.toString(16)} `).join('');
    const selectorFor = (target: Element): string | null => {
        const root = target.getRootNode() as Document | ShadowRoot;
        const unique = (selector: string) => {
            try { const matches = root.querySelectorAll(selector); return matches.length === 1 && matches[0] === target; }
            catch { return false; }
        };
        const parts: string[] = [];
        let current: Element | null = target;
        for (let depth = 0; current && depth < 64; depth++, current = current.parentElement) {
            if (current.id && current.id.length <= 256) {
                const candidate = [`#${escape(current.id)}`, ...parts].join(' > ');
                if (candidate.length <= 2048 && unique(candidate)) return candidate;
            }
            const siblings: Element[] = current.parentElement ? Array.from(current.parentElement.children) : Array.from(root.children);
            const sameTag = siblings.filter(sibling => sibling.localName === current!.localName && sibling.namespaceURI === current!.namespaceURI);
            parts.unshift(`${escape(current.localName)}:nth-of-type(${sameTag.indexOf(current) + 1})`);
            const candidate = parts.join(' > ');
            if (candidate.length > 2048) return null;
            if (unique(candidate)) return candidate;
        }
        return null;
    };
    const page: BrowserAnnotationPageSnapshot = {
        url: location.href,
        title: bounded(document.title, 500),
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    };
    if (!element) return { page };
    const shadowHosts: (string | null)[] = [];
    let root = element.getRootNode();
    while (root instanceof ShadowRoot) {
        shadowHosts.unshift(selectorFor(root.host));
        root = root.host.getRootNode();
    }
    return { page, element: {
        selector: selectorFor(element), shadowHosts,
        tag: element.localName,
        id: bounded(element.id, 500),
        classes: Array.from(element.classList).slice(0, 32).map(value => bounded(value, 128)),
        // innerText supplies rendered text, avoiding hidden/script text from textContent.
        text: bounded(('innerText' in element && typeof element.innerText === 'string' ? element.innerText : '').trim(), 500),
        outerHTML: bounded(element.outerHTML.trim(), 2048, true),
    } };
}
