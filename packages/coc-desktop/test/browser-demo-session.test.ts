import { describe, expect, it } from 'vitest';
import { BROWSER_DEMO_LIMITS, BrowserDemoSession } from '../src/browser-demo-session';
import type { BrowserDemoAction } from '../src/browser-demo-capture';

const owner = { workspaceId: 'ws-a', processId: 'chat-1', routingRef: 'local' };
const click: BrowserDemoAction = { kind: 'click', role: 'button', label: 'Go', url: 'https://a.test/' };

function session(clock = { now: 0 }) {
    return new BrowserDemoSession('demo-1', owner, () => clock.now);
}

describe('BrowserDemoSession', () => {
    it('bounds lifecycle gaps as well as actions, retaining one terminal limit marker', () => {
        const demo = session();
        demo.addTab('root', { url: 'https://fixture.test/', title: 'Fixture' });
        for (let index = 0; index < BROWSER_DEMO_LIMITS.steps * 2; index++) {
            demo.pause();
            demo.resume();
        }
        expect(demo.snapshot().steps).toHaveLength(BROWSER_DEMO_LIMITS.steps + 1);
        expect(demo.snapshot().steps.at(-1)).toMatchObject({ type: 'gap', reason: 'step-limit' });
        expect(demo.snapshot().incomplete).toBe(true);
    });
    it('tracks recursive descendants with opener lineage and ignores unrelated tabs', () => {
        const demo = session();
        expect(demo.addTab('root', { url: 'https://a.test/?t=secret', title: 'A' })).toBe(true);
        expect(demo.addTab('child', { url: 'https://b.test/', title: 'B' }, 'root')).toBe(true);
        expect(demo.addTab('grandchild', { url: 'https://c.test/', title: 'C' }, 'child')).toBe(true);
        expect(demo.addTab('stranger', { url: 'https://d.test/', title: 'D' }, 'unrelated')).toBe(false);
        demo.action('stranger', click);
        const snap = demo.snapshot();
        expect(snap.tabs.map(tab => [tab.viewId, tab.index, tab.openerViewId])).toEqual([['root', 1, undefined], ['child', 2, 'root'], ['grandchild', 3, 'child']]);
        expect(snap.tabs[0].url).toBe('https://a.test/?t=…');
        expect(snap.steps.every(step => step.viewId !== 'stranger')).toBe(true);
    });

    it('records switches between captured tabs only', () => {
        const demo = session();
        demo.addTab('root', { url: 'https://a.test/', title: 'A' });
        demo.addTab('child', { url: 'https://b.test/', title: 'B' }, 'root');
        demo.switchTo('child');
        demo.switchTo('child');
        demo.switchTo('other');
        demo.switchTo('root');
        expect(demo.snapshot().steps.filter(step => step.type === 'switch').map(step => step.viewId)).toEqual(['child', 'root']);
    });

    it('records navigations once per URL change and stops capturing closed tabs', () => {
        const demo = session();
        demo.addTab('root', { url: 'https://a.test/', title: 'A' });
        demo.navigated('root', { url: 'https://a.test/next', title: 'Next for bob@x.io' });
        demo.navigated('root', { url: 'https://a.test/next', title: 'Next' });
        demo.closeTab('root');
        demo.action('root', click);
        demo.navigated('root', { url: 'https://a.test/again', title: '' });
        expect(demo.snapshot().steps.map(step => step.type)).toEqual(['tab-opened', 'navigate', 'tab-closed']);
        expect(demo.snapshot().steps[1]).toMatchObject({ title: 'Next for [email]' });
        expect(demo.addTab('late', { url: 'https://b.test/', title: '' }, 'root')).toBe(true);
        expect(demo.snapshot().tabs[1]).toMatchObject({ viewId: 'late', openerViewId: 'root' });
        expect(demo.hasTab('root')).toBe(false);
        expect(demo.addTab('unknown', { url: 'https://c.test/', title: '' }, 'stranger')).toBe(false);
    });

    it('drops actions while paused and marks the pause as a gap', () => {
        const demo = session();
        demo.addTab('root', { url: 'https://a.test/', title: 'A' });
        demo.pause();
        demo.action('root', click);
        demo.resume();
        demo.action('root', click);
        const snap = demo.snapshot();
        expect(snap.steps.map(step => step.type)).toEqual(['tab-opened', 'gap', 'action']);
        expect(snap.incomplete).toBe(false);
    });

    it('bounds bursts and total steps, reporting each limit once as a gap', () => {
        const clock = { now: 0 };
        const demo = session(clock);
        demo.addTab('root', { url: 'https://a.test/', title: 'A' });
        for (let index = 0; index < BROWSER_DEMO_LIMITS.burst + 5; index++) demo.action('root', click);
        let snap = demo.snapshot();
        expect(snap.steps.filter(step => step.type === 'action')).toHaveLength(BROWSER_DEMO_LIMITS.burst);
        expect(snap.steps.filter(step => step.type === 'gap')).toEqual([expect.objectContaining({ reason: 'rate-limit' })]);
        expect(snap.incomplete).toBe(true);
        for (let index = 0; index < BROWSER_DEMO_LIMITS.steps * 2; index++) { clock.now += 1_000; demo.action('root', click); }
        snap = demo.snapshot();
        expect(snap.steps.length).toBeLessThanOrEqual(BROWSER_DEMO_LIMITS.steps + 1);
        expect(snap.steps[snap.steps.length - 1]).toMatchObject({ type: 'gap', reason: 'step-limit' });
    });

    it('caps tabs with a gap on the opener', () => {
        const demo = session();
        demo.addTab('t0', { url: 'https://a.test/', title: '' });
        for (let index = 1; index < BROWSER_DEMO_LIMITS.tabs; index++) expect(demo.addTab(`t${index}`, { url: 'https://a.test/', title: '' }, 't0')).toBe(true);
        expect(demo.addTab('over', { url: 'https://a.test/', title: '' }, 't0')).toBe(false);
        expect(demo.snapshot().steps.at(-1)).toMatchObject({ type: 'gap', reason: 'tab-limit', viewId: 't0' });
    });

    it('freezes on stop and returns copies', () => {
        const demo = session();
        demo.addTab('root', { url: 'https://a.test/', title: 'A' });
        const stopped = demo.stop();
        demo.action('root', click);
        demo.gap('root', 'capture-failed');
        stopped.steps.length = 0;
        expect(demo.snapshot()).toMatchObject({ status: 'stopped', incomplete: false });
        expect(demo.snapshot().steps).toHaveLength(1);
    });
});
