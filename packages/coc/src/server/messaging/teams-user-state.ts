/**
 * Teams User State
 *
 * Per-user session state for the Teams bot command router.
 * Tracks which repo and chat topic each user has selected.
 * JSON-file-persisted in `<dataDir>/teams-user-state.json`.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface UserState {
    /** Selected workspace/repo ID. */
    selectedRepo: string | null;
    /** Explicitly selected topic (process ID). */
    selectedTopic: string | null;
    /** Last topic that received a message from this user. */
    lastActiveTopic: string | null;
}

interface StateFile {
    [userKey: string]: UserState;
}

export class TeamsUserStateStore {
    private readonly filePath: string;
    private state: StateFile;

    constructor(dataDir: string) {
        this.filePath = path.join(dataDir, 'teams-user-state.json');
        this.state = this.load();
    }

    /** Get state for a user, creating default if absent. */
    get(userKey: string): UserState {
        if (!this.state[userKey]) {
            this.state[userKey] = { selectedRepo: null, selectedTopic: null, lastActiveTopic: null };
        }
        return this.state[userKey];
    }

    /** Update fields for a user and persist. */
    update(userKey: string, patch: Partial<UserState>): UserState {
        const current = this.get(userKey);
        Object.assign(current, patch);
        this.save();
        return current;
    }

    private load(): StateFile {
        try {
            if (fs.existsSync(this.filePath)) {
                return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
            }
        } catch { /* use empty */ }
        return {};
    }

    private save(): void {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
        } catch { /* best effort */ }
    }
}
