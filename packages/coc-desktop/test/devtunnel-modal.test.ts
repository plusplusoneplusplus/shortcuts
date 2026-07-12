/**
 * Unit tests for the AC-01 DevTunnel "Configure…" modal.
 *
 * The interaction logic (`wireDevTunnelModal`) is electron-free and DOM-agnostic,
 * so we drive it against a tiny fake DOM to prove the Save/Cancel behaviour
 * directly — Save submits the trimmed ID, an empty field disables Save and never
 * submits, Cancel/Escape cancel, Enter submits. The renderers are asserted for
 * the prefilled field, private-access guidance, action buttons, HTML-escaping of
 * an injected tunnel ID, and the loadable `data:` URL wrapper.
 */

import { describe, it, expect } from 'vitest';
import {
    wireDevTunnelModal,
    renderDevTunnelConfigHtml,
    devTunnelConfigDataUrl,
    DEVTUNNEL_MODAL_INPUT_ID,
    DEVTUNNEL_MODAL_SAVE_ID,
    DEVTUNNEL_MODAL_CANCEL_ID,
    DEVTUNNEL_PRIVATE_ACCESS_GUIDANCE,
    type DevTunnelModalDocument,
    type DevTunnelModalEvent,
} from '../src/devtunnel-modal';

/** A minimal fake DOM element that records listeners and lets tests fire them. */
class FakeElement {
    value = '';
    disabled = false;
    focused = false;
    selected = false;
    private listeners = new Map<string, Array<(event: DevTunnelModalEvent) => void>>();

    addEventListener(type: string, listener: (event: DevTunnelModalEvent) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    focus(): void {
        this.focused = true;
    }

    select(): void {
        this.selected = true;
    }

    /** Fire every listener registered for `type`. */
    fire(type: string, event: DevTunnelModalEvent = {}): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
    }

    hasListener(type: string): boolean {
        return (this.listeners.get(type) ?? []).length > 0;
    }
}

/** A fake `document` exposing the modal's three elements by id. */
function makeDom(): {
    doc: DevTunnelModalDocument;
    input: FakeElement;
    save: FakeElement;
    cancel: FakeElement;
} {
    const input = new FakeElement();
    const save = new FakeElement();
    const cancel = new FakeElement();
    const byId: Record<string, FakeElement> = {
        [DEVTUNNEL_MODAL_INPUT_ID]: input,
        [DEVTUNNEL_MODAL_SAVE_ID]: save,
        [DEVTUNNEL_MODAL_CANCEL_ID]: cancel,
    };
    const doc: DevTunnelModalDocument = {
        getElementById: (id) => byId[id] ?? null,
    };
    return { doc, input, save, cancel };
}

function makeBridge(): { submit: string[]; cancels: number; bridge: { submit: (id: string) => void; cancel: () => void } } {
    const submit: string[] = [];
    let cancels = 0;
    return {
        submit,
        get cancels() {
            return cancels;
        },
        bridge: {
            submit: (id: string) => {
                submit.push(id);
            },
            cancel: () => {
                cancels += 1;
            },
        },
    };
}

