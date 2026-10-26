import { randomUUID } from 'node:crypto';
import type { BrowserCommand, BrowserCommandResult, BrowserControlRuntime, BrowserNavigationPrompt, BrowserTakeoverState } from '@plusplusoneplusplus/coc-client';
import { browserApprovalSite } from '../llm-tools/browser-navigation-approval';

export interface BrowserRelayClient {
    id: string;
    send(data: string): void;
}

/** One socket serves its selected workspace plus, with background control on, workspaces it retains for active turns. */
interface Capability {
    client: BrowserRelayClient;
    workspaceId: string | null;
    background: Set<string>;
    focused: number;
    humanTakeoverSupported?: boolean;
}

/** Approval memory consulted before an agent navigation loads (see `BrowserNavigationApprovals`). */
export interface BrowserNavigationApprovalStore {
    isAllowed(workspaceId: string, processId: string, site: string): boolean;
    allowOnce(workspaceId: string, processId: string, site: string): void;
    allowAlways(site: string): void;
}

interface Prompt extends BrowserNavigationPrompt {
    client: BrowserRelayClient;
}

interface Pending {
    client: BrowserRelayClient;
    workspaceId: string;
    processId: string;
    framesEnabled: boolean;
    richPasteEnabled: boolean;
    cancel(): void;
    finish(error?: unknown, result?: BrowserCommandResult): void;
    /** Pauses (`true`) or resumes the 60s timer while the action waits on the Switch back notice or a navigation prompt. */
    wait(waiting: boolean): void;
    /** Waiting on the Switch back notice. */
    switchBack?: boolean;
}

/** Targeted messages never enter the global broadcast/container event channel. */
export class BrowserControlRelay implements BrowserControlRuntime {
    private enabled = () => false;
    private framesEnabled = () => false;
    private richPasteEnabled = () => false;
    private backgroundEnabled = () => false;
    private navigationApprovalEnabled = () => true;
    private lastHumanTakeoverPolicy?: boolean;
    private humanTakeoverEnabled = () => false;
    private readonly handoffs = new Map<string, { client: BrowserRelayClient; state: BrowserTakeoverState }>();
    private readonly revokedTakeoverTurns = new Set<string>();
    private readonly takeoverRevisions = new Map<string, number>();
    private sequence = 0;
    private readonly clients = new Map<string, Capability>();
    private readonly pending = new Map<string, Pending>();
    private readonly turns = new WeakMap<AbortSignal, string>();
    private readonly activeTurns = new Map<string, { workspaceId: string; turnId: string; clients: Set<BrowserRelayClient> }>();
    /** Navigation prompts awaiting the user, by check id. */
    private readonly prompts = new Map<string, Prompt>();
    private approvals: BrowserNavigationApprovalStore | undefined;

    finishProcess(workspaceId: string, processId: string): void {
        const key = JSON.stringify([workspaceId, processId]);
        const turn = this.activeTurns.get(key);
        if (!turn) return;
        this.activeTurns.delete(key);
        const handoff = this.handoffs.get(key);
        if (handoff) this.revokedTakeoverTurns.add(JSON.stringify([key, turn.turnId]));
        this.handoffs.delete(key);
        for (const pending of [...this.pending.values()]) if (handoff && pending.workspaceId === workspaceId && pending.processId === processId) {
            pending.cancel(); pending.finish(new Error('Browser conversation turn has finished'));
        }
        for (const prompt of [...this.prompts.values()]) {
            if (prompt.workspaceId === workspaceId && prompt.processId === processId) this.settle(prompt, false);
        }
        for (const client of turn.clients) {
            try { client.send(JSON.stringify({ type: 'browser-turn-finished', workspaceId, processId, turnId: turn.turnId })); }
            catch { /* disconnected */ }
        }
    }

