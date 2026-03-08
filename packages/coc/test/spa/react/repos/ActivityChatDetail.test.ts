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

    describe('metadataProcess includes processDetails (session ID)', () => {
        it('merges processDetails into metadataProcess', () => {
            // metadataProcess should spread processDetails so fields like sdkSessionId are available
            const metaBlock = source.substring(
                source.indexOf('const metadataProcess'),
                source.indexOf('const metadataProcess') + 400,
            );
            expect(metaBlock).toContain('processDetails');
        });

        it('spreads processDetails onto the metadata object', () => {
            const metaBlock = source.substring(
                source.indexOf('const metadataProcess'),
                source.indexOf('const metadataProcess') + 400,
            );
            expect(metaBlock).toContain('...(processDetails');
        });

        it('includes processDetails in useMemo dependency array', () => {
            const metaBlock = source.substring(
                source.indexOf('const metadataProcess'),
                source.indexOf('const metadataProcess') + 400,
            );
            expect(metaBlock).toContain('processDetails');
            // Verify it's in the dependency array (after the closing bracket)
            const depsSection = source.substring(
                source.indexOf('const metadataProcess'),
                source.indexOf('const metadataProcess') + 600,
            );
            expect(depsSection).toMatch(/\[.*processDetails.*\]/s);
        });
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

    describe('mode selector', () => {
        it('declares selectedMode state with autopilot default', () => {
            expect(source).toContain("useState<'ask' | 'plan' | 'autopilot'>('autopilot')");
        });

        it('renders mode selector with three mode buttons', () => {
            expect(source).toContain('data-testid="mode-selector"');
            expect(source).toContain('data-testid={`mode-${mode}`}');
        });

        it('renders all three mode labels', () => {
            expect(source).toContain("'ask', '💡 Ask'");
            expect(source).toContain("'plan', '📋 Plan'");
            expect(source).toContain("'autopilot', '🤖 Autopilot'");
        });

        it('sends selectedMode in follow-up message body', () => {
            const sendBlock = source.substring(
                source.indexOf('const sendFollowUp'),
                source.indexOf('const sendFollowUp') + 1200,
            );
            expect(sendBlock).toContain('mode: selectedMode');
        });

        it('initializes selectedMode from task payload mode on load', () => {
            expect(source).toContain("setSelectedMode(loadedTask.payload.mode)");
        });

        it('updates selectedMode from process metadata mode', () => {
            expect(source).toContain("setSelectedMode(processMode)");
        });
    });
});