describe('wireDevTunnelModal', () => {
    it('submits the trimmed tunnel ID when Save is clicked', () => {
        const { doc, input, save } = makeDom();
        const b = makeBridge();
        input.value = '  my-box-coc  ';
        wireDevTunnelModal(doc, b.bridge);
        save.fire('click');
        expect(b.submit).toEqual(['my-box-coc']);
        expect(b.cancels).toBe(0);
    });

    it('cancels when Cancel is clicked', () => {
        const { doc, cancel } = makeDom();
        const b = makeBridge();
        wireDevTunnelModal(doc, b.bridge);
        cancel.fire('click');
        expect(b.cancels).toBe(1);
        expect(b.submit).toEqual([]);
    });

    it('submits on Enter and cancels on Escape', () => {
        const { doc, input } = makeDom();
        const b = makeBridge();
        input.value = 'host-coc';
        wireDevTunnelModal(doc, b.bridge);
        input.fire('keydown', { key: 'Enter', preventDefault: () => {} });
        expect(b.submit).toEqual(['host-coc']);
        input.fire('keydown', { key: 'Escape', preventDefault: () => {} });
        expect(b.cancels).toBe(1);
    });

    it('disables Save for an empty/whitespace field and never submits it', () => {
        const { doc, input, save } = makeDom();
        const b = makeBridge();
        input.value = '   ';
        wireDevTunnelModal(doc, b.bridge);
        // Save starts disabled because the trimmed value is empty.
        expect(save.disabled).toBe(true);
        save.fire('click');
        input.fire('keydown', { key: 'Enter', preventDefault: () => {} });
        expect(b.submit).toEqual([]);
    });

    it('tracks Save enablement as the field changes on input', () => {
        const { doc, input, save } = makeDom();
        const b = makeBridge();
        input.value = '';
        wireDevTunnelModal(doc, b.bridge);
        expect(save.disabled).toBe(true);
        input.value = 'x-coc';
        input.fire('input');
        expect(save.disabled).toBe(false);
        input.value = '';
        input.fire('input');
        expect(save.disabled).toBe(true);
    });

    it('focuses and selects the prefilled field so a rename overwrites cleanly', () => {
        const { doc, input } = makeDom();
        const b = makeBridge();
        input.value = 'host-coc';
        wireDevTunnelModal(doc, b.bridge);
        expect(input.focused).toBe(true);
        expect(input.selected).toBe(true);
    });

    it('is a no-op when the bridge is missing (renderer loaded without the preload)', () => {
        const { doc, input, save, cancel } = makeDom();
        // No throw, and no listeners are wired without a bridge to call.
        expect(() => wireDevTunnelModal(doc, null)).not.toThrow();
        expect(input.hasListener('keydown')).toBe(false);
        expect(save.hasListener('click')).toBe(false);
        expect(cancel.hasListener('click')).toBe(false);
    });

    it('is a no-op when a required element is missing', () => {
        const b = makeBridge();
        const doc: DevTunnelModalDocument = { getElementById: () => null };
        expect(() => wireDevTunnelModal(doc, b.bridge)).not.toThrow();
        expect(b.submit).toEqual([]);
        expect(b.cancels).toBe(0);
    });
});

describe('renderDevTunnelConfigHtml', () => {
    it('prefills the tunnel-ID field with the provided id', () => {
        const html = renderDevTunnelConfigHtml({ tunnelId: 'my-box-coc' });
        expect(html).toContain(`id="${DEVTUNNEL_MODAL_INPUT_ID}"`);
        expect(html).toContain('value="my-box-coc"');
    });

    it('shows the private-access guidance and Save/Cancel actions', () => {
        const html = renderDevTunnelConfigHtml({ tunnelId: 'host-coc' });
        expect(html).toContain(DEVTUNNEL_PRIVATE_ACCESS_GUIDANCE);
        expect(html).toContain(`id="${DEVTUNNEL_MODAL_SAVE_ID}"`);
        expect(html).toContain(`id="${DEVTUNNEL_MODAL_CANCEL_ID}"`);
        expect(html).toContain('>Save<');
        expect(html).toContain('>Cancel<');
    });

    it('embeds the shared interaction logic so behaviour has one source of truth', () => {
        const html = renderDevTunnelConfigHtml({ tunnelId: 'host-coc' });
        expect(html).toContain('window.cocDesktop && window.cocDesktop.devtunnelModal');
        // Function-unique tokens prove the shared logic is embedded (not just the
        // markup). Quote style differs between tsc and the test transform, so we
        // assert on identifiers, never on quoted string literals.
        expect(html).toContain('syncSaveEnabled');
        expect(html).toContain('getElementById');
        expect(html).toContain(DEVTUNNEL_MODAL_INPUT_ID);
    });

    it('HTML-escapes the tunnel ID so a hand-edited value cannot inject markup', () => {
        const html = renderDevTunnelConfigHtml({ tunnelId: '"><img src=x onerror=alert(1)>' });
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    });

    it('uses the dark desktop-shell background', () => {
        const html = renderDevTunnelConfigHtml({ tunnelId: 'host-coc' });
        expect(html).toContain('background: #0d1117');
    });
});

describe('devTunnelConfigDataUrl', () => {
    it('wraps the rendered modal as a loadable data: URL', () => {
        const url = devTunnelConfigDataUrl({ tunnelId: 'host-coc' });
        expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
        const decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
        expect(decoded).toBe(renderDevTunnelConfigHtml({ tunnelId: 'host-coc' }));
    });
});
