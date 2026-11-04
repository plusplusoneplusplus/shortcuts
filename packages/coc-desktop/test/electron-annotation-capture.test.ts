import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureElectronAnnotation } from '../src/electron-annotation-capture';

const mocks = vi.hoisted(() => ({
    size: { width: 1000, height: 1000 },
    crop: vi.fn(),
    decode: vi.fn(),
    png: Buffer.from('cropped PNG'),
}));
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: mocks.decode } }));

function fixture(zoom = 1) {
    const image = { isEmpty: () => false, toPNG: () => Buffer.from('native PNG') };
    return { capturePage: vi.fn(async () => image), getZoomFactor: vi.fn(() => zoom), isDestroyed: vi.fn(() => false) };
}

describe('Electron annotation crop', () => {
    beforeEach(() => {
        vi.clearAllMocks(); mocks.size = { width: 1000, height: 1000 }; mocks.png = Buffer.from('cropped PNG');
        mocks.crop.mockImplementation(() => ({ toPNG: () => mocks.png }));
        mocks.decode.mockImplementation(() => ({ getSize: () => mocks.size, crop: mocks.crop }));
    });

    it.each([
        { zoom: 1, dpr: 1, capture: { x: 10, y: 20, width: 32, height: 42 }, crop: { x: 0, y: 0, width: 31, height: 41 } },
        { zoom: 1, dpr: 2, capture: { x: 10, y: 20, width: 32, height: 42 }, crop: { x: 0, y: 1, width: 62, height: 81 } },
        { zoom: 1.25, dpr: 2.5, capture: { x: 12, y: 25, width: 40, height: 52 }, crop: { x: 1, y: 1, width: 77, height: 101 } },
    ])('preserves enclosing physical pixels at zoom $zoom and DPR $dpr', async ({ zoom, dpr, capture, crop }) => {
        const contents = fixture(zoom);
        const result = await captureElectronAnnotation(contents, { x: 10.25, y: 20.5, width: 30.5, height: 40.25 },
            { width: 800, height: 600, devicePixelRatio: dpr });
        expect(contents.capturePage).toHaveBeenCalledExactlyOnceWith(capture, { stayHidden: true });
        expect(mocks.decode).toHaveBeenCalledWith(Buffer.from('native PNG'));
        expect(mocks.crop).toHaveBeenCalledExactlyOnceWith(crop);
        expect(result).toEqual({ dataUrl: `data:image/png;base64,${mocks.png.toString('base64')}`, width: crop.width, height: crop.height });
    });

    it('starts native capture on a whole device pixel at fractional display scales', async () => {
        // 11 DIPs would start at device pixel 16.5, which platforms round differently.
        const contents = fixture();
        await captureElectronAnnotation(contents, { x: 11.5, y: 21, width: 20, height: 10 }, { width: 800, height: 600, devicePixelRatio: 1.5 });
        expect(contents.capturePage).toHaveBeenCalledWith({ x: 10, y: 20, width: 23, height: 12 }, { stayHidden: true });
        expect(mocks.crop).toHaveBeenCalledWith({ x: 2, y: 1, width: 31, height: 16 });
    });

    it('ignores float32 devicePixelRatio noise when choosing enclosing pixels', async () => {
        const contents = fixture(1.1);
        const result = await captureElectronAnnotation(contents, { x: 10, y: 10, width: 50, height: 30 },
            { width: 800, height: 600, devicePixelRatio: 1.100000023841858 });
        expect(contents.capturePage).toHaveBeenCalledWith({ x: 11, y: 11, width: 56, height: 34 }, { stayHidden: true });
        expect(mocks.crop).toHaveBeenCalledWith({ x: 0, y: 0, width: 55, height: 33 });
        expect(result).toMatchObject({ width: 55, height: 33 });
    });

    it('trims an edge selection to the fractional surface behind a rounded viewport', async () => {
        // A 500.5 x 300.5 DIP guest reports 501 x 301 but displays only 1001 x 601 pixels at 2x.
        const viewport = { width: 501, height: 301, devicePixelRatio: 2 };
        const rect = { x: 400, y: 280.25, width: 101, height: 20.75 };
        mocks.size = { width: 201, height: 41 };
        const contents = fixture();
        await expect(captureElectronAnnotation(contents, rect, viewport)).resolves.toMatchObject({ width: 201, height: 41 });
        expect(contents.capturePage).toHaveBeenCalledWith({ x: 400, y: 280, width: 101, height: 21 }, { stayHidden: true });
        expect(mocks.crop).toHaveBeenCalledWith({ x: 0, y: 0, width: 201, height: 41 });
        mocks.size = { width: 150, height: 41 };
        await expect(captureElectronAnnotation(fixture(), rect, viewport)).rejects.toThrow('does not cover the selection');
    });

    it('captures only around a small selection in a viewport larger than the image bound', async () => {
        const contents = fixture();
        await expect(captureElectronAnnotation(contents, { x: 7000.5, y: 4000.25, width: 100, height: 50 },
            { width: 8000, height: 5000, devicePixelRatio: 2 })).resolves.toMatchObject({ width: 200, height: 101 });
        expect(contents.capturePage).toHaveBeenCalledWith({ x: 7000, y: 4000, width: 102, height: 52 }, { stayHidden: true });
    });

    it.each([
        { x: -1, y: 0, width: 20, height: 20 }, { x: 0, y: NaN, width: 20, height: 20 },
        { x: 0, y: 0, width: 0, height: 20 }, { x: 799, y: 0, width: 20, height: 20 },
    ])('rejects invalid selection %j before capture', async rect => {
        const contents = fixture();
        await expect(captureElectronAnnotation(contents, rect, { width: 800, height: 600, devicePixelRatio: 1 })).rejects.toThrow('geometry');
        expect(contents.capturePage).not.toHaveBeenCalled();
    });

    it('bounds physical image allocation before capture', async () => {
        const contents = fixture();
        await expect(captureElectronAnnotation(contents, { x: 0, y: 0, width: 800, height: 600 },
            { width: 800, height: 600, devicePixelRatio: 10 })).rejects.toThrow('too large');
        expect(contents.capturePage).not.toHaveBeenCalled();
    });

    it.each(['closed', 'zoom', 'empty', 'small', 'large PNG', 'empty PNG', 'native failure'])('rejects %s without returning an image', async reason => {
        const contents = fixture();
        contents.capturePage.mockImplementation(async () => {
            if (reason === 'closed') contents.isDestroyed.mockReturnValue(true);
            if (reason === 'zoom') contents.getZoomFactor.mockReturnValue(2);
            if (reason === 'small') mocks.size = { width: 1, height: 1 };
            if (reason === 'large PNG') mocks.png = Buffer.alloc(20_971_521);
            if (reason === 'empty PNG') mocks.png = Buffer.alloc(0);
            if (reason === 'native failure') throw new Error('native failure');
            return { isEmpty: () => reason === 'empty', toPNG: () => Buffer.from('native PNG') };
        });
        await expect(captureElectronAnnotation(contents, { x: 10, y: 20, width: 30, height: 40 },
            { width: 800, height: 600, devicePixelRatio: 1 })).rejects.toThrow();
    });
});
