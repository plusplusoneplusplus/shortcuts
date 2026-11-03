import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAnnotationSession, type BrowserAnnotationImage, type BrowserAnnotationSelection,
    type DesktopBrowserAnnotation } from '../../../../src/server/spa/client/react/shared/file-path/browser-annotation';
import { acknowledgeBrowserAnnotationChips, applyBrowserAnnotationEvents, formatBrowserAnnotationChips,
    getBrowserAnnotationChips, removeBrowserAnnotationChip, resetBrowserAnnotationChipsForTest,
} from '../../../../src/server/spa/client/react/shared/file-path/browser-annotation-chips';

const owner = { workspaceId: 'workspace-a', routingRef: 'remote:server-a:workspace-a', processId: 'chat-a' };
const image: BrowserAnnotationImage = { dataUrl: 'data:image/png;base64,aGVsbG8=', width: 60, height: 80 };
const selection: BrowserAnnotationSelection = {
    type: 'selection', kind: 'area', captureId: '1', immediate: false,
    rect: { x: 1.25, y: 2.5, width: 30, height: 40 },
    page: { url: 'https://example.com', title: 'Example', viewport: { width: 800, height: 600, devicePixelRatio: 2 } },
};
function fixture() {
    const bridge = {
        supported: true, start: vi.fn(async () => true), stop: vi.fn(async () => {}),
        remove: vi.fn(async () => {}), setEnabled: vi.fn(async () => {}),
        onEvent: vi.fn(() => () => {}),
    } satisfies DesktopBrowserAnnotation;
    const session = new BrowserAnnotationSession(bridge, 'view-a', owner.routingRef, vi.fn());
    const capture = (selected = selection, png = image) =>
        applyBrowserAnnotationEvents(owner, session, [{ ...selected, image: png }]);
    const save = (id = '1', selected = selection, comment = 'Fix this') =>
        applyBrowserAnnotationEvents(owner, session, [{ type: 'comment', id, number: Number(id), comment, selection: selected }]);
    return { bridge, session, capture, save };
}

beforeEach(resetBrowserAnnotationChipsForTest);

