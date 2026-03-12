import type { IWorkItemsService } from '../providers/interfaces';
import type {
    Comment,
    CreateWorkItemInput,
    Identity,
    UpdateWorkItemInput,
    WorkItem,
} from '../providers/types';
import type { AdoWorkItemsService } from './workitems-service';

// ── mapping helpers ──────────────────────────────────────────

function mapAdoIdentity(ref: { id?: string; displayName?: string; uniqueName?: string; imageUrl?: string } | undefined): Identity {
    return {
        id: ref?.id ?? '',
        displayName: ref?.displayName ?? '',
        email: ref?.uniqueName,
        avatarUrl: ref?.imageUrl,
    };
}

type AdoRawWorkItem = {
    id?: number;
    fields?: Record<string, unknown>;
    url?: string;
    _links?: { html?: { href?: string } };
};

function mapAdoWorkItem(wi: AdoRawWorkItem, projectId?: string): WorkItem {
    const fields = wi.fields ?? {};

    const assignedTo = fields['System.AssignedTo'] as { id?: string; displayName?: string; uniqueName?: string } | undefined;
    const createdBy = fields['System.CreatedBy'] as { id?: string; displayName?: string; uniqueName?: string } | undefined;
    const createdDate = fields['System.CreatedDate'] as string | Date | undefined;
    const changedDate = fields['System.ChangedDate'] as string | Date | undefined;
    const closedDate = fields['Microsoft.VSTS.Common.ClosedDate'] as string | Date | undefined;

    return {
        id: wi.id ?? 0,
        title: (fields['System.Title'] as string) ?? '',
        type: (fields['System.WorkItemType'] as string) ?? '',
        state: (fields['System.State'] as string) ?? '',
        assignees: assignedTo ? [mapAdoIdentity(assignedTo)] : [],
        author: mapAdoIdentity(createdBy),
        description: (fields['System.Description'] as string) ?? '',
        priority: fields['Microsoft.VSTS.Common.Priority'] as number | undefined,
        labels: [],
        createdAt: createdDate ? new Date(createdDate) : new Date(0),
        updatedAt: changedDate ? new Date(changedDate) : new Date(0),
        closedAt: closedDate ? new Date(closedDate) : undefined,
        url: (wi._links?.html?.href ?? wi.url) ?? '',
        projectId: (fields['System.TeamProject'] as string) ?? projectId,
        raw: wi,
    };
}

type AdoRawComment = {
    id?: number;
    createdBy?: { id?: string; displayName?: string; uniqueName?: string };
    text?: string;
    createdDate?: string | Date;
    modifiedDate?: string | Date;
    url?: string;
};

function mapAdoComment(c: AdoRawComment): Comment {
    return {
        id: c.id ?? 0,
        author: mapAdoIdentity(c.createdBy),
        body: c.text ?? '',
        createdAt: c.createdDate ? new Date(c.createdDate) : new Date(0),
        updatedAt: c.modifiedDate ? new Date(c.modifiedDate) : undefined,
        url: c.url,
    };
}

// ── adapter ──────────────────────────────────────────────────

/**
 * Adapter that wraps `AdoWorkItemsService` and implements the
 * provider-agnostic `IWorkItemsService` interface.
 */
export class AdoWorkItemsAdapter implements IWorkItemsService {
    constructor(private readonly service: AdoWorkItemsService) {}

    async getWorkItem(id: number | string, projectId?: string): Promise<WorkItem> {
        const wi = await this.service.getWorkItem(Number(id), projectId);
        return mapAdoWorkItem(wi as AdoRawWorkItem, projectId);
    }

    async getWorkItems(ids: Array<number | string>, projectId?: string): Promise<WorkItem[]> {
        const wiItems = await this.service.getWorkItems(ids.map(Number), projectId);
        return wiItems.map(wi => mapAdoWorkItem(wi as AdoRawWorkItem, projectId));
    }

    async createWorkItem(projectId: string, type: string, input: CreateWorkItemInput): Promise<WorkItem> {
        const fields: Record<string, unknown> = {
            'System.Title': input.title,
        };
        if (input.description !== undefined) { fields['System.Description'] = input.description; }
        if (input.priority !== undefined) { fields['Microsoft.VSTS.Common.Priority'] = input.priority; }

        const wi = await this.service.createWorkItem(projectId, type, fields);
        return mapAdoWorkItem(wi as AdoRawWorkItem, projectId);
    }

    async updateWorkItem(
        id: number | string,
        update: UpdateWorkItemInput,
        projectId?: string,
    ): Promise<WorkItem> {
        const fields: Record<string, unknown> = {};
        if (update.title !== undefined) { fields['System.Title'] = update.title; }
        if (update.description !== undefined) { fields['System.Description'] = update.description; }
        if (update.state !== undefined) { fields['System.State'] = update.state; }
        if (update.priority !== undefined) { fields['Microsoft.VSTS.Common.Priority'] = update.priority; }

        const wi = await this.service.updateWorkItem(Number(id), fields, projectId);
        return mapAdoWorkItem(wi as AdoRawWorkItem, projectId);
    }

    async searchWorkItems(query: string, projectId?: string, top?: number): Promise<WorkItem[]> {
        const result = await this.service.queryByWiql(query, projectId, top);
        const ids = (result.workItems ?? [])
            .map((ref: { id?: number }) => ref.id)
            .filter((id): id is number => id !== undefined);

        if (ids.length === 0) { return []; }

        // Fetch in chunks of 200 (ADO API limit)
        const chunks: number[][] = [];
        for (let i = 0; i < ids.length; i += 200) {
            chunks.push(ids.slice(i, i + 200));
        }

        const allItems = await Promise.all(
            chunks.map(chunk => this.service.getWorkItems(chunk, projectId)),
        );

        return allItems.flat().map(wi => mapAdoWorkItem(wi as AdoRawWorkItem, projectId));
    }

    async getComments(workItemId: number | string, projectId?: string): Promise<Comment[]> {
        const list = await this.service.getComments(projectId ?? '', Number(workItemId));
        const comments = (list as { comments?: AdoRawComment[] }).comments ?? [];
        return comments.map(mapAdoComment);
    }

    async addComment(workItemId: number | string, body: string, projectId?: string): Promise<Comment> {
        const comment = await this.service.addComment(projectId ?? '', Number(workItemId), body);
        return mapAdoComment(comment as AdoRawComment);
    }
}
