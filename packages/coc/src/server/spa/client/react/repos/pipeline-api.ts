/**
 * Typed API client for pipeline CRUD endpoints.
 * Uses raw fetch() + getApiBase() for full HTTP method support.
 */

import { getApiBase } from '../utils/config';
import type { PipelineInfo } from './repoGrouping';

function pipelinesUrl(workspaceId: string): string {
    return `${getApiBase()}/workspaces/${encodeURIComponent(workspaceId)}/pipelines`;
}

function pipelineUrl(workspaceId: string, name: string): string {
    return `${pipelinesUrl(workspaceId)}/${encodeURIComponent(name)}`;
}

function pipelineContentUrl(workspaceId: string, name: string): string {
    return `${pipelineUrl(workspaceId, name)}/content`;
}

export async function fetchPipelines(workspaceId: string): Promise<PipelineInfo[]> {
    const res = await fetch(pipelinesUrl(workspaceId));
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return data.pipelines || [];
}

export async function fetchPipelineContent(
    workspaceId: string,
    pipelineName: string
): Promise<{ content: string; path: string }> {
    const res = await fetch(pipelineContentUrl(workspaceId, pipelineName));
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

export async function savePipelineContent(
    workspaceId: string,
    pipelineName: string,
    content: string
): Promise<void> {
    const res = await fetch(pipelineContentUrl(workspaceId, pipelineName), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
}

export async function createPipeline(
    workspaceId: string,
    name: string,
    template?: string
): Promise<void> {
    const body: Record<string, string> = { name };
    if (template !== undefined) {
        body.template = template;
    }
    const res = await fetch(pipelinesUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
}

export async function deletePipeline(
    workspaceId: string,
    pipelineName: string
): Promise<void> {
    const res = await fetch(pipelineUrl(workspaceId, pipelineName), {
        method: 'DELETE',
    });
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
}
