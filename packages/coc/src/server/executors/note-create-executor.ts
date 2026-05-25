/**
 * Note Create Executor
 *
 * Handles AI-powered note creation: reads the workspace notes tree,
 * asks the AI for a title and best placement, then creates the note file.
 *
 * Returns `{ path, title, notebook }` in the process metadata for the
 * SPA client to navigate to the newly created note.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions, ChatModeExecutionResult } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import {
    buildFollowUpSuggestionsAddon,
    buildSearchConversationsAddon,
    buildTavilyWebSearchAddon,
    applyLlmToolPreferences,
} from './prompt-builder';
import { systemMessageBuilder } from './system-message-builder';
import { readEffectiveDisabledLlmTools, readRepoPreferences } from '../preferences-handler';
import { getRepoDataPath } from '../paths';

// ============================================================================
// Tree compaction helpers
// ============================================================================

interface TreeNode {
    name: string;
    path: string;
    type: 'notebook' | 'section' | 'page';
    children?: TreeNode[];
}

interface CompactTreeNode {
    name: string;
    path: string;
    type: 'notebook' | 'section';
    samplePages: string[];
    pageCount: number;
    children: CompactTreeNode[];
}

/**
 * Compact the notes tree for the AI prompt — only include folder names
 * (notebooks/sections) and at most 3 child page names per folder.
 */
function compactTree(nodes: TreeNode[]): CompactTreeNode[] {
    return nodes
        .filter(n => n.type !== 'page')
        .map(n => {
            const pages = (n.children ?? []).filter(c => c.type === 'page');
            return {
                name: n.name,
                path: n.path,
                type: n.type as 'notebook' | 'section',
                samplePages: pages.slice(0, 3).map(c => c.name),
                pageCount: pages.length,
                children: compactTree(n.children ?? []),
            };
        });
}

/**
 * Build the notes tree for a workspace by scanning the notes directory.
 * Mirrors `buildTree` in notes-read-handler.ts but usable from the executor.
 */
async function buildTree(dir: string, basePath: string): Promise<TreeNode[]> {
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }

    const relevant = entries
        .filter(e => {
            if (e.isDirectory()) return !e.name.startsWith('.');
            return e.name.endsWith('.md');
        })
        .sort((a, b) => {
            const aDir = a.isDirectory() ? 0 : 1;
            const bDir = b.isDirectory() ? 0 : 1;
            if (aDir !== bDir) return aDir - bDir;
            return a.name.localeCompare(b.name);
        });

    const nodes: TreeNode[] = [];
    for (const entry of relevant) {
        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            const children = await buildTree(path.join(dir, entry.name), entryPath);
            const type = basePath ? 'section' : 'notebook';
            nodes.push({ name: entry.name, path: entryPath, type, children });
        } else {
            nodes.push({ name: entry.name, path: entryPath, type: 'page' });
        }
    }
    return nodes;
}

// ============================================================================
// AI response parsing
// ============================================================================

export interface NoteCreateAIResponse {
    parentPath: string;
    title: string;
    createNotebook: boolean;
    newNotebookName?: string;
}

const INVALID_NAME_CHARS = /[/\\:*?<>|"]/g;

function sanitizeTitle(title: string): string {
    return title.replace(INVALID_NAME_CHARS, '').trim();
}

/**
 * Parse the AI's JSON response for note creation.
 * Accepts raw text that may contain markdown fences or extra whitespace.
 */
export function parseNoteCreateResponse(raw: string): NoteCreateAIResponse {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('AI response is not a valid JSON object');
    }
    if (typeof parsed.title !== 'string' || !parsed.title.trim()) {
        throw new Error('AI response missing "title"');
    }
    if (typeof parsed.parentPath !== 'string') {
        throw new Error('AI response missing "parentPath"');
    }

    return {
        parentPath: parsed.parentPath ?? '',
        title: sanitizeTitle(parsed.title),
        createNotebook: !!parsed.createNotebook,
        newNotebookName: parsed.newNotebookName ? sanitizeTitle(parsed.newNotebookName) : undefined,
    };
}

// ============================================================================
// Executor
// ============================================================================

export interface NoteCreateResult {
    path: string;
    title: string;
    notebook: string;
}

export class NoteCreateExecutor extends ChatBaseExecutor {
    constructor(
        store: ProcessStore,
        options: ChatModeExecutorOptions,
        dataDir?: string,
    ) {
        super(store, options, dataDir);
    }

