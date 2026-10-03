use std::fs;

use coc_native_core::sqlite::process_reads::{
    get_all_processes, get_all_processes_json, get_conversation_turns, get_conversation_turns_json,
    get_process_summaries, get_process_summaries_json, list_recent_processes,
    list_recent_processes_json, ProcessFilter, RecentFilter,
};
use coc_native_core::sqlite::process_search::{
    sanitize_fts_query, search_conversations, SearchFilter,
};
use coc_native_core::sqlite::process_writes::{upsert_streaming_turn, StreamingTurnInput};
use coc_native_core::sqlite::{Database, Error, Parameters, Value};
use tempfile::tempdir;

fn positional(values: impl IntoIterator<Item = Value>) -> Parameters {
    Parameters::Positional(values.into_iter().collect())
}

#[test]
fn database_handles_can_cross_worker_threads() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Database>();
}

#[test]
fn executes_queries_and_preserves_sqlite_value_types() {
    let database = Database::open(":memory:", false).unwrap();
    database
        .exec("CREATE TABLE values_table (id INTEGER PRIMARY KEY, real REAL, text TEXT, blob BLOB, nullable TEXT)")
        .unwrap();
    let result = database
        .prepare("INSERT INTO values_table (real, text, blob, nullable) VALUES (?, ?, ?, ?)")
        .run(&positional([
            Value::Real(1.25),
            Value::Text("hello".into()),
            Value::Blob(vec![0, 1, 255]),
            Value::Null,
        ]))
        .unwrap();
    assert_eq!(result.changes, 1);
    assert_eq!(result.last_insert_rowid, 1);

    let row = database
        .prepare("SELECT id, real, text, blob, nullable FROM values_table")
        .get(&Parameters::None)
        .unwrap()
        .unwrap();
    assert_eq!(row["id"], Value::Integer(1));
    assert_eq!(row["real"], Value::Real(1.25));
    assert_eq!(row["text"], Value::Text("hello".into()));
    assert_eq!(row["blob"], Value::Blob(vec![0, 1, 255]));
    assert_eq!(row["nullable"], Value::Null);
}

#[test]
fn supports_all_sqlite_named_parameter_prefixes() {
    let database = Database::open(":memory:", false).unwrap();
    let row = database
        .prepare("SELECT @at AS at_value, :colon AS colon_value, $dollar AS dollar_value")
        .get(&Parameters::Named(vec![
            ("at".into(), Value::Integer(1)),
            ("colon".into(), Value::Integer(2)),
            ("dollar".into(), Value::Integer(3)),
        ]))
        .unwrap()
        .unwrap();
    assert_eq!(row["at_value"], Value::Integer(1));
    assert_eq!(row["colon_value"], Value::Integer(2));
    assert_eq!(row["dollar_value"], Value::Integer(3));
}

#[test]
fn cached_writer_statements_clear_bindings_and_follow_schema_changes() {
    let database = Database::open(":memory:", false).unwrap();
    database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)").unwrap();
    let insert = database.prepare("INSERT INTO items (id, value) VALUES (@id, @value)");
    insert
        .run(&Parameters::Named(vec![
            ("id".into(), Value::Integer(1)),
            ("value".into(), Value::Text("first".into())),
        ]))
        .unwrap();
    insert.run(&Parameters::Named(vec![("id".into(), Value::Integer(2))])).unwrap();

    let lookup = database.prepare("SELECT value FROM items WHERE id = ?");
    assert_eq!(
        lookup.get(&positional([Value::Integer(1)])).unwrap().unwrap()["value"],
        Value::Text("first".into())
    );
    assert_eq!(
        lookup.get(&positional([Value::Integer(2)])).unwrap().unwrap()["value"],
        Value::Null
    );
    let list = database.prepare("SELECT value FROM items WHERE id >= @start ORDER BY id");
    assert_eq!(
        list.all(&Parameters::Named(vec![("start".into(), Value::Integer(1))]))
            .unwrap()
            .into_iter()
            .map(|row| row["value"].clone())
            .collect::<Vec<_>>(),
        vec![Value::Text("first".into()), Value::Null]
    );
    assert_eq!(
        list.all(&Parameters::Named(vec![("start".into(), Value::Integer(2))])).unwrap().len(),
        1
    );
    database.exec("ALTER TABLE items ADD COLUMN extra TEXT").unwrap();
    assert_eq!(
        lookup.get(&positional([Value::Integer(1)])).unwrap().unwrap()["value"],
        Value::Text("first".into())
    );
    assert_eq!(
        list.all(&Parameters::Named(vec![("start".into(), Value::Integer(1))])).unwrap().len(),
        2
    );
}

