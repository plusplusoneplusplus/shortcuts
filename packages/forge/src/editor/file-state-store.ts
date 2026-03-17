/**
 * JSON-file-backed StateStore for serve mode.
 * Follows the FileProcessStore atomic-write pattern (write to .tmp, then rename).
 */

import * as fs from 'fs';
import * as path from 'path';
import { StateStore } from './state-store';

export class FileStateStore implements StateStore {
    private cache: Record<string, unknown> | null = null;

    constructor(private readonly filePath: string) {}

    get<T>(key: string, defaultValue: T): T {
        const data = this.readAll();
        if (key in data) {
            return data[key] as T;
        }
        return defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        const data = this.readAll();
        data[key] = value;
        this.cache = data;
        await this.writeAll(data);
    }

    keys(): string[] {
        return Object.keys(this.readAll());
    }

    private readAll(): Record<string, unknown> {
        if (this.cache) { return this.cache; }
        try {
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            this.cache = JSON.parse(raw);
            return this.cache!;
        } catch {
            this.cache = {};
            return this.cache;
        }
    }

    private async writeAll(data: Record<string, unknown>): Promise<void> {
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true });
        const tmpPath = this.filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmpPath, this.filePath);
    }
}
