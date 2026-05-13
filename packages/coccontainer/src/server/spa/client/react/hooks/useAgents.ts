/**
 * Hook for managing agents via the container API.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Agent } from '../types';

function getApiBase(): string {
    return '';
}

async function fetchApi(path: string, options?: RequestInit): Promise<any> {
    const url = getApiBase() + path;
    const res = await fetch(url, options ?? {});
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `API error: ${res.status}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
}

export function useAgents() {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            setLoading(true);
            const data = await fetchApi('/api/agents');
            setAgents(data);
        } catch (err) {
            console.error('Failed to fetch agents:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 30000);
        return () => clearInterval(interval);
    }, [refresh]);

    const addAgent = useCallback(async (address: string, name?: string) => {
        const agent = await fetchApi('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, name: name || undefined }),
        });
        setAgents(prev => [...prev, agent]);
        return agent;
    }, []);

    const removeAgent = useCallback(async (id: string) => {
        await fetchApi(`/api/agents/${id}`, { method: 'DELETE' });
        setAgents(prev => prev.filter(a => a.id !== id));
    }, []);

    return { agents, loading, refresh, addAgent, removeAgent };
}

export { fetchApi };