    getHumanTakeoverRevision(workspaceId: string, processId: string): number {
        const key = JSON.stringify([workspaceId, processId]);
        const revision = this.takeoverRevisions.get(key) ?? 0;
        return this.handoffs.has(key) ? -revision : revision;
    }
    getHumanTakeoverEnabled(): boolean { return this.getEnabled() && this.humanTakeoverEnabled() === true; }
    setHumanTakeoverEnabledGetter(getEnabled: () => boolean): void { this.humanTakeoverEnabled = getEnabled; }
    /** Exact socket/turn validation prevents another window or conversation changing privacy ownership. */
    takeoverState(client: BrowserRelayClient, input: unknown): void {
        if (!input || typeof input !== 'object' || !this.getHumanTakeoverEnabled()) return;
        const state = input as BrowserTakeoverState;
        const key = JSON.stringify([state.workspaceId, state.processId]);
        const turn = this.activeTurns.get(key);
        if (!turn || turn.turnId !== state.turnId || !turn.clients.has(client)
            || !['agent', 'taking-over', 'human', 'checking', 'terminated'].includes(state.status)) return;
        const old = this.handoffs.get(key);
        if (old && old.client !== client) return;
        if (state.status !== 'agent' && !old) this.takeoverRevisions.set(key, (this.takeoverRevisions.get(key) ?? 0) + 1);
        if (state.status === 'agent') this.handoffs.delete(key);
        else this.handoffs.set(key, { client, state: { workspaceId: state.workspaceId, processId: state.processId,
            turnId: state.turnId, routingRef: state.routingRef, status: state.status } });
        if (state.status === 'terminated') {
            this.revokedTakeoverTurns.add(JSON.stringify([key, state.turnId]));
            for (const pending of [...this.pending.values()]) if (pending.workspaceId === state.workspaceId && pending.processId === state.processId) {
                pending.cancel(); pending.finish(new Error('Browser human takeover continuation terminated'));
            }
        }
        this.syncPromptWaits(state.workspaceId, state.processId);
    }

    setEnabledGetter(getEnabled: () => boolean): void { this.enabled = getEnabled; }
    getEnabled(): boolean { return this.enabled(); }
    getFramesEnabled(): boolean { return this.getEnabled() && this.framesEnabled() === true; }
    getRichPasteEnabled(): boolean { return this.getFramesEnabled() && this.richPasteEnabled() === true; }
    getBackgroundEnabled(): boolean { return this.getEnabled() && this.backgroundEnabled() === true; }
    setBackgroundEnabledGetter(getEnabled: () => boolean): void {
        this.backgroundEnabled = getEnabled;
        this.syncBackgroundPolicy();
    }
    /** Agent navigations to an unapproved root domain ask the user first; off allows every site. */
    getNavigationApprovalEnabled(): boolean { return this.getEnabled() && this.navigationApprovalEnabled() !== false; }
    setNavigationApprovalEnabledGetter(getEnabled: () => boolean): void {
        this.navigationApprovalEnabled = getEnabled;
        this.syncNavigationApprovalPolicy();
    }
    setNavigationApprovals(approvals: BrowserNavigationApprovalStore): void { this.approvals = approvals; }
    /** Re-applies every live policy; call on runtime config change. */
    syncPolicies(): void {
        const takeoverEnabled = this.getHumanTakeoverEnabled();
        const disabledTransition = this.lastHumanTakeoverPolicy === true && !takeoverEnabled;
        this.lastHumanTakeoverPolicy = takeoverEnabled;
        if (!takeoverEnabled) {
            const hadHandoffs = this.handoffs.size > 0;
            for (const [key, handoff] of this.handoffs) {
                this.revokedTakeoverTurns.add(JSON.stringify([key, handoff.state.turnId]));
                for (const pending of [...this.pending.values()]) if (pending.workspaceId === handoff.state.workspaceId && pending.processId === handoff.state.processId) {
                    pending.cancel(); pending.finish(new Error('Browser human takeover disabled'));
                }
                this.handoffs.delete(key);
            }
            if (hadHandoffs || disabledTransition) for (const capability of this.clients.values()) if (capability.humanTakeoverSupported) capability.client.send(JSON.stringify({ type: 'browser-takeover-policy', enabled: false }));
        }
        this.syncBackgroundPolicy();
        this.syncFramesPolicy();
        this.syncNavigationApprovalPolicy();
    }
    /** Turning approval off allows every navigation still waiting on the user. */
    syncNavigationApprovalPolicy(): void {
        if (this.getNavigationApprovalEnabled()) return;
        for (const prompt of [...this.prompts.values()]) this.settle(prompt, true);
    }
    /** With background control off, sockets serve only their selected workspace. */
    syncBackgroundPolicy(): void {
        if (this.getBackgroundEnabled()) return;
        for (const capability of [...this.clients.values()]) {
            if (!capability.background.size) continue;
            const paused = new Set([...this.handoffs.values()].filter(handoff => handoff.client === capability.client).map(handoff => handoff.state.workspaceId));
            const dropped = new Set([...capability.background].filter(id => !paused.has(id)));
            capability.background = paused;
            if (!capability.workspaceId && !paused.size) this.clients.delete(capability.client.id);
            this.drop(capability.client, dropped);
        }
    }
    setRichPasteEnabledGetter(getEnabled: () => boolean): void {
        this.richPasteEnabled = getEnabled;
        this.syncFramesPolicy();
    }
    setFramesEnabledGetter(getEnabled: () => boolean): void {
        this.framesEnabled = getEnabled;
        this.syncFramesPolicy();
    }
    syncFramesPolicy(): void {
        const enabled = this.getFramesEnabled();
        for (const pending of [...this.pending.values()]) if (pending.framesEnabled !== enabled) {
            pending.cancel();
            pending.finish(new Error('Browser frame policy changed during command'));
        }
        for (const pending of [...this.pending.values()]) if (pending.richPasteEnabled && !this.getRichPasteEnabled()) {
            pending.cancel();
            pending.finish(new Error('Browser rich paste disabled during command'));
        }
    }

