import { AdminClient, AgentProvidersClient, DbBrowserClient, DreamsClient, ExplorerClient, ForEachClient, GitClient, HealthClient, LoopsClient, MapReduceClient, MemoryClient, MemoryV2Client, NotesClient, PreferencesClient, ProcessesClient, PromptHistoryClient, PullRequestsClient, QueueClient, SchedulesClient, SeenStateClient, ServersClient, SkillsClient, StatsClient, SuggestionsClient, SyncClient, TasksClient, TemplatesClient, WikiClient, WorkflowClient, WorkItemsClient, WorkspacesClient } from './domains';
import { HttpTransport, normalizeOptions } from './http';
import { EventsClient } from './realtime';
import type { CocClientOptions, CocRequestOptions, NormalizedCocClientOptions } from './types';

export class CocClient {
  readonly options: NormalizedCocClientOptions;
  readonly admin: AdminClient;
  readonly agentProviders: AgentProvidersClient;
  readonly dbBrowser: DbBrowserClient;
  readonly dreams: DreamsClient;
  readonly explorer: ExplorerClient;
  readonly forEach: ForEachClient;
  readonly git: GitClient;
  readonly health: HealthClient;
  readonly memory: MemoryClient;
  readonly memoryV2: MemoryV2Client;
  readonly notes: NotesClient;
  readonly preferences: PreferencesClient;
  readonly processes: ProcessesClient;
  readonly promptHistory: PromptHistoryClient;
  readonly pullRequests: PullRequestsClient;
  readonly queue: QueueClient;
  readonly schedules: SchedulesClient;
  readonly seenState: SeenStateClient;
  readonly servers: ServersClient;
  readonly skills: SkillsClient;
  readonly stats: StatsClient;
  readonly suggestions: SuggestionsClient;
  readonly tasks: TasksClient;
  readonly templates: TemplatesClient;
  readonly wiki: WikiClient;
  readonly workflow: WorkflowClient;
  readonly workItems: WorkItemsClient;
  readonly workspaces: WorkspacesClient;
  readonly repos: WorkspacesClient;
  readonly loops: LoopsClient;
  readonly mapReduce: MapReduceClient;
  readonly sync: SyncClient;
  readonly events: EventsClient;

  private readonly transport: HttpTransport;

  constructor(options: CocClientOptions = {}) {
    this.options = normalizeOptions(options);
    this.transport = new HttpTransport(this.options);
    this.admin = new AdminClient(this.transport, this.options);
    this.agentProviders = new AgentProvidersClient(this.transport);
    this.dbBrowser = new DbBrowserClient(this.transport);
    this.dreams = new DreamsClient(this.transport);
    this.explorer = new ExplorerClient(this.transport);
    this.forEach = new ForEachClient(this.transport);
    this.git = new GitClient(this.transport);
    this.health = new HealthClient(this.transport);
    this.memory = new MemoryClient(this.transport);
    this.memoryV2 = new MemoryV2Client(this.transport);
    this.notes = new NotesClient(this.transport);
    this.preferences = new PreferencesClient(this.transport);
    this.processes = new ProcessesClient(this.transport, this.options);
    this.promptHistory = new PromptHistoryClient(this.transport);
    this.pullRequests = new PullRequestsClient(this.transport, this.options);
    this.queue = new QueueClient(this.transport);
    this.schedules = new SchedulesClient(this.transport);
    this.seenState = new SeenStateClient(this.transport);
    this.servers = new ServersClient(this.transport);
    this.skills = new SkillsClient(this.transport);
    this.stats = new StatsClient(this.transport);
    this.suggestions = new SuggestionsClient(this.transport);
    this.tasks = new TasksClient(this.transport);
    this.templates = new TemplatesClient(this.transport);
    this.wiki = new WikiClient(this.transport, this.options);
    this.workflow = new WorkflowClient(this.transport);
    this.workItems = new WorkItemsClient(this.transport);
    this.workspaces = new WorkspacesClient(this.transport);
    this.repos = this.workspaces;
    this.loops = new LoopsClient(this.transport);
    this.mapReduce = new MapReduceClient(this.transport);
    this.sync = new SyncClient(this.transport);
    this.events = new EventsClient(this.options);
  }

  request<T = unknown>(path: string, options?: CocRequestOptions): Promise<T> {
    return this.transport.request<T>(path, options);
  }
}
