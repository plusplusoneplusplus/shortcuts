export interface CapturedToolExecutionResult {
    content?: string;
    binaryResultsForLlm?: unknown[];
    contents?: unknown[];
}

type ImageBlock = { type: 'image'; data: string; mimeType: string };

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function imageBlock(value: unknown): ImageBlock | undefined {
    const block = record(value);
    if (!block) return;
    let data: unknown;
    let mimeType: unknown;
    if (block.type === 'image') {
        const source = record(block.source);
        data = source?.type === 'base64' ? source.data : block.data;
        mimeType = source?.type === 'base64' ? source.media_type : block.mimeType;
    } else if (block.type === 'file' && typeof block.url === 'string') {
        const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(block.url);
        if (match) [, mimeType, data] = match;
    }
    if (typeof data === 'string' && typeof mimeType === 'string'
        && /^image\/(?:png|jpeg|jpg|gif|webp)$/i.test(mimeType)
        && /^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        return { type: 'image', data, mimeType };
    }
}

/** Only image-bearing results change representation; text-only callers keep their existing formatting. */
export function serializeToolResultWithImages(value: unknown): string | undefined {
    const root = record(value);
    const blocks = Array.isArray(value) ? value : root ? [
        root,
        ...[root.binaryResultsForLlm, root.contents, root.content, root.attachments].flatMap(part => Array.isArray(part) ? part : []),
    ] : [];
    const primaryText = [root?.content, root?.textResultForLlm, root?.output]
        .find(part => typeof part === 'string' && part.length > 0) as string | undefined;
    const content: Array<ImageBlock | { type: 'text'; text: string }> = [];
    if (primaryText) content.push({ type: 'text', text: primaryText });
    const images = new Set<string>();
    for (const block of blocks) {
        const image = imageBlock(block);
        if (image) {
            const id = JSON.stringify([image.mimeType, image.data]);
            if (!images.has(id)) { images.add(id); content.push(image); }
        } else {
            const text = record(block);
            if (primaryText === undefined && text?.type === 'text' && typeof text.text === 'string') {
                content.push({ type: 'text', text: text.text });
            }
        }
    }
    return images.size ? JSON.stringify({ content }) : undefined;
}
