import { ExplorerClient, GitClient, HealthClient, MemoryClient, ModelsClient, PreferencesClient, ProcessesClient, PullRequestsClient, QueueClient, SchedulesClient, SeenStateClient, SkillsClient, TasksClient, TemplatesClient, WikiClient, WorkflowClient, WorkItemsClient, WorkspacesClient } from './domains';
import { HttpTransport, normalizeOptions } from './http';
import { EventsClient } from './realtime';
import type { CocClientOptions, CocRequestOptions, NormalizedCocClientOptions } from './types';

export class CocClient {
  readonly options: NormalizedCocClientOptions;
  readonly explorer: ExplorerClient;
  readonly git: GitClient;
  readonly health: HealthClient;
  readonly memory: MemoryClient;
  readonly models: ModelsClient;
  readonly preferences: PreferencesClient;
  readonly processes: ProcessesClient;
  readonly pullRequests: PullRequestsClient;
  readonly queue: QueueClient;
  readonly schedules: SchedulesClient;
  readonly seenState: SeenStateClient;
  readonly skills: SkillsClient;
  readonly tasks: TasksClient;
  readonly templates: TemplatesClient;
  readonly wiki: WikiClient;
  readonly workflow: WorkflowClient;
  readonly workItems: WorkItemsClient;
  readonly workspaces: WorkspacesClient;
  readonly repos: WorkspacesClient;
  readonly events: EventsClient;

  private readonly transport: HttpTransport;

  constructor(options: CocClientOptions = {}) {
    this.options = normalizeOptions(options);
    this.transport = new HttpTransport(this.options);
    this.explorer = new ExplorerClient(this.transport);
    this.git = new GitClient(this.transport);
    this.health = new HealthClient(this.transport);
    this.memory = new MemoryClient(this.transport);
    this.models = new ModelsClient(this.transport);
    this.preferences = new PreferencesClient(this.transport);
    this.processes = new ProcessesClient(this.transport, this.options);
    this.pullRequests = new PullRequestsClient(this.transport);
    this.queue = new QueueClient(this.transport);
    this.schedules = new SchedulesClient(this.transport);
    this.seenState = new SeenStateClient(this.transport);
    this.skills = new SkillsClient(this.transport);
    this.tasks = new TasksClient(this.transport);
    this.templates = new TemplatesClient(this.transport);
    this.wiki = new WikiClient(this.transport, this.options);
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
