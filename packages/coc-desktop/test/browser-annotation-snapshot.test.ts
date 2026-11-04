// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { browserAnnotationSnapshot } from '../src/browser-annotation-snapshot';

beforeEach(() => { document.body.innerHTML = ''; document.title = ''; });

function details(element: Element) { return browserAnnotationSnapshot(element).element!; }

describe('annotation selection metadata', () => {
    it('captures page and viewport details without element fields for an area', () => {
        document.title = 'Page title';
        expect(browserAnnotationSnapshot()).toEqual({ page: {
            url: location.href, title: 'Page title', viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        } });
    });

    it.each(['unique', '123:start', 'space in id', 'a"b[c]#d', 'emoji-🐈'])('escapes a unique ID selector: %s', id => {
        const target = document.createElement('button');
        target.id = id;
        document.body.append(target);
        const result = details(target);
        expect(document.querySelector(result.selector!)).toBe(target);
        expect(result.id).toBe(id);
        expect(result.shadowHosts).toEqual([]);
    });

    it('uses a unique structural path for duplicate IDs and identical siblings', () => {
        document.body.innerHTML = '<main><button id="duplicate"></button><button id="duplicate"></button></main><aside><button></button></aside>';
        const targets = document.querySelectorAll('button');
        for (const target of targets) {
            const selector = details(target).selector!;
            expect(document.querySelectorAll(selector)).toHaveLength(1);
            expect(document.querySelector(selector)).toBe(target);
        }
        const selector = details(targets[1]).selector;
        targets[1].textContent = 'Changed content';
        targets[1].className = 'changed';
        expect(details(targets[1]).selector).toBe(selector);
    });

    it('identifies nested open shadow hosts in outermost-first order', () => {
        const outer = document.createElement('div');
        outer.id = 'outer';
        document.body.append(outer);
        const first = outer.attachShadow({ mode: 'open' });
        const inner = document.createElement('section');
        inner.id = 'inner';
        first.append(inner);
        const second = inner.attachShadow({ mode: 'open' });
        const target = document.createElement('button');
        target.id = 'target';
        second.append(target);
        const result = details(target);
        expect(result.shadowHosts).toEqual(['#outer', '#inner']);
        expect(result.selector).toBe('#target');
        let scope: Document | ShadowRoot = document;
        for (const selector of result.shadowHosts) scope = scope.querySelector(selector!)!.shadowRoot!;
        expect(scope.querySelector(result.selector!)).toBe(target);
    });

    it('uses rendered text, bounds UTF-16 text length and UTF-8 HTML bytes without splitting characters', () => {
        document.body.innerHTML = '<div><script>hidden script text</script><span hidden>hidden label</span></div>';
        const target = document.body.firstElementChild!;
        Object.defineProperty(target, 'innerText', { value: `  ${'🐈'.repeat(400)}  ` });
        target.setAttribute('data-long', '🐈'.repeat(1000));
        const result = details(target);
        expect(result.text).toBe('🐈'.repeat(250));
        expect(Buffer.byteLength(result.outerHTML, 'utf8')).toBeLessThanOrEqual(2048);
        expect(result.outerHTML).not.toMatch(/[\uD800-\uDBFF]$/);
        expect(result.text).not.toContain('hidden');
    });

    it('does not fall back to hidden textContent when rendered text is unavailable', () => {
        const target = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        target.textContent = 'Unrendered text';
        document.body.append(target);
        expect(details(target).text).toBe('');
    });

    it('bounds ancillary metadata and explicitly marks selectors beyond its bounded search unavailable', () => {
        const target = document.createElement('div');
        target.id = 'i'.repeat(1000);
        target.className = Array.from({ length: 40 }, (_, i) => `${'c'.repeat(200)}${i}`).join(' ');
        document.title = 't'.repeat(1000);
        // Repeated nested tags force a path longer than the bounded search.
        let parent = document.body;
        for (let i = 0; i < 70; i++) {
            const next = document.createElement('div');
            parent.append(next, document.createElement('div'));
            parent = next;
        }
        parent.append(target, document.createElement('div'));
        const result = details(target);
        expect(result.selector).toBeNull();
        expect(result.id).toHaveLength(500);
        expect(result.classes).toHaveLength(32);
        expect(result.classes.every(value => value.length === 128)).toBe(true);
        expect(browserAnnotationSnapshot().page.title).toHaveLength(500);
    });
});
