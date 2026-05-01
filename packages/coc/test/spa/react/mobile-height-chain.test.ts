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
        const displayToggledPanePattern = /style=\{\{ display: activeSubTab === '[^']+' \? undefined : 'none' \}\} className="([^"]+)"/g;
        const paneClasses = Array.from(repoDetailSource.matchAll(displayToggledPanePattern), match => match[1]);

        expect(paneClasses).toHaveLength(7);
        expect(paneClasses).toEqual(Array(7).fill('flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden'));
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