#[test]
fn all_and_iterate_return_every_row() {
    let database = Database::open(":memory:", false).unwrap();
    database
        .exec("CREATE TABLE items (value INTEGER); INSERT INTO items VALUES (1), (2), (3)")
        .unwrap();
    let statement = database.prepare("SELECT value FROM items ORDER BY value");
    let all = statement.all(&Parameters::None).unwrap();
    let iterated = statement.iterate(&Parameters::None).unwrap();
    assert_eq!(all, iterated);
    assert_eq!(all.len(), 3);
    assert_eq!(all[2]["value"], Value::Integer(3));
}

#[test]
fn get_returns_the_first_row() {
    let database = Database::open(":memory:", false).unwrap();
    let row = database
        .prepare("SELECT 1 AS value UNION ALL SELECT CAST(x'FF' AS TEXT)")
        .get(&Parameters::None)
        .unwrap()
        .unwrap();
    assert_eq!(row["value"], Value::Integer(1));
    assert!(database
        .prepare("SELECT 1 AS value UNION ALL SELECT CAST(x'FF' AS TEXT)")
        .all(&Parameters::None)
        .is_err());
    assert_eq!(database.prepare("SELECT 1 WHERE 0").get(&Parameters::None).unwrap(), None);
}

#[test]
fn pragma_returns_rows_and_applies_assignments() {
    let database = Database::open(":memory:", false).unwrap();
    database.pragma("user_version = 17").unwrap();
    let rows = database.pragma("user_version").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["user_version"], Value::Integer(17));
}

#[test]
fn transaction_commits_and_rolls_back_callback_failures() {
    let database = Database::open(":memory:", false).unwrap();
    database.exec("CREATE TABLE items (value INTEGER UNIQUE)").unwrap();
    let insert = database.prepare("INSERT INTO items VALUES (?)");
    database
        .transaction(|| {
            insert.run(&positional([Value::Integer(1)]))?;
            Ok(())
        })
        .unwrap();

    let error = database
        .transaction(|| {
            insert.run(&positional([Value::Integer(2)]))?;
            insert.run(&positional([Value::Integer(1)]))?;
            Ok(())
        })
        .unwrap_err();
    assert!(error.extended_code().is_some());
    let rows =
        database.prepare("SELECT value FROM items ORDER BY value").all(&Parameters::None).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["value"], Value::Integer(1));
}

#[test]
fn file_database_supports_wal_pooled_reads_and_readonly_handles() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("database.sqlite");
    let database = Database::open(&path, false).unwrap();
    database.exec("PRAGMA journal_mode = WAL; CREATE TABLE items (value TEXT); INSERT INTO items VALUES ('visible')").unwrap();
    let rows = database
        .with_read_connection(|connection| {
            let value: String =
                connection.query_row("SELECT value FROM items", [], |row| row.get(0))?;
            let mmap_size: i64 = connection.query_row("PRAGMA mmap_size", [], |row| row.get(0))?;
            assert_eq!(mmap_size, 64 * 1024 * 1024);
            Ok(value)
        })
        .unwrap();
    assert_eq!(rows, "visible");
    database.close().unwrap();

    let readonly = Database::open(&path, true).unwrap();
    assert!(readonly
        .prepare("INSERT INTO items VALUES ('denied')")
        .run(&Parameters::None)
        .is_err());
    assert_eq!(
        readonly.prepare("SELECT value FROM items").all(&Parameters::None).unwrap().len(),
        1
    );
    readonly.close().unwrap();
    assert!(matches!(readonly.with_read_connection(|_| Ok(())), Err(Error::Closed)));
    fs::remove_file(path).unwrap();
}

