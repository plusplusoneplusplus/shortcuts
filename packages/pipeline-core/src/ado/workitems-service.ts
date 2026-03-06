import type { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import type {
    WorkItem,
    WorkItemExpand,
    WorkItemQueryResult,
    Comment,
    CommentList,
} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type * as VSSInterfaces from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type { WebApi } from 'azure-devops-node-api';

/** Patch operation type for JSON Patch documents. */
export type PatchOp = 'add' | 'replace' | 'remove';

/** A single field patch entry. */
export interface FieldPatch {
    op: PatchOp;
    /** e.g. '/fields/System.Title' */
    path: string;
    value?: unknown;
}

/** Error class for work-item operations. */
export class AdoWorkItemError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = 'AdoWorkItemError';
    }
}

const MAX_BULK_IDS = 200;

/**
 * Ergonomic wrapper around `IWorkItemTrackingApi` for common work-item
 * operations: fetch, create, update, WIQL query, and comments.
 */
export class AdoWorkItemsService {
    constructor(private readonly connection: WebApi) {}

    // ── fetch ────────────────────────────────────────────────

    async getWorkItem(
        id: number,
        project?: string,
        fields?: string[],
        expand?: WorkItemExpand,
    ): Promise<WorkItem> {
        const client = await this.getClient();
        try {
            return await client.getWorkItem(id, fields, undefined, expand, project);
        } catch (err) {
            throw new AdoWorkItemError(`Failed to get work item ${id}`, err);
        }
    }

    /**
     * Fetch multiple work items by ID.
     * @throws {AdoWorkItemError} if `ids.length` exceeds 200 (ADO API limit).
     */
    async getWorkItems(
        ids: number[],
        project?: string,
        fields?: string[],
        expand?: WorkItemExpand,
    ): Promise<WorkItem[]> {
        if (ids.length > MAX_BULK_IDS) {
            throw new AdoWorkItemError(
                `Cannot fetch more than ${MAX_BULK_IDS} work items at once (got ${ids.length}). Chunk the IDs before calling this method.`,
            );
        }
        const client = await this.getClient();
        try {
            return await client.getWorkItems(ids, fields, undefined, expand, undefined, project);
        } catch (err) {
            throw new AdoWorkItemError(`Failed to get work items [${ids.join(', ')}]`, err);
        }
    }

    // ── mutate ───────────────────────────────────────────────

    async createWorkItem(
        project: string,
        type: string,
        fields: Record<string, unknown>,
    ): Promise<WorkItem> {
        const document = AdoWorkItemsService.toDocument(fields);
        const client = await this.getClient();
        try {
            return await client.createWorkItem({}, document, project, type);
        } catch (err) {
            throw new AdoWorkItemError(`Failed to create ${type} in ${project}`, err);
        }
    }

    async updateWorkItem(
        id: number,
        fields: Record<string, unknown>,
        project?: string,
    ): Promise<WorkItem> {
        const document = AdoWorkItemsService.toDocument(fields);
        const client = await this.getClient();
        try {
            return await client.updateWorkItem({}, document, id, project);
        } catch (err) {
            throw new AdoWorkItemError(`Failed to update work item ${id}`, err);
        }
    }

    // ── query ────────────────────────────────────────────────

    async queryByWiql(
        query: string,
        project?: string,
        top?: number,
    ): Promise<WorkItemQueryResult> {
        const client = await this.getClient();
        const teamContext = project ? { project } : undefined;
        try {
            return await client.queryByWiql({ query }, teamContext, undefined, top);
        } catch (err) {
            throw new AdoWorkItemError('Failed to execute WIQL query', err);
        }
    }

    // ── comments ─────────────────────────────────────────────

    async getComments(project: string, workItemId: number): Promise<CommentList> {
        const client = await this.getClient();
        try {
            return await client.getComments(project, workItemId);
        } catch (err) {
            throw new AdoWorkItemError(`Failed to get comments for work item ${workItemId}`, err);
        }
    }

    async addComment(project: string, workItemId: number, text: string): Promise<Comment> {
        const client = await this.getClient();
        try {
            return await client.addComment({ text }, project, workItemId);
        } catch (err) {
            throw new AdoWorkItemError(`Failed to add comment to work item ${workItemId}`, err);
        }
    }

    // ── internals ────────────────────────────────────────────

    private async getClient(): Promise<IWorkItemTrackingApi> {
        try {
            return await this.connection.getWorkItemTrackingApi();
        } catch (err) {
            throw new AdoWorkItemError('Failed to get WorkItemTracking API client', err);
        }
    }

    /** Convert a field-name → value record into a `JsonPatchDocument`. */
    private static toDocument(
        fields: Record<string, unknown>,
        op: PatchOp = 'add',
    ): VSSInterfaces.JsonPatchDocument {
        return Object.entries(fields).map(([key, value]) => ({
            op,
            path: `/fields/${key}`,
            value,
        })) as VSSInterfaces.JsonPatchDocument;
    }
}