describe('browser annotation screenshot chips', () => {
    it('associates selection and save in one batch without putting PNG bytes in the snapshot or text', () => {
        const f = fixture();
        applyBrowserAnnotationEvents(owner, f.session, [
            { ...selection, image }, { type: 'comment', id: '1', number: 1, comment: 'Fix this', selection },
        ]);
        const [chip] = getBrowserAnnotationChips(owner);
        expect(chip.image).toBe(image);
        expect(chip.selection).toBe(selection);
        expect(chip.selection).not.toHaveProperty('image');
        expect(formatBrowserAnnotationChips([chip])).not.toContain(image.dataUrl);
        expect(formatBrowserAnnotationChips([chip])).not.toContain('captureId');
        expect(() => f.session.takeCapture('1')).toThrow('unavailable');
    });

    it('reuses the original PNG for edits after another selection and renumbers images with pins', () => {
        const f = fixture();
        f.capture(); f.save();
        const second = { ...selection, captureId: '2' };
        const nextImage = { ...image, width: 70 };
        f.capture(second, nextImage);
        f.save('1', selection, 'Edited original');
        f.save('2', second);
        expect(getBrowserAnnotationChips(owner).map(chip => chip.image)).toEqual([image, nextImage]);
        applyBrowserAnnotationEvents(owner, f.session, [{ type: 'delete', id: '1' }]);
        expect(getBrowserAnnotationChips(owner)).toMatchObject([{ id: '2', number: 1, image: nextImage }]);
    });

    it('rejects stale and missing captures instead of creating image-less production chips', () => {
        const f = fixture();
        f.capture();
        f.capture({ ...selection, captureId: '2' });
        expect(() => f.save()).toThrow('screenshot is unavailable');
        expect(getBrowserAnnotationChips(owner)).toEqual([]);
        applyBrowserAnnotationEvents(owner, f.session, [{ ...selection, captureId: '2' }]);
        expect(() => f.save('2', { ...selection, captureId: '2' })).toThrow('unavailable');
    });

    it.each(['workspaceId', 'routingRef', 'processId'] as const)('never exposes the PNG to a foreign %s', key => {
        const f = fixture(); f.capture(); f.save();
        expect(getBrowserAnnotationChips({ ...owner, [key]: 'foreign' })).toEqual([]);
        expect(getBrowserAnnotationChips({ ...owner, processId: 'queue_chat-a' })[0].image).toBe(image);
        const other = fixture();
        expect(() => other.save()).toThrow('unavailable');
    });

    it('clears unsaved PNGs on exit or Stop, retaining saved chips after navigation', async () => {
        const f = fixture(); await f.session.start();
        f.capture(); f.save();
        f.capture({ ...selection, captureId: '2' });
        applyBrowserAnnotationEvents(owner, f.session, [{ type: 'exit', reason: 'escape' }]);
        expect(() => f.session.takeCapture('2')).toThrow('unavailable');
        f.capture({ ...selection, captureId: '3' });
        await f.session.stop();
        expect(() => f.session.takeCapture('3')).toThrow('unavailable');
        expect(getBrowserAnnotationChips(owner)[0].image).toBe(image);
        await removeBrowserAnnotationChip(getBrowserAnnotationChips(owner)[0].key);
        expect(getBrowserAnnotationChips(owner)).toEqual([]);
        expect(f.bridge.remove).not.toHaveBeenCalled();
    });

    it('consumes accepted PNGs but retains concurrent edits and newly saved captures', async () => {
        const f = fixture(); await f.session.start();
        f.capture(); f.save();
        const original = getBrowserAnnotationChips(owner);
        f.save('1', selection, 'New edit');
        f.capture({ ...selection, captureId: '2' });
        f.save('2', { ...selection, captureId: '2' });
        await acknowledgeBrowserAnnotationChips(original);
        expect(getBrowserAnnotationChips(owner)).toHaveLength(2);
        const edited = getBrowserAnnotationChips(owner)[0];
        await acknowledgeBrowserAnnotationChips([edited]);
        expect(getBrowserAnnotationChips(owner)).toMatchObject([{ number: 1, image }]);
        expect(f.bridge.remove).toHaveBeenCalledExactlyOnceWith(f.session.identity, '1');
        await f.session.stop();
    });

    it.each([
        { dataUrl: 'data:image/jpeg;base64,aGVsbG8=' },
        { width: 0 }, { height: 0.5 }, { width: 16 * 1024 * 1024, height: 2 },
        { dataUrl: `data:image/png;base64,${'a'.repeat(28_000_000)}` },
    ])('rejects an invalid or oversized pending capture: %j', overrides => {
        const f = fixture();
        expect(() => f.capture(selection, { ...image, ...overrides })).toThrow('Invalid browser annotation screenshot');
        expect(() => f.session.takeCapture('1')).toThrow('unavailable');
    });

    it('bounds saved screenshot memory across all owners and frees capacity on removal', async () => {
        const largeImage = { ...image, dataUrl: `data:image/png;base64,${'a'.repeat(23 * 1024 * 1024)}` };
        const f = fixture(); f.capture(selection, largeImage); f.save();
        f.capture({ ...selection, captureId: '2' }, largeImage); f.save('2', { ...selection, captureId: '2' });
        const other = fixture();
        other.capture(selection, largeImage);
        expect(() => other.save()).toThrow('screenshots are full');
        expect(getBrowserAnnotationChips(owner)).toHaveLength(2);
        await removeBrowserAnnotationChip(getBrowserAnnotationChips(owner)[0].key);
        other.capture(selection, largeImage); other.save();
        expect(getBrowserAnnotationChips(owner)).toHaveLength(2);
    });
});
