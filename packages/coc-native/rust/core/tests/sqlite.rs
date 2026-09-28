use std::fs;

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