#[test]
fn close_invalidates_database_and_retained_statements() {
    let database = Database::open(":memory:", false).unwrap();
    let statement = database.prepare("SELECT 1 AS value");
    database.close().unwrap();
    assert!(matches!(database.exec("SELECT 1"), Err(Error::Closed)));
    assert!(matches!(statement.get(&Parameters::None), Err(Error::Closed)));
    assert!(matches!(database.with_read_connection(|_| Ok(())), Err(Error::Closed)));
    assert!(matches!(database.close(), Err(Error::Closed)));
}

#[test]
fn bundled_sqlite_has_fts5() {
    let database = Database::open(":memory:", false).unwrap();
    database
        .exec("CREATE VIRTUAL TABLE documents USING fts5(content); INSERT INTO documents VALUES ('native sqlite search')")
        .unwrap();
    let row = database
        .prepare("SELECT content FROM documents WHERE documents MATCH ?")
        .get(&positional([Value::Text("sqlite".into())]))
        .unwrap()
        .unwrap();
    assert_eq!(row["content"], Value::Text("native sqlite search".into()));
}

#[test]
fn process_search_uses_pooled_reads_and_rejects_unsupported_versions() {
    let directory = tempdir().unwrap();
    let database = Database::open(directory.path().join("search.db"), false).unwrap();
    database.exec("
        PRAGMA journal_mode=WAL;
        PRAGMA user_version=38;
        CREATE TABLE processes (id TEXT PRIMARY KEY, archived INTEGER, workspace_id TEXT, status TEXT,
          type TEXT, last_event_at TEXT, title TEXT, prompt_preview TEXT, start_time TEXT);
        CREATE TABLE conversation_turns (id INTEGER PRIMARY KEY, process_id TEXT, turn_index INTEGER,
          role TEXT, content TEXT, interrupted INTEGER);
        CREATE VIRTUAL TABLE conversation_search USING fts5(content);
        INSERT INTO processes VALUES ('first', 0, 'ws-a', 'completed', 'chat', '2026-01-02',
          NULL, 'preview', '2026-01-01');
        INSERT INTO conversation_turns VALUES (1, 'first', 0, 'user', 'search search search', 0);
        INSERT INTO conversation_turns VALUES (2, 'first', 1, 'assistant', 'search interrupted', 1);
        INSERT INTO conversation_search(rowid, content) VALUES (1, 'search search search'), (2, 'search interrupted');
    ").unwrap();
    assert_eq!(sanitize_fts_query(" \"search*\" (rust)-^:"), "search rust");
    assert_eq!(sanitize_fts_query("\u{FEFF} search\u{00A0}\u{2028}rust\u{FEFF} "), "search rust");
    assert_eq!(sanitize_fts_query("search\u{0085}rust"), "search\u{0085}rust");
    let filter =
        SearchFilter { workspace_id: Some("ws-a".into()), limit: 50, ..SearchFilter::default() };
    let page = search_conversations(&database, "search*", &filter).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.results.len(), 1);
    assert!(page.results[0].snippet.contains("<mark>search</mark>"));
    assert!(page.results[0].rank.is_finite());
    database.pragma("user_version = 39").unwrap();
    assert_eq!(search_conversations(&database, "search", &filter).unwrap().total, 1);
    database.pragma("user_version = 40").unwrap();
    assert!(matches!(
        search_conversations(&database, "search", &filter),
        Err(Error::UnsupportedVersion(40))
    ));
}

