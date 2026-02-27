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

export interface GenerateResult {
    yaml: string;
    valid: boolean;
    errors?: string[];
}

export async function generatePipeline(
    workspaceId: string,
    name: string,
    description: string,
    signal?: AbortSignal
): Promise<GenerateResult> {
    const res = await fetch(`${pipelinesUrl(workspaceId)}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
        signal,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

export async function createPipeline(
    workspaceId: string,
    name: string,
    template?: string,
    content?: string
): Promise<void> {
    const body: Record<string, string> = { name };
    if (template !== undefined) {
        body.template = template;
    }
    if (content !== undefined) {
        body.content = content;
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

export async function runPipeline(
    workspaceId: string,
    pipelineName: string
): Promise<{ task: any }> {
    const res = await fetch(`${pipelineUrl(workspaceId, pipelineName)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}
