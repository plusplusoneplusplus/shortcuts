/**
 * useCreateKustoCanvas (AC-07) — create a blank Kusto canvas, prefilling
 * cluster/database from the workspace's most recent Kusto canvas.
 *
 * The prefill is best-effort: a failed list/get falls back to an empty seed
 * rather than blocking creation.
 */

import { useCallback, useState } from 'react';
import type { Canvas, CanvasSummary, CocClient } from '@plusplusoneplusplus/coc-client';
import { buildBlankKustoContent, extractKustoSeed, pickLatestKustoCanvas } from '../kustoCreate';

export interface UseCreateKustoCanvasOptions {
    client: CocClient;
    workspaceId: string;
    canvasRef: React.MutableRefObject<Canvas | null>;
    availableCanvases: CanvasSummary[];
    onCanvasCreated?: (canvasId: string) => void;
    onSelectCanvas?: (canvasId: string) => void;
    notify: (message: string, kind: 'error' | 'info') => void;
}

export interface CreateKustoCanvas {
    creating: boolean;
    create: () => Promise<void>;
}

export function useCreateKustoCanvas({
    client, workspaceId, canvasRef, availableCanvases, onCanvasCreated, onSelectCanvas, notify,
}: UseCreateKustoCanvasOptions): CreateKustoCanvas {
    const [creating, setCreating] = useState(false);

    const create = useCallback(async () => {
        if (creating) return;
        setCreating(true);
        try {
            let seed = { clusterUrl: '', database: '' };
            try {
                const all = await client.canvases.list(workspaceId);
                const latest = pickLatestKustoCanvas(all);
                if (latest) {
                    const full = await client.canvases.get(workspaceId, latest.id);
                    seed = extractKustoSeed(full.content);
                }
            } catch {
                // Prefill is best-effort — fall back to an empty seed.
            }
            const processId = canvasRef.current?.processId
                ?? availableCanvases.find(c => c.processId)?.processId;
            const created = await client.canvases.create(workspaceId, {
                type: 'kusto',
                title: 'Kusto Query',
                content: buildBlankKustoContent(seed),
                ...(processId ? { processId } : {}),
            });
            onCanvasCreated?.(created.id);
            onSelectCanvas?.(created.id);
        } catch {
            notify('Failed to create Kusto query', 'error');
        } finally {
            setCreating(false);
        }
    }, [creating, client, workspaceId, availableCanvases, onCanvasCreated, onSelectCanvas, notify]);

    return { creating, create };
}
