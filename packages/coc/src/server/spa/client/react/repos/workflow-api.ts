/**
 * Typed API client for workflow CRUD endpoints.
 * Uses raw fetch() + getApiBase() for full HTTP method support.
 */

import { getApiBase } from '../utils/config';
import type { PipelineInfo } from './repoGrouping';

function workflowsUrl(workspaceId: string): string {
    return `${getApiBase()}/workspaces/${encodeURIComponent(workspaceId)}/workflows`;
}

function workflowUrl(workspaceId: string, name: string): string {
    return `${workflowsUrl(workspaceId)}/${encodeURIComponent(name)}`;
}

function workflowContentUrl(workspaceId: string, name: string): string {
    return `${workflowUrl(workspaceId, name)}/content`;
}

function workflowRefineUrl(workspaceId: string): string {
    return `${workflowsUrl(workspaceId)}/refine`;
}

export async function fetchWorkflows(workspaceId: string): Promise<PipelineInfo[]> {
    const res = await fetch(workflowsUrl(workspaceId));
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return data.workflows || [];
}

export async function fetchWorkflowContent(
    workspaceId: string,
    pipelineName: string
): Promise<{ content: string; path: string }> {
    const res = await fetch(workflowContentUrl(workspaceId, pipelineName));
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

export async function saveWorkflowContent(
    workspaceId: string,
    pipelineName: string,
    content: string
): Promise<void> {
    const res = await fetch(workflowContentUrl(workspaceId, pipelineName), {
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
    validationError?: string;
    suggestedName?: string;
}

export interface RefineResult {
    yaml: string;
    valid: boolean;
    validationError?: string;
    suggestedName?: string;
}

export async function generateWorkflow(
    workspaceId: string,
    name: string | undefined,
    description: string,
    signal?: AbortSignal
): Promise<GenerateResult> {
    const body: Record<string, string> = { description };
    if (name) {
        body.name = name;
    }
    const res = await fetch(`${workflowsUrl(workspaceId)}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

export async function refineWorkflow(
    workspaceId: string,
    pipelineName: string,
    instruction: string,
    currentYaml: string,
    model?: string,
    signal?: AbortSignal
): Promise<RefineResult> {
    const body: Record<string, string> = { instruction, currentYaml };
    if (model !== undefined) {
        body.model = model;
    }
    const res = await fetch(workflowRefineUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

export async function createWorkflow(
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
    const res = await fetch(workflowsUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
}

export async function deleteWorkflow(
    workspaceId: string,
    pipelineName: string
): Promise<void> {
    const res = await fetch(workflowUrl(workspaceId, pipelineName), {
        method: 'DELETE',
    });
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
}

export async function runWorkflow(
    workspaceId: string,
    pipelineName: string
): Promise<{ task: any }> {
    const res = await fetch(`${workflowUrl(workspaceId, pipelineName)}/run`, {
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
