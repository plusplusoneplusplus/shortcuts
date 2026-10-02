import { randomUUID } from 'node:crypto';
import { toQueueProcessId, type ProcessStore } from '@plusplusoneplusplus/forge';
import { parseWhatsAppCommand, type InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBindings, type WhatsAppBinding } from './whatsapp-bindings';

const TOPIC_LIST_LIMIT = 10;

export interface WhatsAppRouterDeps {
    store: Pick<ProcessStore, 'getWorkspaces' | 'getAllProcesses' | 'getProcess'>;
    bindings: WhatsAppBindings;
    groupJid: () => string | undefined;
    enqueue: (workspaceId: string, message: string, mode: 'ask' | 'autopilot', processId: string, taskId: string) => Promise<string>;
    send: (text: string, quotedId: string) => Promise<string>;
    react: (messageId: string) => Promise<void>;
    queued?: (binding: WhatsAppBinding) => void;
}

export class WhatsAppCommandRouter {
    constructor(private readonly deps: WhatsAppRouterDeps) {}

    async handle(msg: InboundWAMessage): Promise<void> {
        if (!msg.fromMe || !this.deps.groupJid() || msg.chatJid !== this.deps.groupJid()
            || !msg.messageId || this.deps.bindings.isKnownMessage(msg.messageId)) return;
        const command = parseWhatsAppCommand(msg.text);
        const reply = async (text: string) => {
            const id = await this.deps.send(text, msg.messageId);
            this.deps.bindings.recordOutbound(id);
        };
        try {
            const workspaces = await this.deps.store.getWorkspaces();
            const repoId = this.deps.bindings.selectedRepo;
            const repo = workspaces.find(workspace => workspace.id === repoId);
            switch (command.type) {
                case 'list-repos':
                    await reply(workspaces.length
                        ? workspaces.map((ws, i) => `${i + 1}. ${ws.name ?? ws.id} (${ws.id})`).join('\n')
                        : 'No repos registered.');
                    return;
                case 'select-repo': {
                    const index = /^[1-9]\d*$/.test(command.args) ? Number(command.args) : 0;
                    const selected = (index ? workspaces[index - 1] : undefined)
                        ?? workspaces.find(ws => ws.id === command.args || ws.name?.toLowerCase() === command.args.toLowerCase());
                    if (!selected) { await reply('Repo not found. Run `list repos` to see available repos.'); return; }
                    this.deps.bindings.selectRepo(selected.id);
                    await reply(`Selected repo: ${selected.name ?? selected.id}`);
                    return;
                }
                case 'invalid':
                    await reply('Unknown command or invalid argument. Try `list repos`, `select repo <n|name>`, `list topics`, `create topic`, or `select topic <id>`.');
                    return;
                case 'list-topics':
                case 'create-topic':
                case 'select-topic':
                case 'chat':
                    break;
            }

            let workspaceId = repo?.id;
            let targetId = workspaceId ? this.deps.bindings.topic(workspaceId) : null;
            if (command.type === 'chat' && msg.quotedMessageId) {
                const quoted = this.deps.bindings.findMessage(msg.quotedMessageId);
                if (quoted) {
                    workspaceId = quoted.workspaceId;
                    targetId = quoted.processId;
                }
            }
            if (!workspaceId || !workspaces.some(ws => ws.id === workspaceId)) {
                await reply('No repo selected. Run `list repos`, then `select repo <n|name>`.');
                return;
            }
            if (command.type === 'list-topics' || command.type === 'select-topic') {
                // Bounded, conversation-free read: an unbounded getAllProcesses loads every
                // turn in the repo and stalls the server on large stores.
                const processes = (await this.deps.store.getAllProcesses({
                    workspaceId, limit: TOPIC_LIST_LIMIT, exclude: ['conversation', 'toolCalls'],
                })).filter(proc => proc.metadata?.workspaceId === workspaceId);
                if (command.type === 'list-topics') {
                    await reply(processes.length
                        ? processes.map((proc, i) => `${i + 1}. ${proc.id} ${proc.title ?? proc.customTitle ?? ''}`).join('\n')
                        : 'No chat topics found.');
                    return;
                }
                const index = /^[1-9]\d*$/.test(command.args) ? Number(command.args) : 0;
                const selected = (index ? processes[index - 1] : undefined)
                    ?? await this.deps.store.getProcess(command.args, workspaceId);
                if (!selected || selected.metadata?.workspaceId !== workspaceId) {
                    await reply('Topic not found in the selected repo. Run `list topics`.'); return;
                }
                this.deps.bindings.selectTopic(workspaceId, selected.id);
                await reply(`Selected topic: ${selected.title ?? selected.id}`);
                return;
            }
            if (command.type === 'create-topic') {
                this.deps.bindings.selectTopic(workspaceId, null);
                await reply('Ready for a new topic. Send a message to start.');
                return;
            }
            if (command.type !== 'chat') return;
            if (!command.args) { await reply('Send a message to start a chat.'); return; }
            if (targetId) {
                const process = await this.deps.store.getProcess(targetId, workspaceId);
                if (process?.metadata?.workspaceId !== workspaceId
                    && !this.deps.bindings.entries().some(row => row.processId === targetId && row.workspaceId === workspaceId)) {
                    await reply('Selected topic is unavailable. Run `list topics` or `create topic`.'); return;
                }
            }
            const taskId = randomUUID();
            const processId = targetId ?? toQueueProcessId(taskId);
            const binding: WhatsAppBinding = {
                groupJid: msg.chatJid, workspaceId, processId, taskId, inboundId: msg.messageId,
                outboundIds: [], nextPart: 0, status: 'queued',
            };
            if (!this.deps.bindings.add(binding)) return;
            try {
                await this.deps.enqueue(workspaceId, command.args, command.mode, processId, taskId);
            } catch (error) {
                this.deps.bindings.remove(binding);
                throw error;
            }
            this.deps.bindings.selectTopic(workspaceId, processId);
            this.deps.queued?.(binding);
            try {
                await this.deps.react(msg.messageId);
            } catch (error) {
                console.error('[whatsapp-messaging] Reaction failed:', error);
            }
        } catch (error) {
            console.error('[whatsapp-messaging] Unable to handle inbound message:', error);
            await reply('Could not queue the request. Please try again.');
        }
    }
}