    async execute(task: QueuedTask, prompt: string): Promise<ChatModeExecutionResult> {
        const payload = task.payload as unknown as ChatPayload;
        const wsId = payload.workspaceId;
        const noteCreate = payload.context?.noteCreate;
        const userPrompt = noteCreate?.prompt ?? prompt;

        // Inject the note model preference when no explicit model
        // Resolution: task.config.model > defaultModels.note > lastModels.note > 'claude-sonnet-4.6'.
        if (!task.config.model) {
            const repoPrefs = this.dataDir && wsId
                ? readRepoPreferences(this.dataDir, wsId)
                : undefined;
            const noteModel = repoPrefs?.defaultModels?.note
                ?? repoPrefs?.defaultModel
                ?? repoPrefs?.lastModels?.note
                ?? 'claude-sonnet-4.6';
            task = { ...task, config: { ...task.config, model: noteModel } };
        }

        // Read the notes tree
        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
        const notesRoot = getRepoDataPath(effectiveDataDir, wsId ?? '', 'notes');
        await fs.promises.mkdir(notesRoot, { recursive: true });

        const tree = await buildTree(notesRoot, '');
        const compacted = compactTree(tree);

        // Build a structured prompt for the AI
        const structuredPrompt = this.buildNoteCreatePrompt(userPrompt, compacted);

        // Override prompt for AI execution
        const modifiedTask = {
            ...task,
            payload: {
                ...(task.payload as any),
                prompt: structuredPrompt,
            },
        };

        const result = await super.execute(modifiedTask as QueuedTask, structuredPrompt);

        // Parse AI response and create the note file
        try {
            const aiResponse = result.response ?? '';
            const parsed = parseNoteCreateResponse(aiResponse);

            // Determine the actual parent path
            let actualParentPath = parsed.parentPath;
            if (parsed.createNotebook && parsed.newNotebookName) {
                actualParentPath = parsed.newNotebookName;
                const notebookDir = path.join(notesRoot, parsed.newNotebookName);
                await fs.promises.mkdir(notebookDir, { recursive: true });
            }

            // Validate parent path exists
            if (actualParentPath) {
                const parentDir = path.join(notesRoot, actualParentPath);
                const normalizedParent = path.normalize(parentDir);
                const normalizedRoot = path.normalize(notesRoot);
                if (!normalizedParent.startsWith(normalizedRoot)) {
                    throw new Error('Parent path escapes notes root');
                }
                await fs.promises.mkdir(parentDir, { recursive: true });
            }

            // Create the note file
            const fileName = `${parsed.title}.md`;
            const notePath = actualParentPath ? `${actualParentPath}/${fileName}` : fileName;
            const fullPath = path.join(notesRoot, notePath);

            // Security check
            const normalizedFull = path.normalize(fullPath);
            const normalizedRoot = path.normalize(notesRoot);
            if (!normalizedFull.startsWith(normalizedRoot)) {
                throw new Error('Note path escapes notes root');
            }

            await fs.promises.writeFile(fullPath, '', 'utf-8');

            // Store result in process metadata
            const processId = toQueueProcessId(task.id);
            const noteCreateResult: NoteCreateResult = {
                path: notePath,
                title: parsed.title,
                notebook: actualParentPath || '(root)',
            };
            try {
                const existing = await this.store.getProcess(processId);
                if (existing) {
                    await this.store.updateProcess(processId, {
                        metadata: {
                            ...(existing.metadata ?? {}),
                            noteCreate: noteCreateResult,
                        } as any,
                    });
                }
            } catch {
                // best-effort metadata update
            }

            return result;
        } catch (err) {
            // If parsing/creation fails, the AI response is still saved in the process
            // The user can see the AI's response and manually create the note
            return result;
        }
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;
        const wsId = payload.workspaceId;

        const followUp = buildFollowUpSuggestionsAddon(false, 0);
        const searchConversations = buildSearchConversationsAddon(this.store, wsId, toQueueProcessId(task.id));
        const tavilySearch = buildTavilyWebSearchAddon(this.dataDir);

        const disabledLlmTools = this.dataDir && wsId
            ? readEffectiveDisabledLlmTools(this.dataDir, wsId)
            : undefined;

        const { tools, toolGuidance } = applyLlmToolPreferences(
            [followUp, searchConversations, tavilySearch],
            disabledLlmTools,
        );

        const systemMessage = await systemMessageBuilder()
            .appendToolGuidance(toolGuidance)
            .build();

        return {
            agentMode: 'interactive' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt,
            dispose: undefined,
        };
    }

    private buildNoteCreatePrompt(userPrompt: string, compactedTree: CompactTreeNode[]): string {
        const treeJson = JSON.stringify(compactedTree, null, 2);
        return `You are organizing a note-taking system. Here is the current notes structure:

<tree>
${treeJson}
</tree>

The user wants to create a new note about: "${userPrompt}"

Your task:
1. Analyze the existing notebooks and sections
2. Choose the best existing notebook/section as the parent, OR suggest creating a new notebook if none fit well
3. Generate a concise, descriptive title for the note (no .md extension, no special characters like /\\:*?<>|")

Respond with ONLY this JSON (no markdown fences):
{
  "parentPath": "ExistingNotebook" or "ExistingNotebook/Section" or "",
  "title": "Descriptive Note Title",
  "createNotebook": true/false,
  "newNotebookName": "New Notebook Name"
}

If an existing notebook fits well, set createNotebook to false and use its path as parentPath.
If no existing notebook fits, set createNotebook to true and provide a newNotebookName.
If the tree is empty, set createNotebook to true.`;
    }
}
