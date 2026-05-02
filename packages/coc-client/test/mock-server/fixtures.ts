import type { AIProcess, ProcessDetailResponse, ProcessListResponse, QueuedTask, QueueListResponse, QueueStats, WorkItem, WorkItemListResponse, WorkspaceInfo, WorkspacesResponse } from '../../src';

const now = '2026-01-01T00:00:00.000Z';

export function mockWorkspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    id: 'repo-a',
    name: 'Repo A',
    rootPath: 'C:\\repos\\repo-a',
    isGitRepo: true,
    remoteUrl: 'https://example.invalid/repo-a.git',
    ...overrides,
  };
}

export function mockWorkspacesResponse(workspaces: WorkspaceInfo[] = [mockWorkspace()]): WorkspacesResponse {
  return { workspaces };
}

export function mockProcess(overrides: Partial<AIProcess> = {}): AIProcess {
  return {
    id: 'proc-1',
    type: 'chat',
    promptPreview: 'Summarize the repo',
    status: 'completed',
    startTime: now,
    endTime: now,
    result: 'Done',
    metadata: { workspaceId: 'repo-a' },
    ...overrides,
  };
}

export function mockProcessListResponse(processes: AIProcess[] = [mockProcess()]): ProcessListResponse {
  return {
    processes,
    total: processes.length,
    limit: processes.length,
    offset: 0,
  };
}

export function mockProcessDetailResponse(process: AIProcess = mockProcess()): ProcessDetailResponse {
  return {
    process,
    children: [],
    total: 1,
  };
}

export function mockWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi-1',
    repoId: 'repo-a',
    title: 'Mock work item',
    description: 'A deterministic mock work item',
    status: 'planning',
    createdAt: now,
    updatedAt: now,
    source: 'manual',
    priority: 'normal',
    tags: [],
    ...overrides,
  };
}

export function mockWorkItemListResponse(items: WorkItem[] = [mockWorkItem()]): WorkItemListResponse {
  return {
    items,
    total: items.length,
    hasMore: false,
  };
}

export function mockQueueStats(overrides: Partial<QueueStats> = {}): QueueStats {
  return {
    queued: 1,
    running: 0,
    completed: 2,
    failed: 0,
    cancelled: 0,
    total: 3,
    isPaused: false,
    isDraining: false,
    isAutopilotPaused: false,
    ...overrides,
  };
}

export function mockQueuedTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
  return {
    id: 'task-1',
    repoId: 'repo-a',
    type: 'chat',
    priority: 'normal',
    status: 'queued',
    createdAt: 1770000000000,
    payload: { prompt: 'Summarize the repo' },
    config: { model: 'gpt-5.4' },
    displayName: 'Summarize repo',
    processId: 'proc-1',
    ...overrides,
  };
}

export function mockQueueListResponse(overrides: Partial<QueueListResponse> = {}): QueueListResponse {
  return {
    queued: [mockQueuedTask()],
    running: [],
    stats: mockQueueStats(),
    ...overrides,
  };
}
