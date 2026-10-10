import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase } from '@plusplusoneplusplus/forge';

export function createTodoTestDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sentinel-todos-test-'));
}

export function createTodoTestDatabase(dataDir: string) {
    const db = new NativeDatabase(path.join(dataDir, 'processes.db'));
    initializeDatabase(db);
    let closed = false;
    const close = () => {
        if (closed) return;
        db.close();
        closed = true;
    };
    return {
        dataDir, db, close,
        dispose: () => {
            close();
            fs.rmSync(dataDir, { recursive: true, force: true });
        },
    };
}

export function failTodoWrites(db: NativeDatabase) {
    db.exec(`
        CREATE TEMP TRIGGER sentinel_test_fail_insert BEFORE INSERT ON sentinel_todo_items
        BEGIN SELECT RAISE(ABORT, 'sentinel test write failure'); END;
        CREATE TEMP TRIGGER sentinel_test_fail_update BEFORE UPDATE ON sentinel_todo_items
        BEGIN SELECT RAISE(ABORT, 'sentinel test write failure'); END;
    `);
    return () => db.exec(`
        DROP TRIGGER sentinel_test_fail_insert;
        DROP TRIGGER sentinel_test_fail_update;
    `);
}
