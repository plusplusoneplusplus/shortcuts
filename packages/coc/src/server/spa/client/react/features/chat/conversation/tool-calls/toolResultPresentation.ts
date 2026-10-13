export interface ToolResultPresentation {
    text: string;
    images: Array<{ src: string; alt: string }>;
}

/** Provider-neutral tool results and MCP image blocks share one display path. */
export function getToolResultPresentation(result: unknown): ToolResultPresentation {
    let value = result;
    if (typeof value === 'string') {
        if (/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(value.trim())) {
            return { text: '', images: [{ src: value.trim(), alt: 'Tool result image' }] };
        }
        const text = value;
        try { value = JSON.parse(text); } catch { return { text, images: [] }; }
    }
    if (!value || typeof value !== 'object') {
        return { text: typeof result === 'string' ? result : '', images: [] };
    }
    const object = value as Record<string, unknown>;
    const blocks = Array.isArray(object.binaryResultsForLlm)
        ? object.binaryResultsForLlm
        : Array.isArray(object.content) ? object.content : [];
    const images: ToolResultPresentation['images'] = [];
    for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        const image = block as Record<string, unknown>;
        if (image.type !== 'image' || typeof image.data !== 'string'
            || typeof image.mimeType !== 'string' || !/^image\/(?:png|jpeg|jpg|gif|webp)$/i.test(image.mimeType)
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) continue;
        images.push({
            src: `data:${image.mimeType};base64,${image.data}`,
            alt: typeof image.description === 'string' ? image.description : 'Browser screenshot',
        });
    }
    const text = typeof object.textResultForLlm === 'string'
        ? object.textResultForLlm
        : Array.isArray(object.content)
            ? object.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
            : typeof result === 'string' ? result : JSON.stringify(result);
    return { text, images };
}
