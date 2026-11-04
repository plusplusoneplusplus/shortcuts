import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureWebView2Annotation } from '../src/webview2-annotation-capture';

const mocks = vi.hoisted(() => ({
    size: { width: 800, height: 600 }, empty: false,
    crop: vi.fn(), decode: vi.fn(), output: Buffer.from('cropped PNG'),
}));
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: mocks.decode } }));

function preview(width = 800, height = 600, length = 24) {
    const png = Buffer.alloc(length);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(width, 16); png.writeUInt32BE(height, 20);
    return `data:image/png;base64,${png.toString('base64')}`;
}
const rect = { x: 10.25, y: 20.5, width: 30.5, height: 40.25 };
const viewport = { width: 800, height: 600, devicePixelRatio: 1 };

describe('WebView2 annotation preview crop', () => {
    beforeEach(() => {
        vi.clearAllMocks(); mocks.size = { width: 800, height: 600 }; mocks.empty = false; mocks.output = Buffer.from('cropped PNG');
        mocks.crop.mockImplementation(() => ({ toPNG: () => mocks.output }));
        mocks.decode.mockImplementation(() => ({ isEmpty: () => mocks.empty, getSize: () => mocks.size, crop: mocks.crop }));
    });

    it.each([
        { dpr: 1, width: 800, height: 600, crop: { x: 10, y: 20, width: 31, height: 41 } },
        { dpr: 2, width: 1600, height: 1200, crop: { x: 20, y: 41, width: 62, height: 81 } },
        { dpr: 2.5, width: 2000, height: 1500, crop: { x: 25, y: 51, width: 77, height: 101 } },
    ])('crops physical selection bounds including page zoom at DPR $dpr', async ({ dpr, width, height, crop }) => {
        mocks.size = { width, height };
        const capture = vi.fn(async () => preview(width, height));
        const image = await captureWebView2Annotation(capture, rect, { ...viewport, devicePixelRatio: dpr });
        expect(capture).toHaveBeenCalledExactlyOnceWith();
        expect(mocks.crop).toHaveBeenCalledExactlyOnceWith(crop);
        expect(image).toEqual({ dataUrl: `data:image/png;base64,${mocks.output.toString('base64')}`, width: crop.width, height: crop.height });
    });

    it.each([
        { ...rect, x: -1 }, { ...rect, y: NaN }, { ...rect, width: 0 }, { ...rect, x: 799 },
    ])('refuses invalid geometry before native dispatch %j', async selection => {
        const capture = vi.fn();
        await expect(captureWebView2Annotation(capture, selection, viewport)).rejects.toThrow('geometry');
        expect(capture).not.toHaveBeenCalled();
    });

    it('bounds the entire CapturePreview allocation before native dispatch', async () => {
        const capture = vi.fn();
        await expect(captureWebView2Annotation(capture, rect, { ...viewport, devicePixelRatio: 10 })).rejects.toThrow('too large');
        expect(capture).not.toHaveBeenCalled();
    });

    it('allows viewport CSS rounding without resampling physical pixels', async () => {
        mocks.size = { width: 1599, height: 1199 };
        await expect(captureWebView2Annotation(async () => preview(1599, 1199), rect,
            { ...viewport, width: 800.25, height: 600.25, devicePixelRatio: 2 })).resolves.toMatchObject({ width: 62, height: 81 });
        expect(mocks.crop).toHaveBeenCalledWith({ x: 20, y: 41, width: 62, height: 81 });
    });

    it('refuses a selection beyond the actual physical preview edge', async () => {
        mocks.size = { width: 799, height: 600 };
        await expect(captureWebView2Annotation(async () => preview(799, 600),
            { x: 790, y: 0, width: 10, height: 10 }, viewport)).rejects.toThrow('viewport');
        expect(mocks.decode).not.toHaveBeenCalled();
    });

    it.each([undefined, '', 'data:image/jpeg;base64,AAAA', 'data:image/png;base64,!!!!',
        'data:image/png;base64,AAA', 'data:image/png;base64,AB==', preview(0), preview(1), preview(8000, 8000),
        preview(800, 600, 20_971_521)])('refuses malformed or oversized previews before decoding', async value => {
        await expect(captureWebView2Annotation(async () => value, rect, viewport)).rejects.toThrow();
        expect(mocks.decode).not.toHaveBeenCalled();
    });

    it('accepts large bounded native previews without regexp stack overflow', async () => {
        await expect(captureWebView2Annotation(async () => preview(800, 600, 2_000_000), rect, viewport)).resolves.toMatchObject({ width: 31 });
    });

    it.each(['empty', 'different size', 'empty crop', 'large crop', 'native failure', 'decode failure'])('preserves %s errors without delivering an image', async reason => {
        if (reason === 'empty') mocks.empty = true;
        if (reason === 'different size') mocks.size.width = 799;
        if (reason === 'empty crop') mocks.output = Buffer.alloc(0);
        if (reason === 'large crop') mocks.output = Buffer.alloc(20_971_521);
        if (reason === 'decode failure') mocks.decode.mockImplementationOnce(() => { throw new Error('decode failure'); });
        await expect(captureWebView2Annotation(async () => {
            if (reason === 'native failure') throw new Error('native failure');
            return preview();
        }, rect, viewport)).rejects.toThrow();
    });
});
