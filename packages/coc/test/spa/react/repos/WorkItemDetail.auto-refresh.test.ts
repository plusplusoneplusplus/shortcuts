/**
 * Tests for WorkItemDetail auto-refresh via WorkItemContext WebSocket events.
 *
 * Verifies that:
 * - The component subscribes to WorkItemContext for the displayed item
 * - When the context item updates (status/updatedAt change), the detail re-fetches
 * - When the item is removed from context, the detail navigates back
 * - No duplicate fetches on initial mount
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const WORK_ITEM_DETAIL_SRC_PATH = path.join(REACT_SRC, 'features', 'work-items', 'WorkItemDetail.tsx');

describe('WorkItemDetail — auto-refresh via context', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(WORK_ITEM_DETAIL_SRC_PATH, 'utf-8');
    });

    describe('context subscription', () => {
        it('imports useWorkItems from WorkItemContext', () => {
            expect(src).toMatch(/import\s*\{[^}]*useWorkItems[^}]*\}\s*from\s*['"]\.\.\/\.\.\/contexts\/WorkItemContext['"]/);
        });

        it('calls useWorkItems() to access context state', () => {
            expect(src).toContain('useWorkItems()');
        });

        it('looks up context items for the current origin scope', () => {
            expect(src).toContain('workItemsByRepo[workItemOriginId]');
        });

        it('finds the current item in context by workItemId', () => {
            expect(src).toMatch(/contextItems\.find\(\s*i\s*=>\s*i\.id\s*===\s*workItemId\s*\)/);
        });
    });

    describe('auto-refresh on update', () => {
        it('imports useRef from React', () => {
            expect(src).toMatch(/import\s*\{[^}]*useRef[^}]*\}\s*from\s*['"]react['"]/);
        });

        it('tracks last context updatedAt with a ref', () => {
            expect(src).toContain('lastContextUpdatedAt');
            expect(src).toMatch(/useRef<string\s*\|\s*undefined>/);
        });

        it('has a useEffect that depends on contextItem.updatedAt', () => {
            expect(src).toContain('contextItem?.updatedAt');
        });

        it('calls fetchItem() when context updatedAt changes', () => {
            // The effect should compare previous and current updatedAt
            expect(src).toContain('prev !== contextItem.updatedAt');
            // And call fetchItem when they differ
            const comparePos = src.indexOf('prev !== contextItem.updatedAt');
            const fetchPos = src.indexOf('fetchItem()', comparePos);
            expect(fetchPos).toBeGreaterThan(comparePos);
            // But the fetchItem call should be close (within the same effect body)
            expect(fetchPos - comparePos).toBeLessThan(100);
        });

        it('skips re-fetch on initial observation (no prev value)', () => {
            expect(src).toContain('prev !== undefined');
        });
    });

    describe('navigate back on deletion', () => {
        it('tracks whether context item was previously present', () => {
            expect(src).toContain('contextItemWasPresent');
        });

        it('calls onBack when item disappears from context', () => {
            // Should check that item was present before and is now gone
            expect(src).toContain('contextItemWasPresent.current && !contextItem');
            // Should close the associated chat lens before navigating back
            const effectBody = src.slice(
                src.indexOf('Navigate back when the item is deleted'),
                src.indexOf('// ── Unified dirty tracking'),
            );
            expect(effectBody).toContain('closeWorkItemChat()');
            expect(effectBody).toContain('onBack?.()');
            expect(effectBody.indexOf('closeWorkItemChat()')).toBeLessThan(effectBody.indexOf('onBack?.()'));
        });

        it('does not navigate back if context item was never present', () => {
            // The ref starts as false, so deletion is only detected after the item was seen
            expect(src).toContain('useRef(false)');
        });
    });

    describe('no unnecessary re-renders', () => {
        it('uses useCallback for fetchItem', () => {
            expect(src).toMatch(/const fetchItem\s*=\s*useCallback/);
        });

        it('fetchItem dependency includes workspace, origin, and work item IDs', () => {
            expect(src).toContain('[workspaceId, workItemOriginId, workItemId, cloneClient]');
        });

        it('auto-refresh effect depends on fetchItem for stability', () => {
            // The effect that calls fetchItem should have fetchItem in its dependency array
            // Find the effect that contains the auto-refresh logic
            const effectBody = src.slice(
                src.indexOf('Re-fetch full detail when the context item updates'),
                src.indexOf('Navigate back when the item is deleted')
            );
            expect(effectBody).toContain('fetchItem');
        });
    });
});