    advertise(client: BrowserRelayClient, workspaceId: unknown, focused: unknown, background?: unknown, humanTakeoverSupported?: unknown): void {
        if (typeof workspaceId !== 'string' || !workspaceId || typeof focused !== 'boolean') return;
        const old = this.clients.get(client.id);
        this.serve(client, workspaceId, this.retained(background, workspaceId), focused ? ++this.sequence : old?.focused ?? 0);
        this.clients.get(client.id)!.humanTakeoverSupported = humanTakeoverSupported === true;
    }

    /** Clears the selected workspace; background control may keep retained workspaces served. */
    clear(client: BrowserRelayClient, background?: unknown): void {
        const retained = this.retained(background, null);
        for (const handoff of this.handoffs.values()) if (handoff.client === client) retained.add(handoff.state.workspaceId);
        if (!retained.size) return this.disconnect(client);
        this.serve(client, null, retained, this.clients.get(client.id)?.focused ?? 0);
    }

    disconnect(client: BrowserRelayClient): void {
        for (const [key, handoff] of this.handoffs) if (handoff.client === client) {
            this.revokedTakeoverTurns.add(JSON.stringify([key, handoff.state.turnId])); this.handoffs.delete(key);
        }
        const old = this.clients.get(client.id);
        this.clients.delete(client.id);
        this.drop(client, old ? served(old) : null);
    }

    private retained(background: unknown, workspaceId: string | null): Set<string> {
        if (!this.getBackgroundEnabled() || !Array.isArray(background)) return new Set();
        return new Set(background.filter((id): id is string => typeof id === 'string' && !!id && id.length <= 512 && id !== workspaceId).slice(0, 64));
    }

    private serve(client: BrowserRelayClient, workspaceId: string | null, background: Set<string>, focused: number): void {
        const old = this.clients.get(client.id);
        for (const handoff of this.handoffs.values()) if (handoff.client === client && handoff.state.workspaceId !== workspaceId) background.add(handoff.state.workspaceId);
        this.clients.set(client.id, { client, workspaceId, background, focused, humanTakeoverSupported: old?.humanTakeoverSupported });
        if (!old) return;
        const dropped = new Set([...served(old)].filter(id => id !== workspaceId && !background.has(id)));
        if (dropped.size) this.drop(client, dropped);
    }

