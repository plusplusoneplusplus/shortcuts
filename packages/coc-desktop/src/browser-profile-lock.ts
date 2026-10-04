import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserHostError } from './browser-host-contract';

/** SQLite's OS lock is portable and released even when the desktop process crashes. */
export function lockElectronProfile(profilePath: string): NativeDatabase {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    let database: NativeDatabase | undefined;
    try {
        database = new NativeDatabase(path.join(path.dirname(profilePath), 'electron-profile-lock.sqlite'));
        database.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
        return database;
    } catch (error) {
        database?.close();
        if (error && typeof error === 'object' && 'code' in error && (error.code === 5 || error.code === 6)) {
            throw new BrowserHostError('profile-locked', 'The Electron browser profile is in use. Close the other desktop process and retry.');
        }
        throw error;
    }
}
