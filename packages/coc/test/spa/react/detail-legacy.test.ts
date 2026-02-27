/**
 * Tests for detail.ts — verify image paste TODO comment exists.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DETAIL_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'detail.ts'
);

describe('detail.ts legacy', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(DETAIL_PATH, 'utf-8');
    });

    it('has TODO comment for image paste support on sendFollowUpMessage', () => {
        expect(source).toContain('TODO(chat-image-attach)');
        // Verify the TODO is associated with the sendFollowUpMessage function
        const todoIdx = source.indexOf('TODO(chat-image-attach)');
        const fnIdx = source.indexOf('function sendFollowUpMessage');
        expect(todoIdx).toBeLessThan(fnIdx);
        expect(fnIdx - todoIdx).toBeLessThan(200);
    });

    it('references React QueueTaskDetail as the supported path', () => {
        expect(source).toContain('React QueueTaskDetail already supports images');
    });
});