#[test]
fn json_process_rows_escape_column_names_once_for_every_row() {
    let database = Database::open(":memory:", false).unwrap();
    database
        .exec(
            "PRAGMA user_version=38;
             CREATE TABLE processes (id TEXT, workspace_id TEXT, last_event_at TEXT);
             INSERT INTO processes VALUES
               ('one', 'ws-a', '2026-01-01'), ('empty', 'ws-a', '2026-01-02');
             CREATE TABLE conversation_turns (
               process_id TEXT, turn_index INTEGER, \"quoted\"\"name\" TEXT,
               bytes BLOB, nonfinite REAL
             );
             INSERT INTO conversation_turns VALUES
               ('one', 0, 'first', X'00FF', 1e999),
               ('one', 1, 'second', NULL, NULL),
               ('bad', 0, CAST(X'80' AS TEXT), NULL, NULL);",
        )
        .unwrap();
    let rows = get_conversation_turns_json(&database, "one").unwrap();
    assert_eq!(
        rows,
        r#"[{"bytes":{"$sqliteBlob":[0,255]},"nonfinite":{"$sqliteNumber":"Infinity"},"process_id":"one","quoted\"name":"first","turn_index":0},{"bytes":null,"nonfinite":null,"process_id":"one","quoted\"name":"second","turn_index":1}]"#
    );
    assert_eq!(
        get_all_processes_json(&database, &ProcessFilter::default()).unwrap(),
        format!(
            r#"[{{"process":{{"id":"empty","last_event_at":"2026-01-02","workspace_id":"ws-a"}},"turns":[]}},{{"process":{{"id":"one","last_event_at":"2026-01-01","workspace_id":"ws-a"}},"turns":{rows}}}]"#
        )
    );
    let parsed: serde_json::Value = serde_json::from_str(&rows).unwrap();
    let original = get_conversation_turns(&database, "one").unwrap();
    assert_eq!(parsed[0]["quoted\"name"], "first");
    assert_eq!(parsed[0]["bytes"], serde_json::json!({"$sqliteBlob": [0, 255]}));
    assert_eq!(parsed[0]["nonfinite"], serde_json::json!({"$sqliteNumber": "Infinity"}));
    assert_eq!(original[1]["quoted\"name"], Value::Text("second".into()));
    assert_eq!(parsed[1]["quoted\"name"], "second");
    assert!(matches!(
        get_conversation_turns(&database, "bad"),
        Err(Error::Sqlite(rusqlite::Error::Utf8Error(2, _)))
    ));
    assert!(matches!(
        get_conversation_turns_json(&database, "bad"),
        Err(Error::Sqlite(rusqlite::Error::Utf8Error(2, _)))
    ));
}

