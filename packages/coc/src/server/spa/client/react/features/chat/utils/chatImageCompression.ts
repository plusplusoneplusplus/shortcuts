export const CHAT_IMAGE_COMPRESSION_MAX_DIMENSION = 1600;
export const CHAT_IMAGE_COMPRESSION_MIN_SIZE = 64 * 1024;
export const CHAT_IMAGE_COMPRESSION_QUALITY = 0.82;

const OUTPUT_MIME_TYPE = 'image/jpeg';
const COMPRESSIBLE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export interface ChatImageCompressionInput {
    name: string;
    mimeType: string;
    size: number;
    dataUrl: string;
}

export interface ChatImageCompressionResult extends ChatImageCompressionInput {
    compressed: boolean;
}

export function canCompressChatImageForLlm(input: ChatImageCompressionInput): boolean {
    return shouldAttemptCompression(input);
}

export async function compressChatImageForLlm(
    input: ChatImageCompressionInput,
): Promise<ChatImageCompressionResult> {
    if (!shouldAttemptCompression(input)) {
        return { ...input, compressed: false };
    }

    try {
        const image = await loadImage(input.dataUrl);
        const naturalWidth = image.naturalWidth || image.width;
        const naturalHeight = image.naturalHeight || image.height;
        if (naturalWidth <= 0 || naturalHeight <= 0) {
            return { ...input, compressed: false };
        }

        const { width, height } = fitWithinMaxDimension(
            naturalWidth,
            naturalHeight,
            CHAT_IMAGE_COMPRESSION_MAX_DIMENSION,
        );
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = getCanvasContext(canvas);
        if (!context) {
            return { ...input, compressed: false };
        }

        context.drawImage(image, 0, 0, width, height);
        const blob = await canvasToBlob(canvas, OUTPUT_MIME_TYPE, CHAT_IMAGE_COMPRESSION_QUALITY);
        if (!blob || blob.size >= input.size) {
            return { ...input, compressed: false };
        }

        const dataUrl = await blobToDataUrl(blob);
        if (!dataUrl) {
            return { ...input, compressed: false };
        }

        return {
            name: withJpegExtension(input.name),
            mimeType: OUTPUT_MIME_TYPE,
            size: blob.size,
            dataUrl,
            compressed: true,
        };
    } catch {
        return { ...input, compressed: false };
    }
}

function shouldAttemptCompression(input: ChatImageCompressionInput): boolean {
    return COMPRESSIBLE_MIME_TYPES.has(input.mimeType.toLowerCase())
        && input.size >= CHAT_IMAGE_COMPRESSION_MIN_SIZE
        && input.dataUrl.startsWith('data:image/')
        && typeof document !== 'undefined'
        && typeof Image !== 'undefined'
        && typeof FileReader !== 'undefined'
        && typeof Blob !== 'undefined'
        && hasCanvasCompressionSupport();
}

function hasCanvasCompressionSupport(): boolean {
    try {
        const canvas = document.createElement('canvas');
        return !!getCanvasContext(canvas)
            && (typeof canvas.toBlob === 'function' || typeof canvas.toDataURL === 'function');
    } catch {
        return false;
    }
}

function fitWithinMaxDimension(
    width: number,
    height: number,
    maxDimension: number,
): { width: number; height: number } {
    const largest = Math.max(width, height);
    if (largest <= maxDimension) {
        return { width, height };
    }

    const scale = maxDimension / largest;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    try {
        return canvas.getContext('2d');
    } catch {
        return null;
    }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load chat image for compression'));
        image.src = dataUrl;
    });
}

function canvasToBlob(
    canvas: HTMLCanvasElement,
    mimeType: string,
    quality: number,
): Promise<Blob | null> {
    if (typeof canvas.toBlob === 'function') {
        return new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
    }

    if (typeof canvas.toDataURL !== 'function') {
        return Promise.resolve(null);
    }

    return Promise.resolve(dataUrlToBlob(canvas.toDataURL(mimeType, quality)));
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const value = event.target?.result;
            resolve(typeof value === 'string' ? value : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
    });
}

function dataUrlToBlob(dataUrl: string): Blob | null {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match || typeof atob === 'undefined') {
        return null;
    }

    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: match[1] });
}

function withJpegExtension(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
        return 'image.jpg';
    }
    return /\.[^./\\]+$/.test(trimmed)
        ? trimmed.replace(/\.[^./\\]+$/, '.jpg')
        : `${trimmed}.jpg`;
}
