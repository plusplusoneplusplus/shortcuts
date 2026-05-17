/**
 * ContainerAgentContext — manages remote CoC agents in container mode.
 * Only active when containerMode is true in dashboard config.
 * Provides agent CRUD and the current agent list to the entire app.
 */

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    type ReactNode,
} from 'react';
import { isContainerMode, getRawApiBase } from '../utils/config';

/** Fetch from container-level endpoints (not agent-proxied). */
async function fetchContainerApi(path: string, options?: RequestInit): Promise<any> {
    const url = getRawApiBase() + path;
    const res = await fetch(url, options ?? {});
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    if (res.status === 204) return undefined;
    return res.json();
}

export interface ContainerAgent {
    id: string;
    name: string;
    address: string;
    tunnelId?: string;
    bridgeUrl?: string;
    status: 'online' | 'offline' | 'unknown';
    addedAt?: number;
    lastHealthCheck?: number;
}

export interface ContainerAgentContextValue {
    agents: ContainerAgent[];
    loading: boolean;
    refresh: () => Promise<void>;
    addAgent: (address: string, name?: string, tunnelId?: string) => Promise<ContainerAgent>;
    removeAgent: (id: string) => Promise<void>;
    renameAgent: (id: string, name: string) => Promise<ContainerAgent>;
    updateAgent: (id: string, fields: { name?: string; address?: string; tunnelId?: string | null }) => Promise<ContainerAgent>;
}

const ContainerAgentContext = createContext<ContainerAgentContextValue | null>(null);

export function ContainerAgentProvider({ children }: { children: ReactNode }) {
    const [agents, setAgents] = useState<ContainerAgent[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        if (!isContainerMode()) {
            setAgents([]);
            setLoading(false);
            return;
        }
        try {
            const data = await fetchContainerApi('/container/agents');
            const list: ContainerAgent[] = Array.isArray(data) ? data : [];
            setAgents(list);
        } catch {
            setAgents([]);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const addAgent = useCallback(async (address: string, name?: string, tunnelId?: string): Promise<ContainerAgent> => {
        const agent = await fetchContainerApi('/container/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, name, tunnelId }),
        });
        await refresh();
        return agent;
    }, [refresh]);

    const removeAgent = useCallback(async (id: string) => {
        await fetchContainerApi(`/container/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refresh();
    }, [refresh]);

    const renameAgent = useCallback(async (id: string, name: string): Promise<ContainerAgent> => {
        const agent = await fetchContainerApi(`/container/agents/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        await refresh();
        return agent;
    }, [refresh]);

    const updateAgent = useCallback(async (id: string, fields: { name?: string; address?: string; tunnelId?: string | null }): Promise<ContainerAgent> => {
        const agent = await fetchContainerApi(`/container/agents/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
        });
        await refresh();
        return agent;
    }, [refresh]);

    return (
        <ContainerAgentContext.Provider value={{ agents, loading, refresh, addAgent, removeAgent, renameAgent, updateAgent }}>
            {children}
        </ContainerAgentContext.Provider>
    );
}

export function useContainerAgents(): ContainerAgentContextValue {
    const ctx = useContext(ContainerAgentContext);
    if (!ctx) {
        // Return a no-op context when not in container mode or not wrapped
        return {
            agents: [],
            loading: false,
            refresh: async () => {},
            addAgent: async () => { throw new Error('Not in container mode'); },
            removeAgent: async () => { throw new Error('Not in container mode'); },
            renameAgent: async () => { throw new Error('Not in container mode'); },
            updateAgent: async () => { throw new Error('Not in container mode'); },
        };
    }
    return ctx;
}
