use std::fs;

use coc_native_core::sqlite::process_reads::{
    get_all_processes, get_conversation_turns, get_process_summaries, list_recent_processes,
    ProcessFilter, RecentFilter,
};
use coc_native_core::sqlite::process_search::{
    sanitize_fts_query, search_conversations, SearchFilter,
};
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
        .prepare("SELECT 1 AS value UNION ALL SELECT 2")
        .get(&Parameters::None)
        .unwrap()
        .unwrap();
    assert_eq!(row["value"], Value::Integer(1));
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
    assert!(matches!(
        search_conversations(&database, "search", &filter),
        Err(Error::UnsupportedVersion(39))
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
        INSERT INTO processes VALUES
          ('one', 'ws-a', NULL, 'completed', 'chat', '2026-01-01', '2026-01-02',
            NULL, 'first', NULL, NULL, NULL, NULL, NULL, 0,
            '{\"__pendingAskUser\":[{\"id\":1}],\"compaction\":{\"count\":2}}'),
          ('two', 'ws-b', 'one', 'running', 'chat', '2026-02-01', '2026-02-02',
            NULL, 'second', NULL, NULL, NULL, NULL, NULL, 0, NULL);
        INSERT INTO conversation_turns VALUES (1, 'one', 2, 'second'), (2, 'one', 0, 'first');
    ",
        )
        .unwrap();
    assert!(get_conversation_turns(&database, "missing").unwrap().is_empty());
    let turns = get_conversation_turns(&database, "one").unwrap();
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0]["content"], Value::Text("first".into()));

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
    assert!(matches!(get_conversation_turns(&database, "one"), Err(Error::UnsupportedVersion(39))));
    assert!(matches!(get_all_processes(&database, &filter), Err(Error::UnsupportedVersion(39))));
    assert!(matches!(
        get_process_summaries(&database, &filter),
        Err(Error::UnsupportedVersion(39))
    ));
    assert!(matches!(
        list_recent_processes(&database, &RecentFilter { limit: 10, ..RecentFilter::default() }),
        Err(Error::UnsupportedVersion(39))
    ));
}
