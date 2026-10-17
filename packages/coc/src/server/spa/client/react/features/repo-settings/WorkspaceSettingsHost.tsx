import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SettingsHost {
    ownerKey: string;
    setTopHost: (node: HTMLDivElement | null) => void;
    setPanelHost: (node: HTMLDivElement | null) => void;
    showPanel: () => void;
    showTop: () => void;
    inPanel: boolean;
}

const SettingsHostContext = createContext<SettingsHost | null>(null);

export function WorkspaceSettingsProvider(props: {
    ownerKey: string;
    topLevelActive: boolean;
    renderPage: (inPanel: boolean) => ReactNode;
    children: ReactNode;
}) {
    return <SettingsOwner key={props.ownerKey} {...props} />;
}

function SettingsOwner({ ownerKey, topLevelActive, renderPage, children }: Parameters<typeof WorkspaceSettingsProvider>[0]) {
    const [topHost, setTopHost] = useState<HTMLDivElement | null>(null);
    const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
    const [parkingHost, setParkingHost] = useState<HTMLDivElement | null>(null);
    const [container] = useState(() => {
        const node = document.createElement('div');
        node.className = 'h-full min-h-0 min-w-0 overflow-hidden';
        return node;
    });
    const [visited, setVisited] = useState(topLevelActive);
    const [preferPanel, setPreferPanel] = useState(!topLevelActive);
    const showPanel = useCallback(() => setPreferPanel(true), []);
    const showTop = useCallback(() => setPreferPanel(false), []);
    useLayoutEffect(() => { setPreferPanel(!topLevelActive); }, [topLevelActive]);
    const inPanel = panelHost !== null && (preferPanel || !topLevelActive);
    const destination = inPanel ? panelHost : topLevelActive ? topHost : parkingHost;
    useLayoutEffect(() => {
        if (topLevelActive || panelHost) setVisited(true);
        // Keep the portal target stable: changing a portal's target remounts the
        // form and destroys pending edits, validation errors and save state.
        destination?.appendChild(container);
        return () => { container.remove(); };
    }, [container, destination, topLevelActive, panelHost]);
    const context = useMemo(() => ({ ownerKey, setTopHost, setPanelHost, showPanel, showTop, inPanel }),
        [ownerKey, showPanel, showTop, inPanel]);
    return (
        <SettingsHostContext.Provider value={context}>
            {children}
            <div hidden ref={setParkingHost} />
            {visited && createPortal(renderPage(inPanel), container)}
        </SettingsHostContext.Provider>
    );
}

export function WorkspaceSettingsSlot({ panel = false, ownerKey, active = false }: { panel?: boolean; ownerKey?: string; active?: boolean }) {
    const host = useContext(SettingsHostContext);
    const matches = host !== null && (ownerKey === undefined || ownerKey === host.ownerKey);
    const showPanel = host?.showPanel;
    useLayoutEffect(() => {
        if (matches && panel && active) showPanel?.();
    }, [matches, panel, active, showPanel]);
    if (!host || (ownerKey !== undefined && ownerKey !== host.ownerKey)) {
        return <div role="status">Settings for this workspace are unavailable.</div>;
    }
    return <>
        <div ref={panel ? host.setPanelHost : host.setTopHost}
            style={{ display: panel === host.inPanel ? undefined : 'none' }}
            className="h-full min-h-0 min-w-0 overflow-hidden" data-testid={panel ? 'panel-settings-host' : 'top-settings-host'} />
        {panel !== host.inPanel && <button type="button" onClick={panel ? host.showPanel : host.showTop}
            className="p-3 text-sm text-[#0969da] dark:text-[#3794ff]">Show Settings here</button>}
    </>;
}

export function useWorkspaceSettingsPanel() {
    const host = useContext(SettingsHostContext);
    return { ownerKey: host?.ownerKey, focusPanel: host?.showPanel };
}
