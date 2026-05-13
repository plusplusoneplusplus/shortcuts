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
import { fetchApi } from '../hooks/useApi';
import { isContainerMode } from '../utils/config';

export interface ContainerAgent {
    id: string;
    name: string;
    address: string;
    status: 'online' | 'offline' | 'unknown';
    addedAt?: string;
    lastHealthCheck?: string;
}

export interface ContainerAgentContextValue {
    agents: ContainerAgent[];
    loading: boolean;
    refresh: () => Promise<void>;
    addAgent: (address: string, name?: string) => Promise<ContainerAgent>;
    removeAgent: (id: string) => Promise<void>;
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
            const data = await fetchApi('/container/agents');
            setAgents(Array.isArray(data) ? data : []);
        } catch {
            setAgents([]);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const addAgent = useCallback(async (address: string, name?: string): Promise<ContainerAgent> => {
        const agent = await fetchApi('/container/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, name }),
        });
        await refresh();
        return agent;
    }, [refresh]);

    const removeAgent = useCallback(async (id: string) => {
        await fetchApi(`/container/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refresh();
    }, [refresh]);

    return (
        <ContainerAgentContext.Provider value={{ agents, loading, refresh, addAgent, removeAgent }}>
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
        };
    }
    return ctx;
}
