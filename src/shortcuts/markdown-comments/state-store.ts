/**
 * State persistence implementations for the VS Code extension.
 *
 * Re-exports the StateStore interface from pipeline-core and provides:
 * - VscodeStateStore: wraps vscode.Memento (context.workspaceState)
 * - InMemoryStateStore: for unit tests
 */

import * as vscode from 'vscode';

// Re-export the shared interface from pipeline-core
export type { StateStore } from '@plusplusoneplusplus/pipeline-core';
import type { StateStore } from '@plusplusoneplusplus/pipeline-core';

/** Wraps VS Code's Memento API (workspaceState) as a StateStore. */
export class VscodeStateStore implements StateStore {
    constructor(private readonly memento: vscode.Memento) {}

    get<T>(key: string, defaultValue: T): T {
        return this.memento.get<T>(key, defaultValue);
    }

    async update(key: string, value: unknown): Promise<void> {
        await this.memento.update(key, value);
    }

    keys(): string[] {
        return [...this.memento.keys()];
    }
}

/** In-memory StateStore for unit tests. */
export class InMemoryStateStore implements StateStore {
    private readonly data = new Map<string, unknown>();

    get<T>(key: string, defaultValue: T): T {
        if (this.data.has(key)) {
            return this.data.get(key) as T;
        }
        return defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.data.set(key, value);
    }

    keys(): string[] {
        return Array.from(this.data.keys());
    }

    /** Test helper: clear all stored state. */
    clear(): void {
        this.data.clear();
    }
}
