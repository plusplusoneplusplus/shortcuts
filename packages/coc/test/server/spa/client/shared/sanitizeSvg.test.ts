/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
    sanitizeSvg,
    type SvgSanitizationResult,
} from '../../../../../src/server/spa/client/react/shared/svg/sanitizeSvg';

function expectSanitized(result: SvgSanitizationResult): Document {
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const document = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    return document;
}

describe('sanitizeSvg', () => {
    it('removes scripts while preserving neighboring SVG content', () => {
        const document = expectSanitized(sanitizeSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <script>alert('owned')</script>
                <rect id="safe-shape" width="10" height="10" />
            </svg>
        `));

        expect(document.querySelector('script')).toBeNull();
        expect(document.getElementById('safe-shape')).not.toBeNull();
        expect(document.documentElement.textContent).not.toContain('owned');
    });

    it('removes every event-handler attribute', () => {
        const document = expectSanitized(sanitizeSvg(`
            <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
                <rect id="event-target" onclick="alert(2)" onpointerenter="alert(3)" />
            </svg>
        `));

        const root = document.documentElement;
        const target = document.getElementById('event-target');
        expect(root.hasAttribute('onload')).toBe(false);
        expect(target?.hasAttribute('onclick')).toBe(false);
        expect(target?.hasAttribute('onpointerenter')).toBe(false);
    });

    it('strips foreignObject and all of its contents', () => {
        const document = expectSanitized(sanitizeSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script>owned</div></foreignObject>
                <circle id="safe-circle" r="4" />
            </svg>
        `));

        expect(document.querySelector('foreignObject')).toBeNull();
        expect(document.querySelector('script')).toBeNull();
        expect(document.documentElement.textContent).not.toContain('owned');
        expect(document.getElementById('safe-circle')).not.toBeNull();
    });

    it('removes HTTP, protocol-relative, relative, and script-bearing references', () => {
        const document = expectSanitized(sanitizeSvg(`
            <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                <image id="http" href="https://evil.example/x.png" />
                <use id="protocol-relative" xlink:href="//evil.example/icon.svg#x" />
                <image id="relative" src="./tracking-pixel.png" />
                <a id="javascript" href="jav&#x61;script:alert(1)"><text>click</text></a>
                <a id="script-data" href="data:text/html;base64,PHNjcmlwdD4="><text>data</text></a>
            </svg>
        `));

        expect(document.getElementById('http')?.hasAttribute('href')).toBe(false);
        expect(document.getElementById('protocol-relative')?.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(false);
        expect(document.getElementById('relative')?.hasAttribute('src')).toBe(false);
        expect(document.getElementById('javascript')?.hasAttribute('href')).toBe(false);
        expect(document.getElementById('script-data')?.hasAttribute('href')).toBe(false);
    });

    it('allows only inert raster data URIs in direct reference attributes', () => {
        const document = expectSanitized(sanitizeSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <defs><path id="shape" d="M0 0h10v10z" /></defs>
                <use id="instance" href="#shape" />
                <image id="embedded" href="data:image/png;base64,iVBORw0KGgo=" />
                <a id="embedded-link" href="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA=="><text>image</text></a>
            </svg>
        `));

        expect(document.getElementById('instance')?.hasAttribute('href')).toBe(false);
        expect(document.getElementById('embedded')?.getAttribute('href')).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(document.getElementById('embedded-link')?.getAttribute('href')).toBe('data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==');
    });

    it('removes CSS that can load or execute content', () => {
        const document = expectSanitized(sanitizeSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <style>@import url(https://evil.example/theme.css); .safe { fill: red; }</style>
                <rect id="external" style="fill: u\\72l(//evil.example/pixel)" />
                <circle id="script" fill="url(javascript:alert(1))" />
            </svg>
        `));

        expect(document.querySelector('style')).toBeNull();
        expect(document.getElementById('external')?.hasAttribute('style')).toBe(false);
        expect(document.getElementById('script')?.hasAttribute('fill')).toBe(false);
    });

    it('removes SMIL animations that can mutate resource-bearing attributes or values', () => {
        const document = expectSanitized(sanitizeSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <rect id="target" width="10" height="10">
                    <animate id="remote-fill" attributeName="fill" values="red;url(https://evil.example/pixel);blue" />
                    <set id="remote-source" attributeName="src" to="https://evil.example/pixel" />
                    <animate id="safe-opacity" attributeName="opacity" values="0;1" />
                </rect>
            </svg>
        `));

        expect(document.getElementById('remote-fill')).toBeNull();
        expect(document.getElementById('remote-source')).toBeNull();
        expect(document.getElementById('safe-opacity')).not.toBeNull();
    });

    it('preserves benign styles, gradients, shapes, text, and SMIL animation', () => {
        const document = expectSanitized(sanitizeSvg(`
            <svg viewBox="0 0 100 100">
                <style>
                    @keyframes pulse { from { opacity: .4; } to { opacity: 1; } }
                    .pulse { fill: url(#paint); animation: pulse 2s infinite; }
                </style>
                <defs>
                    <linearGradient id="paint"><stop offset="0" stop-color="#f00" /><stop offset="1" stop-color="#00f" /></linearGradient>
                </defs>
                <path id="animated" class="pulse" d="M0 0h20v20z">
                    <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
                    <animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="4s" repeatCount="indefinite" />
                </path>
                <text id="label" x="4" y="40">Safe SVG</text>
            </svg>
        `));

        const style = document.querySelector('style');
        expect(style?.textContent).toContain('@keyframes pulse');
        expect(style?.textContent).toContain('animation: pulse 2s infinite');
        expect(document.getElementsByTagName('linearGradient')).toHaveLength(1);
        expect(document.getElementById('animated')).not.toBeNull();
        const animate = document.getElementsByTagName('animate')[0];
        expect(animate?.getAttribute('attributeName')).toBe('opacity');
        expect(animate?.getAttribute('values')).toBe('0.4;1;0.4');
        expect(animate?.getAttribute('dur')).toBe('2s');
        expect(animate?.getAttribute('repeatCount')).toBe('indefinite');
        const animateTransform = document.getElementsByTagName('animateTransform')[0];
        expect(animateTransform?.getAttribute('attributeName')).toBe('transform');
        expect(animateTransform?.getAttribute('type')).toBe('rotate');
        expect(animateTransform?.getAttribute('from')).toBe('0 10 10');
        expect(animateTransform?.getAttribute('to')).toBe('360 10 10');
        expect(animateTransform?.getAttribute('dur')).toBe('4s');
        expect(animateTransform?.getAttribute('repeatCount')).toBe('indefinite');
        expect(document.getElementById('label')?.textContent).toBe('Safe SVG');
    });

    it('rejects malformed or non-SVG input', () => {
        const malformed = sanitizeSvg('<svg><path></svg>');
        const wrongRoot = sanitizeSvg('<div>not svg</div>');

        expect(malformed).toEqual({
            ok: false,
            error: 'Invalid SVG: expected well-formed XML with a single <svg> root.',
        });
        expect(wrongRoot.ok).toBe(false);
    });
});
