import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { 
    ReviewStatusManager,
    ReviewStatus,
    ReviewStatusRecord,
    ReviewStatusStore,
    TaskItem,
    TaskDocumentItem,
    TaskDocumentGroupItem,
    Task,
    TaskDocument
} from '../../shortcuts/tasks-viewer';

/**
 * Mock workspace state for testing
 */
class MockWorkspaceState implements vscode.Memento {
    private storage = new Map<string, unknown>();

    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const value = this.storage.get(key);
        return value !== undefined ? (value as T) : defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.storage.delete(key);
        } else {
            this.storage.set(key, value);
        }
    }

    setKeysForSync(_keys: readonly string[]): void {
        // Not implemented for tests
    }
}

/**
 * Mock ExtensionContext for testing
 */
class MockExtensionContext {
    workspaceState = new MockWorkspaceState();
    globalState = new MockWorkspaceState();
    extensionUri = vscode.Uri.file('/mock/extension');
    extensionPath = '/mock/extension';
    subscriptions: vscode.Disposable[] = [];
}

suite('Tasks Review Status Tests', () => {
    let tempDir: string;
    let tasksFolder: string;
    let reviewStatusManager: ReviewStatusManager;
    let mockContext: MockExtensionContext;

    setup(async () => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-review-status-test-'));
        tasksFolder = path.join(tempDir, '.vscode', 'tasks');
        fs.mkdirSync(tasksFolder, { recursive: true });

        // Create mock context
        mockContext = new MockExtensionContext();

        // Create review status manager
        reviewStatusManager = new ReviewStatusManager(tasksFolder);
        await reviewStatusManager.initialize(mockContext as unknown as vscode.ExtensionContext);
    });

    teardown(() => {
        // Dispose manager
        reviewStatusManager.dispose();

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('ReviewStatusManager', () => {
        suite('Initialization', () => {
            test('should initialize with empty status store', () => {
                assert.ok(reviewStatusManager.isInitialized());
            });

            test('should load existing status from storage on initialization', async () => {
                // Create a file
                const filePath = path.join(tasksFolder, 'test-task.md');
                fs.writeFileSync(filePath, '# Test Task\n\nContent here');

                // Mark as reviewed
                await reviewStatusManager.markAsReviewed(filePath);

                // Create a new manager and initialize with same context
                const newManager = new ReviewStatusManager(tasksFolder);
                await newManager.initialize(mockContext as unknown as vscode.ExtensionContext);

                // Should have the same status
                const status = newManager.getStatus(filePath);
                assert.strictEqual(status, 'reviewed');

                newManager.dispose();
            });
        });

        suite('Status Operations', () => {
            test('should return unreviewed for files without status', () => {
                const filePath = path.join(tasksFolder, 'new-task.md');
                fs.writeFileSync(filePath, '# New Task');

                const status = reviewStatusManager.getStatus(filePath);
                assert.strictEqual(status, 'unreviewed');
            });

            test('should mark file as reviewed', async () => {
                const filePath = path.join(tasksFolder, 'task.md');
                fs.writeFileSync(filePath, '# Task Content');

                await reviewStatusManager.markAsReviewed(filePath);

                const status = reviewStatusManager.getStatus(filePath);
                assert.strictEqual(status, 'reviewed');
            });

            test('should mark file as unreviewed', async () => {
                const filePath = path.join(tasksFolder, 'task.md');
                fs.writeFileSync(filePath, '# Task Content');

                // First mark as reviewed
                await reviewStatusManager.markAsReviewed(filePath);
                assert.strictEqual(reviewStatusManager.getStatus(filePath), 'reviewed');

                // Then mark as unreviewed
                await reviewStatusManager.markAsUnreviewed(filePath);
                assert.strictEqual(reviewStatusManager.getStatus(filePath), 'unreviewed');
            });

            test('should store review timestamp', async () => {
                const filePath = path.join(tasksFolder, 'task.md');
                fs.writeFileSync(filePath, '# Task Content');

                const beforeMark = new Date();
                await reviewStatusManager.markAsReviewed(filePath);
                const afterMark = new Date();

                const record = reviewStatusManager.getStatusRecord(filePath);
                assert.ok(record);
                assert.ok(record.reviewedAt);

                const reviewedAt = new Date(record.reviewedAt);
                assert.ok(reviewedAt >= beforeMark);
                assert.ok(reviewedAt <= afterMark);
            });

            test('should store file hash when marking as reviewed', async () => {
                const filePath = path.join(tasksFolder, 'task.md');
                const content = '# Task Content\n\nSome details';
                fs.writeFileSync(filePath, content);

                await reviewStatusManager.markAsReviewed(filePath);

                const record = reviewStatusManager.getStatusRecord(filePath);
                assert.ok(record);
                assert.ok(record.fileHashAtReview);

                // Verify hash matches
                const expectedHash = crypto.createHash('md5').update(content).digest('hex');
                assert.strictEqual(record.fileHashAtReview, expectedHash);
            });
        });

        suite('File Modification Detection', () => {
            test('should detect file modification and return needs-re-review', async () => {
                const filePath = path.join(tasksFolder, 'task.md');
                fs.writeFileSync(filePath, '# Original Content');

                // Mark as reviewed
                await reviewStatusManager.markAsReviewed(filePath);
                assert.strictEqual(reviewStatusManager.getStatus(filePath), 'reviewed');

                // Modify the file
                fs.writeFileSync(filePath, '# Modified Content');

                // Should now need re-review
                const status = reviewStatusManager.getStatus(filePath);
                assert.strictEqual(status, 'needs-re-review');
            });

            test('should return reviewed if file unchanged', async () => {
                const filePath = path.join(tasksFolder, 'task.md');
                const content = '# Unchanged Content';
                fs.writeFileSync(filePath, content);

                await reviewStatusManager.markAsReviewed(filePath);

                // File not modified - should still be reviewed
                const status = reviewStatusManager.getStatus(filePath);
                assert.strictEqual(status, 'reviewed');
            });

            test('should get files needing re-review', async () => {
                // Create and review multiple files
                const file1 = path.join(tasksFolder, 'task1.md');
                const file2 = path.join(tasksFolder, 'task2.md');
                const file3 = path.join(tasksFolder, 'task3.md');

                fs.writeFileSync(file1, '# Task 1');
                fs.writeFileSync(file2, '# Task 2');
                fs.writeFileSync(file3, '# Task 3');

                await reviewStatusManager.markAsReviewed(file1);
                await reviewStatusManager.markAsReviewed(file2);
                await reviewStatusManager.markAsReviewed(file3);

                // Modify file1 and file3
                fs.writeFileSync(file1, '# Task 1 Modified');
                fs.writeFileSync(file3, '# Task 3 Modified');

                const needsReReview = reviewStatusManager.getFilesNeedingReReview();
                assert.strictEqual(needsReReview.length, 2);
                assert.ok(needsReReview.includes(file1));
                assert.ok(needsReReview.includes(file3));
                assert.ok(!needsReReview.includes(file2));
            });
        });

        suite('Folder Operations', () => {
            test('should mark all files in folder as reviewed', async () => {
                // Create folder structure
                const subFolder = path.join(tasksFolder, 'feature');
                fs.mkdirSync(subFolder, { recursive: true });

                const file1 = path.join(tasksFolder, 'task1.md');
                const file2 = path.join(subFolder, 'task2.md');
                const file3 = path.join(subFolder, 'task3.md');

                fs.writeFileSync(file1, '# Task 1');
                fs.writeFileSync(file2, '# Task 2');
                fs.writeFileSync(file3, '# Task 3');

                // Mark folder as reviewed (recursive)
                const markedFiles = await reviewStatusManager.markFolderAsReviewed(tasksFolder, true);

                assert.strictEqual(markedFiles.length, 3);
                assert.strictEqual(reviewStatusManager.getStatus(file1), 'reviewed');
                assert.strictEqual(reviewStatusManager.getStatus(file2), 'reviewed');
                assert.strictEqual(reviewStatusManager.getStatus(file3), 'reviewed');
            });

            test('should mark only direct children when recursive is false', async () => {
                // Create folder structure
                const subFolder = path.join(tasksFolder, 'feature');
                fs.mkdirSync(subFolder, { recursive: true });

                const file1 = path.join(tasksFolder, 'task1.md');
                const file2 = path.join(subFolder, 'task2.md');

                fs.writeFileSync(file1, '# Task 1');
                fs.writeFileSync(file2, '# Task 2');

                // Mark folder as reviewed (non-recursive)
                const markedFiles = await reviewStatusManager.markFolderAsReviewed(tasksFolder, false);

                assert.strictEqual(markedFiles.length, 1);
                assert.strictEqual(reviewStatusManager.getStatus(file1), 'reviewed');
                assert.strictEqual(reviewStatusManager.getStatus(file2), 'unreviewed');
            });

            test('should skip archive folder when marking folder as reviewed', async () => {
                // Create archive folder
                const archiveFolder = path.join(tasksFolder, 'archive');
                fs.mkdirSync(archiveFolder, { recursive: true });

                const file1 = path.join(tasksFolder, 'task1.md');
                const archivedFile = path.join(archiveFolder, 'archived-task.md');

                fs.writeFileSync(file1, '# Task 1');
                fs.writeFileSync(archivedFile, '# Archived Task');

                const markedFiles = await reviewStatusManager.markFolderAsReviewed(tasksFolder, true);

                assert.strictEqual(markedFiles.length, 1);
                assert.strictEqual(reviewStatusManager.getStatus(file1), 'reviewed');
                assert.strictEqual(reviewStatusManager.getStatus(archivedFile), 'unreviewed');
            });
        });

        suite('Cleanup Operations', () => {
            test('should clean up orphaned entries for deleted files', async () => {
                const file1 = path.join(tasksFolder, 'task1.md');
                const file2 = path.join(tasksFolder, 'task2.md');

                fs.writeFileSync(file1, '# Task 1');
                fs.writeFileSync(file2, '# Task 2');

                await reviewStatusManager.markAsReviewed(file1);
                await reviewStatusManager.markAsReviewed(file2);

                // Delete file1
                fs.unlinkSync(file1);

                // Cleanup orphaned entries
                const removedCount = await reviewStatusManager.cleanupOrphanedEntries();

                assert.strictEqual(removedCount, 1);
                assert.strictEqual(reviewStatusManager.getStatusRecord(file1), undefined);
                assert.ok(reviewStatusManager.getStatusRecord(file2));
            });
        });

        suite('Statistics', () => {
            test('should return correct statistics', async () => {
                const file1 = path.join(tasksFolder, 'task1.md');
                const file2 = path.join(tasksFolder, 'task2.md');
                const file3 = path.join(tasksFolder, 'task3.md');

                fs.writeFileSync(file1, '# Task 1');
                fs.writeFileSync(file2, '# Task 2');
                fs.writeFileSync(file3, '# Task 3');

                await reviewStatusManager.markAsReviewed(file1);
                await reviewStatusManager.markAsReviewed(file2);
                await reviewStatusManager.markAsReviewed(file3);

                // Modify file2 to trigger needs-re-review
                fs.writeFileSync(file2, '# Task 2 Modified');

                const stats = reviewStatusManager.getStatistics();
                assert.strictEqual(stats.reviewed, 2);
                assert.strictEqual(stats.needsReReview, 1);
            });
        });

        suite('Event Emission', () => {
            test('should emit event when status changes', async () => {
                const filePath = path.join(tasksFolder, 'task.md');
                fs.writeFileSync(filePath, '# Task');

                let eventFired = false;
                let changedPaths: string[] = [];

                const disposable = reviewStatusManager.onDidChangeStatus((paths) => {
                    eventFired = true;
                    changedPaths = paths;
                });

                await reviewStatusManager.markAsReviewed(filePath);

                assert.ok(eventFired);
                assert.strictEqual(changedPaths.length, 1);

                disposable.dispose();
            });
        });

        suite('Cross-Platform Path Handling', () => {
            test('should normalize paths for consistent storage', async () => {
                const file1 = path.join(tasksFolder, 'feature', 'task.md');
                fs.mkdirSync(path.dirname(file1), { recursive: true });
                fs.writeFileSync(file1, '# Task');

                await reviewStatusManager.markAsReviewed(file1);

                // Get the record using the same path
                const record = reviewStatusManager.getStatusRecord(file1);
                assert.ok(record);
                assert.strictEqual(record.status, 'reviewed');
            });
        });
    });

    suite('TaskItem Review Status', () => {
        test('should default to unreviewed status', () => {
            const task: Task = {
                name: 'test-task',
                filePath: path.join(tasksFolder, 'test-task.md'),
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskItem(task);
            assert.strictEqual(item.reviewStatus, 'unreviewed');
        });

        test('should update icon when review status changes', () => {
            const task: Task = {
                name: 'test-task',
                filePath: path.join(tasksFolder, 'test-task.md'),
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskItem(task);

            // Set to reviewed
            item.setReviewStatus('reviewed');
            assert.strictEqual(item.reviewStatus, 'reviewed');
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'pass');

            // Set to needs-re-review
            item.setReviewStatus('needs-re-review');
            assert.strictEqual(item.reviewStatus, 'needs-re-review');
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'sync');

            // Set back to unreviewed
            item.setReviewStatus('unreviewed');
            assert.strictEqual(item.reviewStatus, 'unreviewed');
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'file-text');
        });

        test('should update context value based on review status', () => {
            const task: Task = {
                name: 'test-task',
                filePath: path.join(tasksFolder, 'test-task.md'),
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskItem(task);

            item.setReviewStatus('reviewed');
            assert.strictEqual(item.contextValue, 'task_reviewed');

            item.setReviewStatus('needs-re-review');
            assert.strictEqual(item.contextValue, 'task_needsReReview');

            item.setReviewStatus('unreviewed');
            assert.strictEqual(item.contextValue, 'task');
        });

        test('should not change context for archived tasks', () => {
            const task: Task = {
                name: 'archived-task',
                filePath: path.join(tasksFolder, 'archived-task.md'),
                modifiedTime: new Date(),
                isArchived: true
            };

            const item = new TaskItem(task);
            assert.strictEqual(item.contextValue, 'archivedTask');

            item.setReviewStatus('reviewed');
            assert.strictEqual(item.contextValue, 'archivedTask');
        });
    });

    suite('TaskDocumentItem Review Status', () => {
        test('should default to unreviewed status', () => {
            const doc: TaskDocument = {
                baseName: 'task1',
                docType: 'plan',
                fileName: 'task1.plan.md',
                filePath: path.join(tasksFolder, 'task1.plan.md'),
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskDocumentItem(doc);
            assert.strictEqual(item.reviewStatus, 'unreviewed');
        });

        test('should update icon when review status changes', () => {
            const doc: TaskDocument = {
                baseName: 'task1',
                docType: 'plan',
                fileName: 'task1.plan.md',
                filePath: path.join(tasksFolder, 'task1.plan.md'),
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskDocumentItem(doc);

            // Initially shows doc type icon
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'checklist');

            // Set to reviewed
            item.setReviewStatus('reviewed');
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'pass');

            // Set to needs-re-review
            item.setReviewStatus('needs-re-review');
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'sync');
        });

        test('should update context value based on review status', () => {
            const doc: TaskDocument = {
                baseName: 'task1',
                docType: 'plan',
                fileName: 'task1.plan.md',
                filePath: path.join(tasksFolder, 'task1.plan.md'),
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskDocumentItem(doc);

            item.setReviewStatus('reviewed');
            assert.strictEqual(item.contextValue, 'taskDocument_reviewed');

            item.setReviewStatus('needs-re-review');
            assert.strictEqual(item.contextValue, 'taskDocument_needsReReview');

            item.setReviewStatus('unreviewed');
            assert.strictEqual(item.contextValue, 'taskDocument');
        });
    });

    suite('TaskDocumentGroupItem Review Status', () => {
        test('should default to none-reviewed status', () => {
            const docs: TaskDocument[] = [
                {
                    baseName: 'task1',
                    docType: 'plan',
                    fileName: 'task1.plan.md',
                    filePath: path.join(tasksFolder, 'task1.plan.md'),
                    modifiedTime: new Date(),
                    isArchived: false
                },
                {
                    baseName: 'task1',
                    docType: 'spec',
                    fileName: 'task1.spec.md',
                    filePath: path.join(tasksFolder, 'task1.spec.md'),
                    modifiedTime: new Date(),
                    isArchived: false
                }
            ];

            const item = new TaskDocumentGroupItem('task1', docs, false);
            assert.strictEqual(item.groupReviewStatus, 'none-reviewed');
        });

        test('should show all-reviewed when all documents reviewed', () => {
            const docs: TaskDocument[] = [
                {
                    baseName: 'task1',
                    docType: 'plan',
                    fileName: 'task1.plan.md',
                    filePath: path.join(tasksFolder, 'task1.plan.md'),
                    modifiedTime: new Date(),
                    isArchived: false
                },
                {
                    baseName: 'task1',
                    docType: 'spec',
                    fileName: 'task1.spec.md',
                    filePath: path.join(tasksFolder, 'task1.spec.md'),
                    modifiedTime: new Date(),
                    isArchived: false
                }
            ];

            const item = new TaskDocumentGroupItem('task1', docs, false);

            const statusMap = new Map<string, ReviewStatus>();
            statusMap.set(docs[0].filePath, 'reviewed');
            statusMap.set(docs[1].filePath, 'reviewed');

            item.setGroupReviewStatus(statusMap);
            assert.strictEqual(item.groupReviewStatus, 'all-reviewed');
            assert.strictEqual(item.contextValue, 'taskDocumentGroup_allReviewed');
        });

        test('should show some-reviewed when some documents reviewed', () => {
            const docs: TaskDocument[] = [
                {
                    baseName: 'task1',
                    docType: 'plan',
                    fileName: 'task1.plan.md',
                    filePath: path.join(tasksFolder, 'task1.plan.md'),
                    modifiedTime: new Date(),
                    isArchived: false
                },
                {
                    baseName: 'task1',
                    docType: 'spec',
                    fileName: 'task1.spec.md',
                    filePath: path.join(tasksFolder, 'task1.spec.md'),
                    modifiedTime: new Date(),
                    isArchived: false
                }
            ];

            const item = new TaskDocumentGroupItem('task1', docs, false);

            const statusMap = new Map<string, ReviewStatus>();
            statusMap.set(docs[0].filePath, 'reviewed');
            statusMap.set(docs[1].filePath, 'unreviewed');

            item.setGroupReviewStatus(statusMap);
            assert.strictEqual(item.groupReviewStatus, 'some-reviewed');
        });

        test('should show has-re-review when any document needs re-review', () => {
            const docs: TaskDocument[] = [
                {
                    baseName: 'task1',
                    docType: 'plan',
                    fileName: 'task1.plan.md',
                    filePath: path.join(tasksFolder, 'task1.plan.md'),
                    modifiedTime: new Date(),
                    isArchived: false
                },
                {
                    baseName: 'task1',
                    docType: 'spec',
                    fileName: 'task1.spec.md',
                    filePath: path.join(tasksFolder, 'task1.spec.md'),
                    modifiedTime: new Date(),
                    isArchived: false
                }
            ];

            const item = new TaskDocumentGroupItem('task1', docs, false);

            const statusMap = new Map<string, ReviewStatus>();
            statusMap.set(docs[0].filePath, 'reviewed');
            statusMap.set(docs[1].filePath, 'needs-re-review');

            item.setGroupReviewStatus(statusMap);
            assert.strictEqual(item.groupReviewStatus, 'has-re-review');
            assert.strictEqual(item.contextValue, 'taskDocumentGroup_hasReReview');
        });

        test('should update icon based on group status', () => {
            const docs: TaskDocument[] = [
                {
                    baseName: 'task1',
                    docType: 'plan',
                    fileName: 'task1.plan.md',
                    filePath: path.join(tasksFolder, 'task1.plan.md'),
                    modifiedTime: new Date(),
                    isArchived: false
                }
            ];

            const item = new TaskDocumentGroupItem('task1', docs, false);

            // Default icon
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'folder-library');

            // All reviewed
            const allReviewedMap = new Map<string, ReviewStatus>();
            allReviewedMap.set(docs[0].filePath, 'reviewed');
            item.setGroupReviewStatus(allReviewedMap);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'pass-filled');

            // Has re-review
            const reReviewMap = new Map<string, ReviewStatus>();
            reReviewMap.set(docs[0].filePath, 'needs-re-review');
            item.setGroupReviewStatus(reReviewMap);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'sync');
        });
    });

    suite('Persistence', () => {
        test('should persist status across manager instances', async () => {
            const filePath = path.join(tasksFolder, 'persistent-task.md');
            fs.writeFileSync(filePath, '# Persistent Task');

            // Mark as reviewed with first manager
            await reviewStatusManager.markAsReviewed(filePath);

            // Create new manager with same context
            const newManager = new ReviewStatusManager(tasksFolder);
            await newManager.initialize(mockContext as unknown as vscode.ExtensionContext);

            // Should have the same status
            assert.strictEqual(newManager.getStatus(filePath), 'reviewed');

            newManager.dispose();
        });

        test('should handle corrupted storage gracefully', async () => {
            // Manually corrupt storage
            await mockContext.workspaceState.update('taskReviewStatus', 'not an object');

            // Create new manager - should handle gracefully
            const newManager = new ReviewStatusManager(tasksFolder);
            await newManager.initialize(mockContext as unknown as vscode.ExtensionContext);

            // Should still work
            const filePath = path.join(tasksFolder, 'task.md');
            fs.writeFileSync(filePath, '# Task');
            
            assert.strictEqual(newManager.getStatus(filePath), 'unreviewed');

            newManager.dispose();
        });
    });
});
