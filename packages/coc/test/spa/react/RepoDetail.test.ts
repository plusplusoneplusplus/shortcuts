/**
 * Tests for RepoDetail SUB_TABS — verifies the Chat sub-tab is wired.
 */

import { describe, it, expect } from 'vitest';
import { SUB_TABS } from '../../../src/server/spa/client/react/repos/RepoDetail';

describe('RepoDetail SUB_TABS', () => {
    it('includes a "chat" entry', () => {
        const chatTab = SUB_TABS.find(t => t.key === 'chat');
        expect(chatTab).toBeDefined();
        expect(chatTab!.label).toBe('Chat');
    });

    it('"chat" is the last entry', () => {
        const last = SUB_TABS[SUB_TABS.length - 1];
        expect(last.key).toBe('chat');
    });

    it('has exactly 6 entries', () => {
        expect(SUB_TABS).toHaveLength(6);
    });

    it('contains all expected sub-tabs in order', () => {
        const keys = SUB_TABS.map(t => t.key);
        expect(keys).toEqual(['info', 'pipelines', 'tasks', 'queue', 'schedules', 'chat']);
    });
});
