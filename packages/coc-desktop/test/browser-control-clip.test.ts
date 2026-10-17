// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserClipRect } from '../src/browser-control-clip';

afterEach(() => { vi.restoreAllMocks(); document.documentElement.removeAttribute('style'); document.body.removeAttribute('style'); document.body.replaceChildren(); });

describe('document-local clipping semantics', () => {
    it.each(['absolute', 'fixed'])('does not clip a %s descendant against a static wrapper outside its containing block', position => {
        document.body.innerHTML = `<div style="overflow:hidden;height:0"><iframe style="position:${position}"></iframe></div>`;
        const frame = document.querySelector('iframe')!;
        Object.defineProperty(frame, 'offsetParent', { configurable: true, value: null });
        expect(browserClipRect(frame)).toEqual({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    });

    it('retains containing-block and outer clips through nested positioned ancestors', () => {
        document.body.innerHTML = '<section style="overflow:hidden"><div style="position:relative;overflow:hidden;height:0"><span style="overflow:hidden"><iframe style="position:absolute"></iframe></span></div></section>';
        const frame = document.querySelector('iframe')!, block = document.querySelector('div')!;
        Object.defineProperty(frame, 'offsetParent', { configurable: true, get: () => block });
        expect(browserClipRect(frame).bottom).toBe(0);
        block.style.position = 'static';
        Object.defineProperty(frame, 'offsetParent', { configurable: true, value: null });
        expect(browserClipRect(frame).bottom).toBe(innerHeight);
    });

    it('tracks out-of-flow ancestors of an ordinary target', () => {
        document.body.innerHTML = '<div style="overflow:hidden;height:0"><section style="position:absolute"><button>Target</button></section></div>';
        const absolute = document.querySelector('section')!;
        Object.defineProperty(absolute, 'offsetParent', { value: null });
        expect(browserClipRect(document.querySelector('button')!).bottom).toBe(innerHeight);
    });

    it.each(['root', 'body'])('uses the viewport for propagated %s overflow despite a zero-height box', which => {
        document.documentElement.style.cssText = `overflow:${which === 'root' ? 'hidden' : 'visible'};contain:none`;
        document.body.style.cssText = `overflow:${which === 'body' ? 'hidden' : 'visible'};contain:none;height:0`;
        const frame = document.createElement('iframe');
        document.body.append(frame);
        expect(browserClipRect(frame)).toEqual({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    });

    it('clips to a real zero-height overflow container instead of treating it as the viewport', () => {
        document.body.innerHTML = '<div style="overflow:hidden"><iframe></iframe></div>';
        const container = document.querySelector('div')!;
        vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
            x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 20, width: 100, height: 0, toJSON() {},
        });
        Object.defineProperties(container, { offsetWidth: { value: 100 }, clientWidth: { value: 100 } });
        expect(browserClipRect(document.querySelector('iframe')!)).toMatchObject({ left: 10, top: 20, right: 110, bottom: 20 });
    });

    it('keeps body clipping when root overflow does not propagate from body', () => {
        document.documentElement.style.cssText = 'overflow:hidden;contain:none';
        document.body.style.cssText = 'overflow:hidden;contain:none;height:0';
        const frame = document.createElement('iframe');
        document.body.append(frame);
        expect(browserClipRect(frame).bottom).toBe(0);
    });
});