#[test]
fn process_reads_filter_and_group_turns_on_the_read_pool() {
    let directory = tempdir().unwrap();
    let database = Database::open(directory.path().join("reads.db"), false).unwrap();
    database
        .exec(
            "
        PRAGMA journal_mode=WAL; PRAGMA user_version=38;
        CREATE TABLE processes (
          id TEXT PRIMARY KEY, workspace_id TEXT, parent_process_id TEXT, status TEXT,
          type TEXT, start_time TEXT, last_event_at TEXT, end_time TEXT, prompt_preview TEXT,
          error TEXT, title TEXT, custom_title TEXT, last_message_preview TEXT,
          pinned_at TEXT, archived INTEGER, metadata TEXT
        );
        CREATE TABLE conversation_turns (
          id INTEGER PRIMARY KEY, process_id TEXT, turn_index INTEGER, content TEXT
        );
        CREATE TABLE task_groups (workspace_id TEXT, group_id TEXT, type TEXT);
        CREATE TABLE task_group_members (
          id INTEGER PRIMARY KEY, workspace_id TEXT, group_id TEXT, process_id TEXT, linked_at TEXT
        );
        INSERT INTO processes VALUES
          ('one', 'ws-a', NULL, 'completed', 'chat', '2026-01-01', '2026-01-02',
            NULL, 'first', NULL, NULL, NULL, NULL, NULL, 0,
            '{\"__pendingAskUser\":[{\"id\":1}],\"compaction\":{\"count\":2}}'),
          ('two', 'ws-b', 'one', 'running', 'chat', '2026-02-01', '2026-02-02',
            NULL, 'second', NULL, NULL, NULL, NULL, NULL, 0, NULL);
        INSERT INTO conversation_turns VALUES (1, 'one', 2, 'second'), (2, 'one', 0, 'first');
        INSERT INTO task_groups VALUES
          ('ws-a', 'older', 'chat-folder'), ('ws-a', 'newer', 'chat-folder'),
          ('ws-a', 'other', 'for-each');
        INSERT INTO task_group_members VALUES
          (1, 'ws-a', 'older', 'one', '2026-01-01'),
          (2, 'ws-a', 'newer', 'one', '2026-01-01'),
          (3, 'ws-a', 'other', 'two', '2026-02-01'),
          (4, 'ws-a', 'missing', 'two', '2026-03-01');
    ",
        )
        .unwrap();
    assert!(get_conversation_turns(&database, "missing").unwrap().is_empty());
    let turns = get_conversation_turns(&database, "one").unwrap();
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0]["content"], Value::Text("first".into()));
    let turns_json: serde_json::Value =
        serde_json::from_str(&get_conversation_turns_json(&database, "one").unwrap()).unwrap();
    assert_eq!(turns_json[0]["content"], "first");
    assert_eq!(turns_json[1]["content"], "second");
    assert_eq!(get_conversation_turns_json(&database, "missing").unwrap(), "[]");

    let all = get_all_processes(&database, &ProcessFilter::default()).unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].process["id"], Value::Text("two".into()));
    assert_eq!(all[1].turns.as_ref().unwrap(), &turns);
    let filter = ProcessFilter {
        workspace_id: Some("ws-a".into()),
        statuses: Some(vec!["completed".into()]),
        since: Some("2026-01-01".into()),
        until: Some("2026-01-02".into()),
        limit: Some(1),
        offset: Some(0),
        ..ProcessFilter::default()
    };
    assert_eq!(get_all_processes(&database, &filter).unwrap().len(), 1);
    assert!(get_all_processes(
        &database,
        &ProcessFilter { statuses: Some(vec![]), ..ProcessFilter::default() }
    )
    .unwrap()
    .is_empty());
    let summaries = get_process_summaries(
        &database,
        &ProcessFilter {
            workspace_id: Some("ws-a".into()),
            limit: Some(1),
            ..ProcessFilter::default()
        },
    )
    .unwrap();
    assert_eq!(summaries.total, 1);
    assert_eq!(summaries.rows[0]["pending_ask_user_count"], Value::Integer(1));
    assert_eq!(summaries.rows[0]["compaction_json"], Value::Text("{\"count\":2}".into()));
    assert_eq!(summaries.rows[0]["folder_id"], Value::Text("newer".into()));
    assert_eq!(summaries.rows[0]["bot_control_json"], Value::Null);
    database
        .exec(
            r#"UPDATE processes SET metadata = json_set(metadata, '$.botControl',
                json('{"state":"active","source":"teams","controllerKey":"teams-bridge","controllerLabel":"Teams bridge"}'))
                WHERE id = 'one'"#,
        )
        .unwrap();
    let summary_json = get_process_summaries_json(
        &database,
        &ProcessFilter {
            workspace_id: Some("ws-a".into()),
            limit: Some(1),
            ..ProcessFilter::default()
        },
    )
    .unwrap();
    let page: serde_json::Value = serde_json::from_str(&summary_json).unwrap();
    assert_eq!(page["total"], 1);
    assert_eq!(page["rows"][0]["pending_ask_user_count"], 1);
    assert_eq!(page["rows"][0]["compaction_json"], "{\"count\":2}");
    assert_eq!(page["rows"][0]["folder_id"], "newer");
    assert_eq!(
        page["rows"][0]["bot_control_json"],
        r#"{"state":"active","source":"teams","controllerKey":"teams-bridge","controllerLabel":"Teams bridge"}"#
    );
    database
        .prepare("UPDATE processes SET title = ? WHERE id = 'two'")
        .run(&positional([Value::Text("Title \"two\"\nnext".into())]))
        .unwrap();
    let full_summary_json =
        get_process_summaries_json(&database, &ProcessFilter::default()).unwrap();
    let full_page: serde_json::Value = serde_json::from_str(&full_summary_json).unwrap();
    assert_eq!(full_page["total"], 2);
    assert_eq!(full_page["rows"][0]["id"], "two");
    assert_eq!(full_page["rows"][1]["id"], "one");
    assert_eq!(full_page["rows"][0]["title"], "Title \"two\"\nnext");
    assert!(full_page["rows"][0]["folder_id"].is_null());
    assert!(full_summary_json.contains(r#""title":"Title \"two\"\nnext""#));
    let offset_page: serde_json::Value = serde_json::from_str(
        &get_process_summaries_json(
            &database,
            &ProcessFilter { limit: Some(1), offset: Some(1), ..ProcessFilter::default() },
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(offset_page["total"], 2);
    assert_eq!(offset_page["rows"].as_array().unwrap().len(), 1);
    assert_eq!(offset_page["rows"][0]["id"], "one");
    assert_eq!(
        get_process_summaries_json(
            &database,
            &ProcessFilter { statuses: Some(vec![]), ..ProcessFilter::default() }
        )
        .unwrap(),
        r#"{"total":0,"rows":[]}"#
    );
    let recent = list_recent_processes(
        &database,
        &RecentFilter {
            limit: 100,
            exclude_process_id: Some("two".into()),
            ..RecentFilter::default()
        },
    )
    .unwrap();
    assert_eq!(recent.len(), 1);
    assert_eq!(recent[0]["id"], Value::Text("one".into()));
    let recent_json: serde_json::Value = serde_json::from_str(
        &list_recent_processes_json(
            &database,
            &RecentFilter {
                limit: 100,
                exclude_process_id: Some("two".into()),
                ..RecentFilter::default()
            },
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(recent_json[0]["id"], "one");
    assert_eq!(recent_json.as_array().unwrap().len(), recent.len());
    let page: serde_json::Value = serde_json::from_str(
        &list_recent_processes_json(
            &database,
            &RecentFilter { limit: 2, ..RecentFilter::default() },
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(page[0]["id"], "two");
    assert_eq!(page[1]["id"], "one");
    assert_eq!(page[1]["compaction_json"], r#"{"count":2}"#);
    assert_eq!(
        list_recent_processes_json(
            &database,
            &RecentFilter {
                limit: 10,
                workspace_id: Some("ws-missing".into()),
                ..RecentFilter::default()
            }
        )
        .unwrap(),
        "[]"
    );
    assert!(list_recent_processes(
        &database,
        &RecentFilter {
            limit: 10,
            workspace_id: Some("ws-missing".into()),
            ..RecentFilter::default()
        }
    )
    .unwrap()
    .is_empty());
    database.pragma("user_version = 39").unwrap();
    assert!(get_conversation_turns(&database, "one").is_ok());
    assert!(get_conversation_turns_json(&database, "one").is_ok());
    assert!(get_all_processes(&database, &filter).is_ok());
    assert!(get_process_summaries(&database, &filter).is_ok());
    assert!(get_process_summaries_json(&database, &filter).is_ok());
    assert!(list_recent_processes(&database, &RecentFilter { limit: 10, ..RecentFilter::default() }).is_ok());
    assert!(list_recent_processes_json(&database, &RecentFilter { limit: 10, ..RecentFilter::default() }).is_ok());
    database.pragma("user_version = 40").unwrap();
    assert!(matches!(get_conversation_turns(&database, "one"), Err(Error::UnsupportedVersion(40))));
    assert!(matches!(
        get_conversation_turns_json(&database, "one"),
        Err(Error::UnsupportedVersion(40))
    ));
    assert!(matches!(get_all_processes(&database, &filter), Err(Error::UnsupportedVersion(40))));
    assert!(matches!(
        get_process_summaries(&database, &filter),
        Err(Error::UnsupportedVersion(40))
    ));
    assert!(matches!(
        get_process_summaries_json(&database, &filter),
        Err(Error::UnsupportedVersion(40))
    ));
    assert!(matches!(
        list_recent_processes(&database, &RecentFilter { limit: 10, ..RecentFilter::default() }),
        Err(Error::UnsupportedVersion(40))
    ));
    assert!(matches!(
        list_recent_processes_json(
            &database,
            &RecentFilter { limit: 10, ..RecentFilter::default() }
        ),
        Err(Error::UnsupportedVersion(40))
    ));
}

#[test]
fn get_all_processes_batches_turns_without_changing_process_or_turn_order() {
    let directory = tempdir().unwrap();
    let database = Database::open(directory.path().join("batched-reads.db"), false).unwrap();
    database
        .exec(
            "
        PRAGMA journal_mode=WAL; PRAGMA user_version=38;
        CREATE TABLE processes (
            id TEXT PRIMARY KEY, workspace_id TEXT, last_event_at TEXT
        );
        CREATE TABLE conversation_turns (
            id INTEGER PRIMARY KEY, process_id TEXT, turn_index INTEGER, content TEXT,
            UNIQUE(process_id, turn_index)
        );
        CREATE INDEX idx_turns_process_id ON conversation_turns(process_id);
    ",
        )
        .unwrap();
    let insert_process = database
        .prepare("INSERT INTO processes (id, workspace_id, last_event_at) VALUES (?, ?, ?)");
    let insert_turn = database.prepare(
        "INSERT INTO conversation_turns (process_id, turn_index, content) VALUES (?, ?, ?)",
    );
    database
        .transaction(|| {
            for index in 0..502 {
                let id = format!("p-{index:03}");
                insert_process.run(&positional([
                    Value::Text(id.clone()),
                    Value::Text("ws-a".into()),
                    Value::Text(format!("{index:03}")),
                ]))?;
                if index != 501 {
                    for turn_index in [2, 0] {
                        insert_turn.run(&positional([
                            Value::Text(id.clone()),
                            Value::Integer(turn_index),
                            Value::Text(format!("{id}-{turn_index}")),
                        ]))?;
                    }
                }
            }
            insert_process.run(&positional([
                Value::Text("other-workspace".into()),
                Value::Text("ws-b".into()),
                Value::Text("999".into()),
            ]))?;
            insert_turn.run(&positional([
                Value::Text("other-workspace".into()),
                Value::Integer(0),
                Value::Text("not in ws-a".into()),
            ]))?;
            Ok(())
        })
        .unwrap();

    let filter = ProcessFilter { workspace_id: Some("ws-a".into()), ..ProcessFilter::default() };
    let processes = get_all_processes(&database, &filter).unwrap();
    assert_eq!(processes.len(), 502);
    assert_eq!(processes[0].process["id"], Value::Text("p-501".into()));
    assert_eq!(processes[0].turns.as_ref().unwrap(), &[]);
    for index in [1, 499, 500, 501] {
        let id = format!("p-{:03}", 501 - index);
        assert_eq!(processes[index].process["id"], Value::Text(id.clone()));
        assert_eq!(
            processes[index].turns.as_ref().unwrap(),
            &get_conversation_turns(&database, &id).unwrap()
        );
        assert_eq!(processes[index].turns.as_ref().unwrap()[0]["turn_index"], Value::Integer(0));
    }
    let json: serde_json::Value =
        serde_json::from_str(&get_all_processes_json(&database, &filter).unwrap()).unwrap();
    assert_eq!(json.as_array().unwrap().len(), 502);
    assert_eq!(json[0]["process"]["id"], "p-501");
    assert_eq!(json[0]["turns"], serde_json::json!([]));
    for index in [1, 499, 500, 501] {
        assert_eq!(json[index]["process"]["id"], format!("p-{:03}", 501 - index));
        assert_eq!(json[index]["turns"][0]["turn_index"], 0);
        assert_eq!(json[index]["turns"][1]["turn_index"], 2);
    }
    let page = get_all_processes(
        &database,
        &ProcessFilter { limit: Some(2), offset: Some(500), ..filter.clone() },
    )
    .unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!(page[0].process["id"], Value::Text("p-001".into()));
    assert_eq!(page[1].process["id"], Value::Text("p-000".into()));
    assert_eq!(page[0].turns.as_ref().unwrap().len(), 2);
    insert_process
        .run(&positional([
            Value::Blob(vec![0xff]),
            Value::Text("ws-a".into()),
            Value::Text("999".into()),
        ]))
        .unwrap();
    assert!(matches!(
        get_all_processes_json(&database, &filter),
        Err(Error::Sqlite(rusqlite::Error::InvalidColumnName(column))) if column == "id"
    ));
    assert!(get_all_processes(
        &database,
        &ProcessFilter { workspace_id: Some("missing".into()), ..filter }
    )
    .unwrap()
    .is_empty());
}

#[test]
fn streaming_turn_write_is_atomic_and_uses_the_writer_transaction() {
    let directory = tempdir().unwrap();
    let database = Database::open(directory.path().join("writes.db"), false).unwrap();
    database
        .exec(
            "
        PRAGMA journal_mode=WAL; PRAGMA user_version=38;
        CREATE TABLE processes (id TEXT PRIMARY KEY);
        INSERT INTO processes VALUES ('one');
        CREATE TABLE conversation_turns (
            id INTEGER PRIMARY KEY, process_id TEXT REFERENCES processes(id), turn_index INTEGER,
            role TEXT, content TEXT, timestamp TEXT, streaming INTEGER,
            interrupted INTEGER, interruption_reason TEXT, tool_calls TEXT, timeline TEXT,
            images TEXT, historical INTEGER, suggestions TEXT, token_usage TEXT,
            paste_externalized INTEGER, model TEXT, mode TEXT, sdk_event_id TEXT,
            display_only INTEGER, compaction_summary TEXT, repo_group_context TEXT,
            chat_mode_context TEXT, provider TEXT, segment_id TEXT, relay_request_id TEXT,
            UNIQUE(process_id, turn_index)
        );
        PRAGMA foreign_keys=ON;
    ",
        )
        .unwrap();
    let mut input = StreamingTurnInput {
        process_id: "one".into(),
        content: "partial".into(),
        timeline: "[]".into(),
        streaming: true,
        timestamp: "2026-01-01T00:00:00.000Z".into(),
    };
    upsert_streaming_turn(&database, &input).unwrap();
    input.content = "complete".into();
    input.streaming = false;
    upsert_streaming_turn(&database, &input).unwrap();
    let turns = get_conversation_turns(&database, "one").unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0]["content"], Value::Text("complete".into()));
    assert_eq!(turns[0]["streaming"], Value::Integer(0));
    assert_eq!(turns[0]["timestamp"], Value::Text(input.timestamp.clone()));
    input.content = "next".into();
    upsert_streaming_turn(&database, &input).unwrap();
    assert_eq!(get_conversation_turns(&database, "one").unwrap().len(), 2);

    let err = database.transaction(|| {
        input.streaming = true;
        upsert_streaming_turn(&database, &input)?;
        Err::<(), _>(Error::Closed)
    });
    assert!(matches!(err, Err(Error::Closed)));
    assert_eq!(get_conversation_turns(&database, "one").unwrap().len(), 2);

    database.pragma("user_version = 39").unwrap();
    assert!(upsert_streaming_turn(&database, &input).is_ok());
    database.pragma("user_version = 40").unwrap();
    assert!(matches!(upsert_streaming_turn(&database, &input), Err(Error::UnsupportedVersion(40))));
    database.pragma("user_version = 38").unwrap();
    input.process_id = "missing".into();
    assert!(upsert_streaming_turn(&database, &input).is_err());
    assert!(get_conversation_turns(&database, "missing").unwrap().is_empty());
}
