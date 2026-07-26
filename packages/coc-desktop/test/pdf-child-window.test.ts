import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
    isSameOriginPdfChildUrl,
    PdfChildWindow,
    PdfChildWindowParent,
    PreventUnloadEvent,
    wirePdfChildWindowClose,
    wirePdfChildWindows,
} from '../src/pdf-child-window';

class FakeWebContents extends EventEmitter {
    preventUnload(event: PreventUnloadEvent): void {
        this.emit('will-prevent-unload', event);
    }
}

class FakeChildWindow extends EventEmitter implements PdfChildWindow {
    readonly webContents = new FakeWebContents();

    requestClose(): void {
        this.emit('close');
    }

    closeWindow(): void {
        this.emit('closed');
    }
}

class FakeParentWebContents extends EventEmitter implements PdfChildWindowParent {
    createWindow(window: FakeChildWindow, url: string): void {
        this.emit('did-create-window', window, { url });
    }

    destroyContents(): void {
        this.emit('destroyed');
    }
}

function preventUnloadEvent(): PreventUnloadEvent & { preventDefault: ReturnType<typeof vi.fn> } {
    return { preventDefault: vi.fn() };
}

describe('isSameOriginPdfChildUrl', () => {
    const appUrl = 'http://127.0.0.1:51234';

    it('identifies direct and Notes-served same-origin PDFs', () => {
        expect(isSameOriginPdfChildUrl(`${appUrl}/files/report.PDF`, appUrl)).toBe(true);
        expect(
            isSameOriginPdfChildUrl(
                `${appUrl}/api/workspaces/ws-1/notes/image?path=.attachments%2Freport.pdf`,
                appUrl,
            ),
        ).toBe(true);
        expect(
            isSameOriginPdfChildUrl(
                `${appUrl}/api/workspaces/ws-1/notes/local-image?path=${encodeURIComponent('C:\\notes\\report.pdf')}`,
                `${appUrl}/#repos/ws-1/notes`,
            ),
        ).toBe(true);
    });

    it('rejects external, non-PDF, malformed, and unrelated popup URLs', () => {
        expect(isSameOriginPdfChildUrl('https://example.com/report.pdf', appUrl)).toBe(false);
        expect(isSameOriginPdfChildUrl(`${appUrl}/notes/report.txt`, appUrl)).toBe(false);
        expect(isSameOriginPdfChildUrl(`${appUrl}/popup?redirect=report.pdf`, appUrl)).toBe(false);
        expect(
            isSameOriginPdfChildUrl(
                `${appUrl}/api/workspaces/ws-1/notes/image?path=one.pdf&path=two.pdf`,
                appUrl,
            ),
        ).toBe(false);
        expect(isSameOriginPdfChildUrl('/relative/report.pdf', appUrl)).toBe(false);
    });
});

describe('wirePdfChildWindowClose', () => {
    it('does nothing during a normal close with no beforeunload prevention', () => {
        const child = new FakeChildWindow();
        const confirmDiscard = vi.fn(() => true);

        wirePdfChildWindowClose(child, { confirmDiscard });
        child.requestClose();
        child.closeWindow();

        expect(confirmDiscard).not.toHaveBeenCalled();
        expect(child.listenerCount('close')).toBe(0);
        expect(child.webContents.listenerCount('will-prevent-unload')).toBe(0);
        expect(child.listenerCount('closed')).toBe(0);
    });

    it('keeps the PDF open when the user declines to discard annotations', () => {
        const child = new FakeChildWindow();
        const event = preventUnloadEvent();

        wirePdfChildWindowClose(child, { confirmDiscard: () => false });
        child.requestClose();
        child.webContents.preventUnload(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('prompts again on a later close attempt after the user kept the PDF open', () => {
        const child = new FakeChildWindow();
        const firstEvent = preventUnloadEvent();
        const secondEvent = preventUnloadEvent();
        const confirmDiscard = vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);

        wirePdfChildWindowClose(child, { confirmDiscard });
        child.requestClose();
        child.webContents.preventUnload(firstEvent);
        child.requestClose();
        child.webContents.preventUnload(secondEvent);

        expect(confirmDiscard).toHaveBeenCalledTimes(2);
        expect(firstEvent.preventDefault).not.toHaveBeenCalled();
        expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    });

    it('continues the pending close only when the user confirms discard', () => {
        const child = new FakeChildWindow();
        const event = preventUnloadEvent();

        wirePdfChildWindowClose(child, { confirmDiscard: () => true });
        child.requestClose();
        child.webContents.preventUnload(event);

        expect(event.preventDefault).toHaveBeenCalledOnce();
    });

    it('does not override a beforeunload guard that was not caused by closing the window', () => {
        const child = new FakeChildWindow();
        const event = preventUnloadEvent();
        const confirmDiscard = vi.fn(() => true);

        wirePdfChildWindowClose(child, { confirmDiscard });
        child.webContents.preventUnload(event);

        expect(confirmDiscard).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
    });
});

describe('wirePdfChildWindows', () => {
    const appUrl = 'http://127.0.0.1:51234';

    it('wires PDF children and leaves unrelated child windows untouched', () => {
        const parent = new FakeParentWebContents();
        const pdfChild = new FakeChildWindow();
        const unrelatedChild = new FakeChildWindow();

        wirePdfChildWindows(parent, appUrl, { confirmDiscard: () => true });
        parent.createWindow(pdfChild, `${appUrl}/files/report.pdf`);
        parent.createWindow(unrelatedChild, `${appUrl}/popup?document=report.pdf`);

        expect(pdfChild.webContents.listenerCount('will-prevent-unload')).toBe(1);
        expect(unrelatedChild.webContents.listenerCount('will-prevent-unload')).toBe(0);
    });

    it('removes the child and parent listeners with their owning windows', () => {
        const parent = new FakeParentWebContents();
        const child = new FakeChildWindow();

        wirePdfChildWindows(parent, appUrl, { confirmDiscard: () => true });
        parent.createWindow(child, `${appUrl}/files/report.pdf`);
        child.closeWindow();
        parent.destroyContents();

        expect(child.webContents.listenerCount('will-prevent-unload')).toBe(0);
        expect(child.listenerCount('close')).toBe(0);
        expect(parent.listenerCount('did-create-window')).toBe(0);
        expect(parent.listenerCount('destroyed')).toBe(0);
    });
});
