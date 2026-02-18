/**
 * Shared SSE stream reader utility.
 * Parses Server-Sent Events from a ReadableStream, calling onEvent for each parsed JSON payload.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function readSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onEvent: (event: any) => void
): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            if (!line.startsWith('data: ')) continue;
            try {
                const event = JSON.parse(line.substring(6));
                onEvent(event);
            } catch (_e) { /* ignore */ }
        }
    }
}
