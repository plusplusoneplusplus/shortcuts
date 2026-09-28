/**
 * Synchronous SQLite API backed by coc-native's rusqlite core.
 *
 * The public classes keep the better-sqlite3 call shape used across CoC while
 * the generated native handles use arrays for a small, explicit N-API surface.
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

export type NativeSqliteValue = number | string | Buffer | null;
export type NativeSqliteRow = Record<string, NativeSqliteValue>;
export type NativeSqliteParameters =
    | NativeSqliteValue
    | readonly NativeSqliteValue[]
    | Record<string, NativeSqliteValue>;
export type NativeDatabaseOptions = Bindings.NativeDatabaseOptions;

export interface NativeRunResult {
    changes: number;
    lastInsertRowid: number;
}

export interface NativePragmaOptions {
    simple?: boolean;
}

interface NormalizedParameters {
    values?: NativeSqliteValue[];
    names?: string[];
}

export interface NativeSqliteAddon {
    NativeDatabaseHandle: new (
        path: string,
        options?: NativeDatabaseOptions,
    ) => Bindings.NativeDatabaseHandle;
}

function isSqliteAddon(addon: unknown): addon is NativeSqliteAddon {
    return typeof (addon as NativeSqliteAddon | null)?.NativeDatabaseHandle === 'function';
}

export function loadNativeSqlite(): NativeSqliteAddon {
    const addon = loadNativeAddon();
    if (isSqliteAddon(addon)) return addon;
    const { binaryPath } = nativeAddonStatus();
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${binaryPath} loaded but does not export SQLite.\n` +
            'The binary predates the SQLite capability — rebuild it with ' +
            '`npm run build:native -w packages/coc-native`.',
    );
}

export function nativeSqliteStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded) return status;
    if (isSqliteAddon(loadNativeAddon())) return status;
    return {
        loaded: false,
        binaryPath: status.binaryPath,
        reason: `${status.binaryPath} does not export SQLite`,
    };
}

function isNamedParameters(value: NativeSqliteParameters): value is Record<string, NativeSqliteValue> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function normalizeParameters(parameters: NativeSqliteParameters[]): NormalizedParameters {
    if (parameters.length === 0) return {};
    const first = parameters[0];
    if (parameters.length === 1 && Array.isArray(first)) {
        return { values: [...first] };
    }
    if (parameters.length === 1 && isNamedParameters(first)) {
        const names = Object.keys(first);
        return { names, values: names.map(name => first[name]) };
    }
    return { values: parameters as NativeSqliteValue[] };
}

function withSqliteError<T>(operation: () => T): T {
    try {
        return operation();
    } catch (error) {
        if (error instanceof Error) {
            const match = error.message.match(/\[sqlite:(\d+)\]/);
            if (match) Object.defineProperty(error, 'code', { value: Number(match[1]), enumerable: true });
        }
        throw error;
    }
}

export class NativeStatement {
    public constructor(private readonly handle: Bindings.NativeStatementHandle) {}

    public run(...parameters: NativeSqliteParameters[]): NativeRunResult {
        const { values, names } = normalizeParameters(parameters);
        return withSqliteError(() => {
            const result = this.handle.run(values, names);
            return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        });
    }

    public get<T extends NativeSqliteRow = NativeSqliteRow>(
        ...parameters: NativeSqliteParameters[]
    ): T | undefined {
        const { values, names } = normalizeParameters(parameters);
        return withSqliteError(() => (this.handle.get(values, names) as T | null) ?? undefined);
    }

    public all<T extends NativeSqliteRow = NativeSqliteRow>(...parameters: NativeSqliteParameters[]): T[] {
        const { values, names } = normalizeParameters(parameters);
        return withSqliteError(() => this.handle.all(values, names) as T[]);
    }

    public iterate<T extends NativeSqliteRow = NativeSqliteRow>(
        ...parameters: NativeSqliteParameters[]
    ): IterableIterator<T> {
        const { values, names } = normalizeParameters(parameters);
        const rows = withSqliteError(() => this.handle.iterate(values, names) as T[]);
        return rows[Symbol.iterator]();
    }
}

export class NativeDatabase {
    private readonly handle: Bindings.NativeDatabaseHandle;

    public constructor(path: string, options?: NativeDatabaseOptions) {
        this.handle = withSqliteError(() => new (loadNativeSqlite().NativeDatabaseHandle)(path, options));
    }

    public exec(sql: string): this {
        withSqliteError(() => this.handle.exec(sql));
        return this;
    }

    public pragma<T = NativeSqliteRow[]>(sql: string, options?: NativePragmaOptions): T {
        return withSqliteError(() => {
            const rows = this.handle.pragma(sql) as NativeSqliteRow[];
            if (!options?.simple) return rows as T;
            const row = rows[0];
            return (row === undefined ? undefined : row[Object.keys(row)[0]]) as T;
        });
    }

    public prepare(sql: string): NativeStatement {
        return withSqliteError(() => new NativeStatement(this.handle.prepare(sql)));
    }

    public transaction<Arguments extends unknown[], Return>(
        callback: (...args: Arguments) => Return,
    ): (...args: Arguments) => Return {
        return (...args) =>
            withSqliteError(
                () =>
                    this.handle.transaction(() => {
                        const result = callback(...args);
                        if (
                            typeof result === 'object' &&
                            result !== null &&
                            'then' in result &&
                            typeof result.then === 'function'
                        ) {
                            throw new TypeError('NativeDatabase transaction callbacks must be synchronous');
                        }
                        return result;
                    }) as Return,
            );
    }

    public close(): void {
        withSqliteError(() => this.handle.close());
    }
}
