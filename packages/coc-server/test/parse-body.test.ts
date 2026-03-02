import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { parseBody } from '../src/api-handler';
import * as http from 'http';

/** Create a fake IncomingMessage from a string (or no data). */
function fakeRequest(data?: string): http.IncomingMessage {
    const readable = new Readable({
        read() {
            if (data !== undefined) {
                this.push(Buffer.from(data, 'utf-8'));
            }
            this.push(null);
        },
    });
    return readable as unknown as http.IncomingMessage;
}

describe('parseBody', () => {
    it('should parse valid JSON body', async () => {
        const result = await parseBody(fakeRequest(JSON.stringify({ key: 'value' })));
        expect(result).toEqual({ key: 'value' });
    });

    it('should return empty object for empty body', async () => {
        const result = await parseBody(fakeRequest());
        expect(result).toEqual({});
    });

    it('should return empty object for whitespace-only body', async () => {
        const result = await parseBody(fakeRequest('   '));
        expect(result).toEqual({});
    });

    it('should reject on invalid JSON', async () => {
        await expect(parseBody(fakeRequest('not json'))).rejects.toThrow('Invalid JSON');
    });
});
