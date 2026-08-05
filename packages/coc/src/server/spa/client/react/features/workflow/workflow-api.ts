/**
 * Typed API client for workflow CRUD endpoints.
 *
 * Every call here is workspace-scoped, so it resolves its client through
 * `getCocClientForWorkspace(workspaceId)`: a remote clone's workflow REST goes to
 * that clone's server, a local id misses the registry and falls back to the
 * default origin client (unchanged local behavior).
 */

import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { getCocClientForWorkspace } from '../../repos/cloneRegistry';
import type {
    WorkflowDefinition,
    GenerateWorkflowResponse,
    RunWorkflowResponse,
} from '@plusplusoneplusplus/coc-client';

export type GenerateResult = GenerateWorkflowResponse;
export type RefineResult = GenerateWorkflowResponse;

export async function fetchWorkflows(workspaceId: string): Promise<WorkflowDefinition[]> {
    try {
        return await getCocClientForWorkspace(workspaceId).workflow.list(workspaceId);
    } catch (err) {
        throw new Error(getSpaCocClientErrorMessage(err, 'Failed to fetch workflows'));
    }
}

export async function fetchWorkflowContent(
    workspaceId: string,
    pipelineName: string
): Promise<{ content: string; path: string }> {
    try {
        return await getCocClientForWorkspace(workspaceId).workflow.content(workspaceId, pipelineName);
    } catch (err) {
        throw new Error(getSpaCocClientErrorMessage(err, 'Failed to fetch workflow content'));
    }
}

export async function saveWorkflowContent(
    workspaceId: string,
    pipelineName: string,
    content: string
): Promise<void> {
    try {
        await getCocClientForWorkspace(workspaceId).workflow.saveContent(workspaceId, pipelineName, content);
    } catch (err) {
        throw new Error(getSpaCocClientErrorMessage(err, 'Failed to save workflow'));
    }
}

export async function generateWorkflow(
    workspaceId: string,
    name: string | undefined,
    description: string,
    signal?: AbortSignal
): Promise<GenerateResult> {
    try {
        return await getCocClientForWorkspace(workspaceId).workflow.generate(
            workspaceId,
            { description, name },
            { signal },
        );
    } catch (err) {
        throw new Error(getSpaCocClientErrorMessage(err, 'Failed to generate workflow'));
    }
}

export async function refineWorkflow(
    workspaceId: string,
    pipelineName: string,
    instruction: string,
    currentYaml: string,
    model?: string,
    signal?: AbortSignal
): Promise<RefineResult> {
    try {
        return await getCocClientForWorkspace(workspaceId).workflow.refine(
            workspaceId,
            { instruction, currentYaml, model },
            { signal },
        );
    } catch (err) {
        throw new Error(getSpaCocClientErrorMessage(err, 'Failed to refine workflow'));
    }
}

export async function createWorkflow(
    workspaceId: string,
    name: string,
    template?: string,
    content?: string
): Promise<void> {
    try {
        await getCocClientForWorkspace(workspaceId).workflow.create(workspaceId, { name, template, content });
    } catch (err) {
        throw new Error(getSpaCocClientErrorMessage(err, 'Failed to create workflow'));
    }
}

export async function deleteWorkflow(
    workspaceId: string,
    pipelineName: string
): Promise<void> {
    try {
        await getCocClientForWorkspace(workspaceId).workflow.delete(workspaceId, pipelineName);
    } catch (err) {
        throw new Error(getSpaCocClientErrorMessage(err, 'Failed to delete workflow'));
    }
}

export async function runWorkflow(
    workspaceId: string,
    pipelineName: string
): Promise<RunWorkflowResponse> {
    try {
        return await getCocClientForWorkspace(workspaceId).workflow.run(workspaceId, pipelineName);
    } catch (err) {
        throw new Error(getSpaCocClientErrorMessage(err, 'Failed to run workflow'));
    }
}
