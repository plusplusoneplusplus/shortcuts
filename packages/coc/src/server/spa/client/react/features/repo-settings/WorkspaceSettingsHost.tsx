import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SettingsHost {
    ownerKey: string;
    attach: (node: HTMLDivElement) => void;
    detach: (node: HTMLDivElement) => void;
}

const SettingsHostContext = createContext<SettingsHost | null>(null);

/**
 * Owns one workspace's Settings page for its right-panel Settings tab. The page
 * mounts on first open and then stays mounted: while no panel slot is attached
 * it is parked in a hidden node, so closing and reopening the tab (or switching
 * chats) keeps pending edits, validation errors and save state.
 */
export function WorkspaceSettingsProvider(props: {
    ownerKey: string;
    renderPage: () => ReactNode;
    children: ReactNode;
}) {
    return <SettingsOwner key={props.ownerKey} {...props} />;
}

function SettingsOwner({ ownerKey, renderPage, children }: Parameters<typeof WorkspaceSettingsProvider>[0]) {
    const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
    const [parkingHost, setParkingHost] = useState<HTMLDivElement | null>(null);
    const [container] = useState(() => {
        const node = document.createElement('div');
        node.className = 'h-full min-h-0 min-w-0 overflow-hidden';
        return node;
    });
    const [visited, setVisited] = useState(false);
    const destination = panelHost ?? parkingHost;
    useLayoutEffect(() => {
        if (panelHost) setVisited(true);
        // Keep the portal target stable: changing a portal's target remounts the
        // form and destroys pending edits, validation errors and save state.
        destination?.appendChild(container);
        return () => { container.remove(); };
    }, [container, destination, panelHost]);
    const attach = useCallback((node: HTMLDivElement) => setPanelHost(node), []);
    // A slot that unmounts after its replacement attached must not clear it.
    const detach = useCallback((node: HTMLDivElement) => setPanelHost(current => (current === node ? null : current)), []);
    const context = useMemo(() => ({ ownerKey, attach, detach }), [ownerKey, attach, detach]);
    return (
        <SettingsHostContext.Provider value={context}>
            {children}
            <div hidden ref={setParkingHost} />
            {visited && createPortal(renderPage(), container)}
        </SettingsHostContext.Provider>
    );
}

/** The right-panel Settings tab body for the owner named by the tab descriptor. */
export function WorkspaceSettingsSlot({ ownerKey }: { ownerKey: string }) {
    const host = useContext(SettingsHostContext);
    const matches = host !== null && ownerKey === host.ownerKey;
    const [node, setNode] = useState<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        if (!host || !matches || !node) return;
        host.attach(node);
        return () => host.detach(node);
    }, [matches, host, node]);
    if (!matches) return <div role="status">Settings for this workspace are unavailable.</div>;
    return <div ref={setNode} className="h-full min-h-0 min-w-0 overflow-hidden" data-testid="panel-settings-host" />;
}

/** The workspace whose Settings page this panel can show, if any. */
export function useWorkspaceSettingsOwner(): string | undefined {
    return useContext(SettingsHostContext)?.ownerKey;
}
