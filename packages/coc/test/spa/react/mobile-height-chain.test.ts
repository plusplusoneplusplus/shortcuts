import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const repoDetailSource = readFileSync(
    resolve(__dirname, '../../../src/server/spa/client/react/features/repo-detail/RepoDetail.tsx'),
    'utf-8',
);

const repoChatTabSource = readFileSync(
    resolve(__dirname, '../../../src/server/spa/client/react/features/chat/RepoChatTab.tsx'),
    'utf-8',
);

describe('mobile repo tab height chain', () => {
    it('keeps RepoDetail sub-tab content in a flex column height chain', () => {
        expect(repoDetailSource).toContain('id="repo-sub-tab-content" className={cn("flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden")}');
        expect(repoDetailSource).toContain('<div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">');
        expect(repoDetailSource).toContain('className={cn("flex flex-col flex-1 min-h-0 min-w-0", activeSubTab ===');
    });

    it('uses flex-1 min-h-0 for all display-toggled RepoDetail panes', () => {
        // Accept both simple `activeSubTab === 'X'` and compound predicates
        // like `(activeSubTab === 'activity' || activeSubTab === 'chats')` —
        // the chat-surface wrapper uses the compound form so cross-mode URLs
        // still render in either UI layout mode.
        const simple = /style=\{\{ display: activeSubTab === '[^']+' \? undefined : 'none' \}\} className="([^"]+)"/g;
        const compound = /style=\{\{ display: \(activeSubTab === '[^']+'(?: \|\| activeSubTab === '[^']+')+\) \? undefined : 'none' \}\} className="([^"]+)"/g;
        const paneClasses = [
            ...Array.from(repoDetailSource.matchAll(simple), match => match[1]),
            ...Array.from(repoDetailSource.matchAll(compound), match => match[1]),
        ];

        expect(paneClasses).toHaveLength(9);
        expect(paneClasses).toEqual(Array(9).fill('flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden'));
    });

    it('keeps the RepoChatTab mobile root in the flex height chain', () => {
        expect(repoChatTabSource).toContain(
            '<div className="flex flex-col flex-1 min-h-0 overflow-hidden" data-testid="activity-split-panel">',
        );
        expect(repoChatTabSource).not.toContain(
            '<div className="flex flex-col h-full overflow-hidden" data-testid="activity-split-panel">',
        );
    });
});