    /** Rejects the socket's pending calls and turn routes for the given workspaces (all when null). */
    private drop(client: BrowserRelayClient, workspaces: Set<string> | null): void {
        for (const prompt of [...this.prompts.values()]) {
            if (prompt.client === client && (!workspaces || workspaces.has(prompt.workspaceId))) this.settle(prompt, false);
        }
        for (const [key, turn] of this.activeTurns) {
            if (workspaces && !workspaces.has(turn.workspaceId)) continue;
            turn.clients.delete(client);
            if (!turn.clients.size) this.activeTurns.delete(key);
        }
        for (const pending of [...this.pending.values()]) {
            if (pending.client === client && (!workspaces || workspaces.has(pending.workspaceId))) {
                pending.finish(new Error('CoC desktop window disconnected during browser command'));
            }
        }
    }

    reply(client: BrowserRelayClient, reply: unknown): void {
        this.syncPolicies();
        if (!reply || typeof reply !== 'object') return;
        const value = reply as { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
        if (typeof value.id !== 'string') return;
        const pending = this.pending.get(value.id);
        if (!pending || pending.client !== client) return;
        if (value.ok === false && typeof value.error === 'string') {
            pending.finish(new Error(value.error));
        } else if (value.ok === true && this.handoffs.has(JSON.stringify([pending.workspaceId, pending.processId]))) {
            pending.finish(new Error('unknown-outcome: late browser observation discarded during human takeover; do not replay'));
        } else if (value.ok === true && isResult(value.result)) {
            pending.finish(undefined, value.result);
        } else if (value.ok === true && pending.framesEnabled) {
            pending.finish(new Error('Browser returned an invalid frame result'));
        }
    }

    /** A background action waits for the user's Switch back, which does not count toward the 60s limit. */
    waiting(client: BrowserRelayClient, id: unknown, waiting: unknown): void {
        if (typeof id !== 'string' || typeof waiting !== 'boolean') return;
        const pending = this.pending.get(id);
        if (!pending || pending.client !== client || waiting && !this.getBackgroundEnabled()) return;
        pending.switchBack = waiting;
        pending.wait(waiting || this.asking(pending.workspaceId, pending.processId));
    }

    /**
     * The desktop host holds an agent-driven top-level navigation of an active turn.
     * Approved, exempt or ungated sites resume at once; otherwise the user is asked in
     * the conversation's chat and the turn's pending actions stop counting toward 60s.
     */
    navigationCheck(client: BrowserRelayClient, message: unknown): void {
        if (!message || typeof message !== 'object') return;
        const { checkId, workspaceId, processId, turnId, url } = message as Record<string, unknown>;
        if (!handle(checkId) || this.prompts.has(checkId)) return;
        const decide = (allow: boolean) => {
            try { client.send(JSON.stringify({ type: 'browser-navigation-decision', checkId, allow })); } catch { /* disconnected */ }
        };
        if (typeof workspaceId !== 'string' || typeof processId !== 'string' || typeof turnId !== 'string'
            || typeof url !== 'string' || url.length > 8192) return decide(false);
        const turn = this.activeTurns.get(JSON.stringify([workspaceId, processId]));
        if (!turn || turn.turnId !== turnId || !turn.clients.has(client)) return decide(false);
        const site = browserApprovalSite(url);
        if (!this.getNavigationApprovalEnabled() || !site || this.approvals?.isAllowed(workspaceId, processId, site)) return decide(true);
        const prompt: Prompt = { client, checkId, workspaceId, processId, turnId, site, url };
        this.prompts.set(checkId, prompt);
        this.syncPromptWaits(workspaceId, processId);
        try { client.send(JSON.stringify({ type: 'browser-navigation-prompt', prompt: { checkId, workspaceId, processId, turnId, site, url } })); }
        catch { this.settle(prompt, false); }
    }

    /** The user's answer from the prompt card; "Deny" fails the turn's pending actions. */
    navigationAnswer(client: BrowserRelayClient, checkId: unknown, answer: unknown): void {
        const prompt = typeof checkId === 'string' ? this.prompts.get(checkId) : undefined;
        if (!prompt || prompt.client !== client || !['once', 'always', 'deny'].includes(answer as string)) return;
        if (answer === 'deny') {
            this.settle(prompt, false);
            for (const pending of [...this.pending.values()]) {
                if (pending.client !== client || pending.workspaceId !== prompt.workspaceId || pending.processId !== prompt.processId) continue;
                pending.cancel();
                pending.finish(new Error(`user denied access to ${prompt.site}`));
            }
            return;
        }
        if (answer === 'always') this.approvals?.allowAlways(prompt.site);
        else this.approvals?.allowOnce(prompt.workspaceId, prompt.processId, prompt.site);
        this.settle(prompt, true);
        // Other held navigations of this conversation to the same site no longer need asking.
        for (const other of [...this.prompts.values()]) {
            if (other.site === prompt.site && other.workspaceId === prompt.workspaceId && other.processId === prompt.processId) this.settle(other, true);
        }
    }

    /** Resolves a held navigation and removes its card. */
    private settle(prompt: Prompt, allow: boolean): void {
        if (!this.prompts.delete(prompt.checkId)) return;
        for (const message of [
            { type: 'browser-navigation-decision', checkId: prompt.checkId, allow },
            { type: 'browser-navigation-prompt-cleared', checkId: prompt.checkId },
        ]) {
            try { prompt.client.send(JSON.stringify(message)); } catch { /* disconnected */ }
        }
        this.syncPromptWaits(prompt.workspaceId, prompt.processId);
    }

    private asking(workspaceId: string, processId: string): boolean {
        for (const prompt of this.prompts.values()) if (prompt.workspaceId === workspaceId && prompt.processId === processId) return true;
        return this.handoffs.has(JSON.stringify([workspaceId, processId]));
    }

    /** A conversation's actions wait without a time limit while one of its navigations awaits the user. */
    private syncPromptWaits(workspaceId: string, processId: string): void {
        const asking = this.asking(workspaceId, processId);
        for (const pending of this.pending.values()) {
            if (pending.workspaceId === workspaceId && pending.processId === processId) pending.wait(asking || pending.switchBack === true);
        }
    }

    execute(workspaceId: string, processId: string, command: BrowserCommand, selectedTab?: string, signal?: AbortSignal, controllingTurnId?: string, observedTakeoverRevision?: number): Promise<BrowserCommandResult> {
        if (!this.getEnabled()) return Promise.reject(new Error('Browser control is disabled'));
        this.syncPolicies();
        const framesEnabled = this.getFramesEnabled();
        const richPasteEnabled = command.action === 'paste_html' && this.getRichPasteEnabled();
        if (command.action === 'request_human' && !this.getHumanTakeoverEnabled()) return Promise.reject(new Error('Browser human takeover is disabled'));
        if (command.action === 'paste_html' && !richPasteEnabled) return Promise.reject(new Error('Browser rich paste is disabled'));
        if (!framesEnabled && (command.action === 'frames' || command.frame !== undefined)) {
            return Promise.reject(new Error('Browser frame control is disabled'));
        }
        if (signal?.aborted) return Promise.reject(signal.reason);
        const suppliedTurn = controllingTurnId ?? (signal && this.turns.get(signal));
        if (suppliedTurn && this.revokedTakeoverTurns.has(JSON.stringify([JSON.stringify([workspaceId, processId]), suppliedTurn]))) return Promise.reject(new Error('Browser human takeover continuation terminated; start a new conversation turn'));
        // A window showing the workspace wins over one keeping it in the background.
        const paused = this.handoffs.get(JSON.stringify([workspaceId, processId]));
        if (paused?.state.status === 'terminated' && (!controllingTurnId || paused.state.turnId === controllingTurnId)) return Promise.reject(new Error('Browser human takeover continuation terminated'));
        const selected = [...this.clients.values()].filter(client => (!paused || client.client === paused.client) && (client.workspaceId === workspaceId || client.background.has(workspaceId)))
            .sort((a, b) => Number(b.workspaceId === workspaceId) - Number(a.workspaceId === workspaceId) || b.focused - a.focused)[0];
        if (!selected) return Promise.reject(new Error('No CoC desktop window is open for this workspace'));
        const client = selected.client;
        if (command.action === 'request_human' && !selected.humanTakeoverSupported) return Promise.reject(new Error('Unsupported desktop capability: browser human takeover'));
        const id = randomUUID();
        let turnId = controllingTurnId ?? (signal && this.turns.get(signal));
        if (!turnId) {
            turnId = randomUUID();
            if (signal) this.turns.set(signal, turnId);
        }
        const turnKey = JSON.stringify([workspaceId, processId]);
        const previous = this.activeTurns.get(turnKey);
        if (previous && previous.turnId !== turnId) this.finishProcess(workspaceId, processId);
        const turn = this.activeTurns.get(turnKey) ?? { workspaceId, turnId, clients: new Set<BrowserRelayClient>() };
        turn.clients.add(client);
        this.activeTurns.set(turnKey, turn);
        return new Promise((resolve, reject) => {
            const cancel = () => {
                try { client.send(JSON.stringify({ type: 'browser-command-cancel', id })); } catch { /* disconnected */ }
            };
            const abort = () => {
                if (this.activeTurns.get(turnKey)?.turnId === turnId) this.finishProcess(workspaceId, processId);
                cancel();
                finish(signal?.reason ?? new Error('Browser command cancelled'));
            };
            let remaining = 60_000;
            let started = Date.now();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const startTimer = () => {
                started = Date.now();
                timer = setTimeout(() => {
                    cancel();
                    finish(new Error('Browser command timed out after 60s'));
                }, remaining);
                timer.unref();
            };
            const wait = (waiting: boolean) => {
                if (waiting === (timer === undefined)) return;
                if (!waiting) return startTimer();
                clearTimeout(timer);
                timer = undefined;
                remaining = Math.max(0, remaining - (Date.now() - started));
            };
            startTimer();
            const finish = (error?: unknown, result?: BrowserCommandResult) => {
                if (!this.pending.delete(id)) return;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (error !== undefined) reject(error);
                else if (framesEnabled && command.action !== 'tabs' && (!result?.frame || !result.document
                    || (command.action === 'frames' && !result.frames))) {
                    reject(new Error('Unsupported desktop capability: browser frame control requires frame-aware results'));
                } else resolve(result!);
            };
            this.pending.set(id, { client, workspaceId, processId, framesEnabled, richPasteEnabled, cancel, finish, wait });
            if (this.asking(workspaceId, processId)) wait(true);
            signal?.addEventListener('abort', abort, { once: true });
            try { client.send(JSON.stringify({ type: 'browser-command', request: { id, turnId, workspaceId, processId, command, selectedTab, framesEnabled, ...(observedTakeoverRevision !== undefined && observedTakeoverRevision !== this.getHumanTakeoverRevision(workspaceId, processId) ? { validateAfterTakeover: true } : {}), ...(this.getHumanTakeoverEnabled() && selected.humanTakeoverSupported ? { humanTakeoverEnabled: true } : {}), ...(richPasteEnabled ? { richPasteEnabled: true } : {}) } })); }
            catch (error) { finish(error); }
        });
    }
}

function served(capability: Capability): Set<string> {
    return new Set([...(capability.workspaceId ? [capability.workspaceId] : []), ...capability.background]);
}

function isResult(value: unknown): value is BrowserCommandResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const result = value as Record<string, unknown>;
    if (Object.keys(result).some(key => !['tab', 'title', 'url', 'tabs', 'elements', 'interactiveElements', 'frames', 'frame', 'document', 'truncated', 'text', 'textTotal', 'value', 'valueJson', 'valueTruncated', 'image', 'handoffNote'].includes(key))) return false;
    if ('valueJson' in result && typeof result.valueJson !== 'string') return false;
    if ('valueTruncated' in result && typeof result.valueTruncated !== 'boolean') return false;
    for (const key of ['tab', 'title', 'url', 'text', 'handoffNote']) if (key in result && typeof result[key] !== 'string') return false;
    for (const key of ['frame', 'document']) if (key in result && !handle(result[key])) return false;
    if ('truncated' in result && (typeof result.truncated !== 'string' || !result.truncated.trim() || result.truncated.length > 1024)) return false;
    if ('frames' in result) {
        if (!Array.isArray(result.frames) || result.frames.length > 32) return false;
        const ids = new Set<string>();
        for (const frame of result.frames) {
            if (!frame || typeof frame !== 'object' || Array.isArray(frame)
                || Object.keys(frame).some(key => !['id', 'parent', 'origin', 'name', 'document', 'status', 'depth'].includes(key))
                || !handle(frame.id) || ids.has(frame.id) || !handle(frame.document)
                || ('parent' in frame && (!handle(frame.parent) || frame.parent === frame.id))
                || typeof frame.name !== 'string' || frame.name.length > 160
                || typeof frame.origin !== 'string' || frame.origin.length > 256
                || !['ready', 'loading', 'unavailable'].includes(frame.status)
                || !Number.isSafeInteger(frame.depth) || frame.depth < 0 || frame.depth > 8) return false;
            ids.add(frame.id);
        }
    }
    if ('tabs' in result && (!Array.isArray(result.tabs) || result.tabs.some(tab => !tab || typeof tab !== 'object' || Array.isArray(tab) || typeof tab.id !== 'string'
        || typeof tab.title !== 'string' || typeof tab.url !== 'string' || !['electron', 'webview2'].includes(tab.engine)))) return false;
    for (const key of ['elements', 'interactiveElements']) {
        if (key in result && (!Array.isArray(result[key]) || result[key].some(element => !element
            || typeof element !== 'object' || Array.isArray(element)
            || Object.keys(element).some(key => !['ref', 'role', 'name', 'depth', 'checked', 'frame'].includes(key))
            || typeof element.ref !== 'string' || typeof element.role !== 'string' || typeof element.name !== 'string'
            || !Number.isSafeInteger(element.depth) || element.depth < 0
            || ('checked' in element && typeof element.checked !== 'boolean')
            || ('frame' in element && !handle(element.frame))))) return false;
        if (Array.isArray(result[key]) && new Set(result[key].map(element => element.ref)).size !== result[key].length) return false;
    }
    if (Array.isArray(result.frames)) {
        const frames = new Map(result.frames.map(frame => [frame.id, frame]));
        if ('frame' in result && frames.has(result.frame) && frames.get(result.frame).document !== result.document) return false;
        for (const frame of result.frames) {
            const ancestors = new Set<string>([frame.id]);
            let parent = frame.parent;
            while (parent && frames.has(parent)) {
                if (ancestors.has(parent)) return false;
                ancestors.add(parent);
                const ancestor = frames.get(parent);
                if (ancestor.depth >= frame.depth) return false;
                parent = ancestor.parent;
            }
        }
        const refs = new Map<string, string>();
        for (const element of [...(result.elements as BrowserCommandResult['elements'] ?? []),
            ...(result.interactiveElements as BrowserCommandResult['interactiveElements'] ?? [])]) {
            if (!/^e[1-9]\d*$/.test(element.ref) || !element.frame || !frames.has(element.frame)
                || (refs.has(element.ref) && refs.get(element.ref) !== element.frame)) return false;
            refs.set(element.ref, element.frame);
        }
    }
    if ('textTotal' in result && (!Number.isSafeInteger(result.textTotal) || Number(result.textTotal) < 0)) return false;
    if ('image' in result) {
        const image = result.image as Record<string, unknown> | null;
        if (!image || image.mimeType !== 'image/jpeg' || typeof image.data !== 'string'
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return false;
    }
    return true;
}

function handle(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s|[\]]/.test(value);
}
