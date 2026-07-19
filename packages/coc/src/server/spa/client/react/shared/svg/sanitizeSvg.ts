import createDOMPurify from 'dompurify';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const URI_REFERENCE_ATTRIBUTES = new Set(['href', 'xlink:href', 'src']);
const CSS_VALUE_ATTRIBUTES = new Set([
    'clip-path',
    'color-profile',
    'cursor',
    'fill',
    'filter',
    'marker-end',
    'marker-mid',
    'marker-start',
    'mask',
    'stroke',
    'style',
]);

const SVG_EXTRA_TAGS = ['animate', 'set', 'use'];
const SMIL_ANIMATION_TAGS = new Set(['animate', 'animatecolor', 'animatemotion', 'animatetransform', 'set']);
const SMIL_VALUE_ATTRIBUTES = ['by', 'from', 'to', 'values'];
const SAFE_DATA_URI = /^data:image\/(?:avif|bmp|gif|jpeg|jpg|png|webp|x-icon);base64,[a-z0-9+/=\s]*$/i;

export type SvgSanitizationResult =
    | { ok: true; svg: string }
    | { ok: false; error: string };

function invalidSvg(): SvgSanitizationResult {
    return { ok: false, error: 'Invalid SVG: expected well-formed XML with a single <svg> root.' };
}

function parseSvg(source: string): SVGSVGElement | null {
    if (!source.trim() || /<!doctype/i.test(source)) {
        return null;
    }

    const parser = new DOMParser();
    let document = parser.parseFromString(source, 'image/svg+xml');
    if (document.querySelector('parsererror')) {
        return null;
    }

    let root = document.documentElement;
    if (root.localName.toLowerCase() !== 'svg') {
        return null;
    }
    if (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE) {
        return null;
    }

    // SVG snippets commonly omit xmlns. Normalize them into the SVG namespace
    // before DOMPurify checks element namespaces.
    if (!root.namespaceURI) {
        root.setAttribute('xmlns', SVG_NAMESPACE);
        document = parser.parseFromString(new XMLSerializer().serializeToString(root), 'image/svg+xml');
        if (document.querySelector('parsererror')) {
            return null;
        }
        root = document.documentElement;
    }

    return root as unknown as SVGSVGElement;
}

function compactCssForSecurityScan(value: string): string {
    const withoutComments = value.replace(/\/\*[\s\S]*?\*\//g, '');
    const decodedEscapes = withoutComments
        .replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?/gi, (_match, hex: string) => {
            const codePoint = Number.parseInt(hex, 16);
            if (!Number.isFinite(codePoint) || codePoint === 0 || codePoint > 0x10ffff) {
                return '\uFFFD';
            }
            return String.fromCodePoint(codePoint);
        })
        .replace(/\\([^\n\r\f])/g, '$1');

    return decodedEscapes.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
}

function compactReference(value: string): string {
    return value.replace(/[\u0000-\u0020\u007f]+/g, '');
}

function isSafeDataReference(value: string): boolean {
    return SAFE_DATA_URI.test(compactReference(value));
}

function isSafeCssReference(value: string): boolean {
    const compact = value.replace(/[\u0000-\u0020\u007f]+/g, '');
    return compact.startsWith('#') || SAFE_DATA_URI.test(compact);
}

function hasUnsafeCss(value: string): boolean {
    const compact = compactCssForSecurityScan(value);
    if (
        compact.includes('@import')
        || compact.includes('expression(')
        || compact.includes('javascript:')
        || compact.includes('vbscript:')
        || compact.includes('behavior:')
        || compact.includes('-moz-binding:')
        || compact.includes('image-set(')
    ) {
        return true;
    }

    let sawUrl = false;
    const urlPattern = /url\(([^)]*)\)/g;
    for (const match of compact.matchAll(urlPattern)) {
        sawUrl = true;
        const reference = match[1].replace(/^["']|["']$/g, '');
        if (!isSafeCssReference(reference)) {
            return true;
        }
    }

    return compact.includes('url(') && !sawUrl;
}

function removeUnsafeReferences(root: SVGSVGElement): void {
    const elements = [root, ...Array.from(root.querySelectorAll('*'))];

    for (const element of elements) {
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            const shouldRemove = name.startsWith('on')
                || (URI_REFERENCE_ATTRIBUTES.has(name) && !isSafeDataReference(attribute.value))
                || (CSS_VALUE_ATTRIBUTES.has(name) && hasUnsafeCss(attribute.value));

            if (shouldRemove) {
                element.removeAttributeNS(attribute.namespaceURI, attribute.localName);
            }
        }

        if (SMIL_ANIMATION_TAGS.has(element.localName.toLowerCase())) {
            const targetAttribute = element.getAttribute('attributeName')?.toLowerCase();
            const targetsExecutableAttribute = Boolean(
                targetAttribute
                && (targetAttribute.startsWith('on') || URI_REFERENCE_ATTRIBUTES.has(targetAttribute)),
            );
            const hasUnsafeValue = SMIL_VALUE_ATTRIBUTES.some((name) => {
                const value = element.getAttribute(name);
                return value !== null && hasUnsafeCss(value);
            });

            if (targetsExecutableAttribute || hasUnsafeValue) {
                element.remove();
            }
        }
    }

    for (const style of Array.from(root.querySelectorAll('style'))) {
        if (hasUnsafeCss(style.textContent ?? '')) {
            style.remove();
        }
    }
}

/**
 * Validates and sanitizes an SVG for inline client-side rendering.
 *
 * DOMPurify's SVG profile is the primary allow-list. The second pass only
 * tightens that output by removing network-capable references and unsafe CSS;
 * it never restores anything DOMPurify removed.
 */
export function sanitizeSvg(source: string): SvgSanitizationResult {
    const root = parseSvg(source);
    if (!root) {
        return invalidSvg();
    }

    try {
        const purifier = createDOMPurify(window);
        /* eslint-disable @typescript-eslint/naming-convention -- DOMPurify owns these configuration key names. */
        purifier.sanitize(root, {
            IN_PLACE: true,
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: SVG_EXTRA_TAGS,
            ADD_ATTR: ['from', 'to'],
            ADD_DATA_URI_TAGS: ['a', 'use'],
            FORBID_TAGS: ['script', 'foreignObject'],
            ADD_FORBID_CONTENTS: ['script', 'foreignObject'],
            ALLOW_UNKNOWN_PROTOCOLS: false,
            SAFE_FOR_XML: true,
            NAMESPACE: SVG_NAMESPACE,
        });
        /* eslint-enable @typescript-eslint/naming-convention */

        removeUnsafeReferences(root);
        return { ok: true, svg: new XMLSerializer().serializeToString(root) };
    } catch {
        return invalidSvg();
    }
}
