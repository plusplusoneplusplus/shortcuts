import { describe, it, expect } from 'vitest';
import {
    Task,
    TaskDocument,
    TaskDocumentGroup,
    TaskSortBy,
    TaskStatus,
    TaskFolder,
    TasksViewerSettings,
    DiscoverySettings,
    DiscoveryDefaultScope,
    RelatedItemCategory,
    RelatedItemType,
    RelatedItem,
    RelatedItemsConfig,
    TaskCreationMode,
    TaskGenerationDepth,
    AITaskCreateOptions,
    AITaskFromFeatureOptions,
    AITaskCreationOptions,
    AITaskDialogResult,
    FeatureContext,
    ReviewStatus,
    ReviewStatusRecord,
    ReviewStatusStore,
    VALID_TASK_STATUSES,
    COMMON_DOC_TYPES,
} from '../../src/tasks';

describe('task types', () => {
    it('should allow valid TaskStatus assignments', () => {
        const statuses: TaskStatus[] = ['pending', 'in-progress', 'done', 'future'];
        expect(statuses).toHaveLength(4);
    });

    it('should allow valid TaskSortBy assignments', () => {
        const sort: TaskSortBy = 'name';
        const sort2: TaskSortBy = 'modifiedDate';
        expect(sort).toBe('name');
        expect(sort2).toBe('modifiedDate');
    });

    it('should allow valid RelatedItemCategory assignments', () => {
        const cats: RelatedItemCategory[] = ['source', 'test', 'doc', 'config', 'commit'];
        expect(cats).toHaveLength(5);
    });

    it('should allow valid RelatedItemType assignments', () => {
        const types: RelatedItemType[] = ['file', 'commit'];
        expect(types).toHaveLength(2);
    });

    it('should allow valid TaskCreationMode assignments', () => {
        const modes: TaskCreationMode[] = ['create', 'from-feature'];
        expect(modes).toHaveLength(2);
    });

    it('should allow valid TaskGenerationDepth assignments', () => {
        const depths: TaskGenerationDepth[] = ['simple', 'deep'];
        expect(depths).toHaveLength(2);
    });

    it('should allow valid ReviewStatus assignments', () => {
        const statuses: ReviewStatus[] = ['reviewed', 'unreviewed', 'needs-re-review'];
        expect(statuses).toHaveLength(3);
    });

    it('should construct a valid Task object', () => {
        const task: Task = {
            name: 'my-task',
            filePath: '/tmp/my-task.md',
            modifiedTime: new Date(),
            isArchived: false,
            status: 'pending',
        };
        expect(task.name).toBe('my-task');
    });

    it('should construct a valid TaskDocument object', () => {
        const doc: TaskDocument = {
            baseName: 'task1',
            docType: 'plan',
            fileName: 'task1.plan.md',
            filePath: '/tmp/task1.plan.md',
            modifiedTime: new Date(),
            isArchived: false,
        };
        expect(doc.docType).toBe('plan');
    });

    it('should construct a valid TaskDocumentGroup object', () => {
        const group: TaskDocumentGroup = {
            baseName: 'task1',
            documents: [],
            isArchived: false,
            latestModifiedTime: new Date(),
        };
        expect(group.baseName).toBe('task1');
    });

    it('should construct a valid RelatedItem object', () => {
        const item: RelatedItem = {
            name: 'auth.ts',
            path: 'src/auth.ts',
            type: 'file',
            category: 'source',
            relevance: 90,
            reason: 'Core auth module',
        };
        expect(item.relevance).toBe(90);
    });

    it('should construct a valid AITaskDialogResult object', () => {
        const result: AITaskDialogResult = {
            options: null,
            cancelled: true,
        };
        expect(result.cancelled).toBe(true);
    });

    it('should construct a valid FeatureContext object', () => {
        const ctx: FeatureContext = {
            hasContent: true,
            description: 'Auth feature',
            existingTasks: ['login.md'],
            sourceFiles: ['auth.ts'],
            configFiles: [],
            commits: [],
        };
        expect(ctx.hasContent).toBe(true);
    });

    it('should construct a valid ReviewStatusStore object', () => {
        const store: ReviewStatusStore = {
            'folder/task.md': {
                status: 'reviewed',
                reviewedAt: new Date().toISOString(),
                fileHashAtReview: 'abc123',
            },
        };
        expect(store['folder/task.md'].status).toBe('reviewed');
    });

    it('should export VALID_TASK_STATUSES and COMMON_DOC_TYPES', () => {
        expect(Array.isArray(VALID_TASK_STATUSES)).toBe(true);
        expect(Array.isArray(COMMON_DOC_TYPES)).toBe(true);
        expect(VALID_TASK_STATUSES).toContain('pending');
        expect(COMMON_DOC_TYPES).toContain('plan');
    });
});
