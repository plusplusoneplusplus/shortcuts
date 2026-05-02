import { HealthClient, MemoryClient, ModelsClient, PreferencesClient, ProcessesClient, PullRequestsClient, QueueClient, SchedulesClient, TemplatesClient, WorkflowClient, WorkItemsClient, WorkspacesClient } from './domains';
import { HttpTransport, normalizeOptions } from './http';
import { EventsClient } from './realtime';
import type { CocClientOptions, CocRequestOptions, NormalizedCocClientOptions } from './types';

export class CocClient {
  readonly options: NormalizedCocClientOptions;
  readonly health: HealthClient;
  readonly memory: MemoryClient;
  readonly models: ModelsClient;
  readonly preferences: PreferencesClient;
  readonly processes: ProcessesClient;
  readonly pullRequests: PullRequestsClient;
  readonly queue: QueueClient;
  readonly schedules: SchedulesClient;
  readonly templates: TemplatesClient;
  readonly workflow: WorkflowClient;
  readonly workItems: WorkItemsClient;
  readonly workspaces: WorkspacesClient;
  readonly repos: WorkspacesClient;
  readonly events: EventsClient;

  private readonly transport: HttpTransport;

  constructor(options: CocClientOptions = {}) {
    this.options = normalizeOptions(options);
    this.transport = new HttpTransport(this.options);
    this.health = new HealthClient(this.transport);
    this.memory = new MemoryClient(this.transport);
    this.models = new ModelsClient(this.transport);
    this.preferences = new PreferencesClient(this.transport);
    this.processes = new ProcessesClient(this.transport, this.options);
    this.pullRequests = new PullRequestsClient(this.transport);
    this.queue = new QueueClient(this.transport);
    this.schedules = new SchedulesClient(this.transport);
    this.templates = new TemplatesClient(this.transport);
    this.workflow = new WorkflowClient(this.transport);
    this.workItems = new WorkItemsClient(this.transport);
    this.workspaces = new WorkspacesClient(this.transport);
    this.repos = this.workspaces;
    this.events = new EventsClient(this.options);
  }

  request<T = unknown>(path: string, options?: CocRequestOptions): Promise<T> {
    return this.transport.request<T>(path, options);
  }
}
