export interface ToolLikeForNormalization {
    toolName?: string;
    name?: string;
    args?: unknown;
    parameters?: unknown;
    result?: string;
    error?: string;
    status?: string;
}

export interface CodexFileChange {
    path: string;
    kind: 'add' | 'delete' | 'update' | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeToolName(rawName: string | undefined): string {
    const name = (rawName ?? '').trim();
    switch (name) {
        case 'read_file':
        case 'open_file':
            return 'view';
        case 'edit_file':
        case 'str_replace':
        case 'str_replace_editor':
            return 'edit';
        case 'write_file':
        case 'create_file':
            return 'create';
        case 'command_execution':
            return 'shell';
        case 'file_change':
            return 'apply_patch';
        // The Claude Code SDK emits its built-in skill tool as 'Skill' (PascalCase).
        // Normalize to lowercase 'skill' so all downstream display/detection logic
        // (getToolSummary, filterWhisperChunks, getToolKindInfo) handles it correctly.
        case 'Skill':
            return 'skill';
        default:
            return name || 'unknown';
    }
}

export function normalizeToolArgs(toolName: string, rawArgs: unknown): unknown {
    if (!isRecord(rawArgs)) return rawArgs ?? {};
    if (toolName === 'view' && typeof rawArgs.file_path === 'string' && rawArgs.path == null) {
        return { ...rawArgs, path: rawArgs.file_path };
    }
    if ((toolName === 'edit' || toolName === 'create') && typeof rawArgs.file_path === 'string' && rawArgs.path == null) {
        return { ...rawArgs, path: rawArgs.file_path };
    }
    if (toolName === 'shell' && typeof rawArgs.cmd === 'string' && rawArgs.command == null) {
        return { ...rawArgs, command: rawArgs.cmd };
    }
    return rawArgs;
}

export function normalizeToolForDisplay<T extends ToolLikeForNormalization>(tool: T): T & { toolName: string; args: unknown } {
    const rawName = tool.toolName ?? tool.name;
    const toolName = normalizeToolName(typeof rawName === 'string' ? rawName : undefined);
    const args = normalizeToolArgs(toolName, tool.args ?? tool.parameters ?? {});
    return {
        ...tool,
        toolName,
        args,
    };
}

export function getCodexFileChanges(args: unknown): CodexFileChange[] {
    if (!isRecord(args) || !Array.isArray(args.changes)) return [];
    return args.changes
        .filter((change): change is Record<string, unknown> => isRecord(change))
        .map((change) => ({
            path: typeof change.path === 'string' ? change.path : '',
            kind: typeof change.kind === 'string' ? change.kind : 'update',
        }))
        .filter(change => change.path.length > 0);
}

export function summarizeCodexFileChanges(args: unknown): string {
    const changes = getCodexFileChanges(args);
    if (changes.length === 0) return '';
    if (changes.length === 1) return changes[0].path;
    return `${changes.length} files`;
}

