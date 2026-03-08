/**
 * Tests for ActivityChatDetail component — scroll-to-bottom on task selection.
 *
 * Validates that clicking a task forces the chat panel to scroll to the bottom.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ACTIVITY_CHAT_DETAIL_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'ActivityChatDetail.tsx'
);

describe('ActivityChatDetail', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_CHAT_DETAIL_PATH, 'utf-8');
    });

    describe('scroll-to-bottom on task selection', () => {
        it('declares isInitialLoadRef', () => {
            expect(source).toContain('isInitialLoadRef');
        });

        it('sets isInitialLoadRef to true when taskId changes', () => {
            const loadEffect = source.substring(
                source.indexOf('Load task + conversation on mount / taskId change'),
                source.indexOf('Load task + conversation on mount / taskId change') + 300,
            );
            expect(loadEffect).toContain('isInitialLoadRef.current = true');
        });

        it('forces scroll to bottom on initial load using requestAnimationFrame', () => {
            const scrollEffect = source.substring(
                source.indexOf('Scroll to bottom on new turns'),
                source.indexOf('Scroll to bottom on new turns') + 500,
            );
            expect(scrollEffect).toContain('isInitialLoadRef.current');
            expect(scrollEffect).toContain('requestAnimationFrame');
            expect(scrollEffect).toContain('el.scrollTop = el.scrollHeight');
        });

        it('resets isInitialLoadRef after first scroll', () => {
            const scrollEffect = source.substring(
                source.indexOf('Scroll to bottom on new turns'),
                source.indexOf('Scroll to bottom on new turns') + 500,
            );
            expect(scrollEffect).toContain('isInitialLoadRef.current = false');
        });

        it('only scrolls incrementally (near-bottom guard) for subsequent turns', () => {
            const scrollEffect = source.substring(
                source.indexOf('Scroll to bottom on new turns'),
                source.indexOf('Scroll to bottom on new turns') + 700,
            );
            expect(scrollEffect).toContain('dist < 100');
        });
    });
});
