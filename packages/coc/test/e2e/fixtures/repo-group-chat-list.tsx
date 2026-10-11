import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RepoGroupChatList } from '../../../src/server/spa/client/react/repos/RepoGroupChatList';
import { buildRepoGroupChatFeedModel, type RepoGroupChatRow } from '../../../src/server/spa/client/react/repos/repoGroupChatFeed';
import type { RepoGroupChatFeedFilters } from '../../../src/server/spa/client/react/repos/useRepoGroupChatFeed';
import { SplitWorkspacePanel } from '../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';
import { useMobileWorkspacePane } from '../../../src/server/spa/client/react/features/repo-detail/mobileWorkspacePane';

const model = buildRepoGroupChatFeedModel({
    groupId: 'group-demo', membershipKey: 'm1',
    sources: [
        { workspaceId: 'group-demo', role: 'group', name: 'Demo', available: true },
        { workspaceId: 'repo-a', role: 'member', name: 'Connector', available: true },
        { workspaceId: 'repo-b', role: 'member', name: 'Dashboard', available: true },
    ],
    running: [{ id: 'active', processId: 'queue_active', ownerWorkspaceId: 'repo-a', status: 'running', type: 'chat', title: 'Fix relay routing', lastActivityAt: 3000 }],
    queued: [], history: [
        { id: 'group-plan', ownerWorkspaceId: 'group-demo', status: 'completed', type: 'chat', title: 'Group plan', lastActivityAt: 4000 },
        ...Array.from({ length: 30 }, (_, index) => ({
            id: `history-${index}`, ownerWorkspaceId: index % 2 ? 'repo-a' : 'repo-b',
            status: 'completed', type: 'chat', title: `Conversation ${index}`,
            lastActivityAt: 2000 - index * 10,
            ...(index === 29 ? { pinnedAt: '2026-10-10T00:00:00Z' } : {}),
        })),
    ],
    hasMore: false, counts: { total: 32, running: 1, queued: 0, history: 31, unread: 3, byOwner: {}, partial: false },
}, 'local');

function List({ selected, onSelect }: { selected: RepoGroupChatRow | null; onSelect: (row: RepoGroupChatRow) => void }) {
    const mobile = useMobileWorkspacePane();
    const [filters, setFilters] = useState<RepoGroupChatFeedFilters>({});
    return <RepoGroupChatList feed={{ model, status: 'ready', loadingMore: false, loadMore: async () => {} }}
        serverLabel="This server" selectedKey={selected?.key ?? null} filters={filters} onFiltersChange={setFilters}
        onSelect={row => { onSelect(row); mobile?.setDetailOpen(true); mobile?.setPane('chat'); }} />;
}
function App() {
    const [selected, setSelected] = useState<RepoGroupChatRow | null>(null);
    return <div style={{ height: '100vh' }}>
        <SplitWorkspacePanel workspaceId="group-demo"
            chatList={<List selected={selected} onSelect={setSelected} />}
            gitList={<div data-testid="member-git">Member Git</div>}
            mobileChatBackLabel="Back to group chats" onMobileChatBack={() => setSelected(null)}
            detail={<div data-testid="conversation" style={{ padding: 12 }}>
                {selected ? <><div data-testid="owner-header">{selected.ownerName} / {selected.ownerWorkspaceId}</div>
                    <div>{selected.item.title ?? selected.item.displayName}</div></> : 'Select a chat'}
            </div>} />
    </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
