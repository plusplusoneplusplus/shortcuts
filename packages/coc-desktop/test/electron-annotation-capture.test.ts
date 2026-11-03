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
        { zoom: 1, dpr: 1, capture: { x: 10, y: 20, width: 31, height: 41 }, crop: { x: 0, y: 0, width: 31, height: 41 } },
        { zoom: 1, dpr: 2, capture: { x: 10, y: 20, width: 31, height: 41 }, crop: { x: 0, y: 1, width: 62, height: 81 } },
        { zoom: 1.25, dpr: 2.5, capture: { x: 12, y: 25, width: 39, height: 51 }, crop: { x: 1, y: 1, width: 77, height: 101 } },
    ])('preserves enclosing physical pixels at zoom $zoom and DPR $dpr', async ({ zoom, dpr, capture, crop }) => {
        const contents = fixture(zoom);
        const result = await captureElectronAnnotation(contents, { x: 10.25, y: 20.5, width: 30.5, height: 40.25 },
            { width: 800, height: 600, devicePixelRatio: dpr });
        expect(contents.capturePage).toHaveBeenCalledExactlyOnceWith(capture, { stayHidden: true });
        expect(mocks.decode).toHaveBeenCalledWith(Buffer.from('native PNG'));
        expect(mocks.crop).toHaveBeenCalledExactlyOnceWith(crop);
        expect(result).toEqual({ dataUrl: `data:image/png;base64,${mocks.png.toString('base64')}`, width: crop.width, height: crop.height });
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
