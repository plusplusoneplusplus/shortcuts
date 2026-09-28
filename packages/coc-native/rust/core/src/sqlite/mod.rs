//! Shared SQLite connection and statement primitives.
//!
//! The Node-facing wrapper keeps this module's synchronous shape: a database
//! owns one re-entrant writer connection, prepared statements retain the
//! database rather than borrowing a connection, and a transaction holds the
//! writer lock while its callback invokes statements recursively. Typed async
//! store operations can use the bounded read pool without sharing a rusqlite
//! connection across threads.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use parking_lot::ReentrantMutex;
use rusqlite::{Connection, OpenFlags, Row as SqliteRow, Statement as SqliteStatement, ToSql};

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_READ_POOL_SIZE: usize = 4;

/// A SQLite value at the language-neutral core boundary.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl ToSql for Value {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        match self {
            Self::Null => Ok(rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Null)),
            Self::Integer(value) => value.to_sql(),
            Self::Real(value) => value.to_sql(),
            Self::Text(value) => value.to_sql(),
            Self::Blob(value) => value.to_sql(),
        }
    }
}

impl From<rusqlite::types::Value> for Value {
    fn from(value: rusqlite::types::Value) -> Self {
        match value {
            rusqlite::types::Value::Null => Self::Null,
            rusqlite::types::Value::Integer(value) => Self::Integer(value),
            rusqlite::types::Value::Real(value) => Self::Real(value),
            rusqlite::types::Value::Text(value) => Self::Text(value),
            rusqlite::types::Value::Blob(value) => Self::Blob(value),
        }
    }
}

/// The two parameter styles accepted by SQLite callers.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Parameters {
    #[default]
    None,
    Positional(Vec<Value>),
    Named(Vec<(String, Value)>),
}

/// A result row keyed by the exact SQLite column name.
pub type Row = BTreeMap<String, Value>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RunResult {
    pub changes: u64,
    pub last_insert_rowid: i64,
}

#[derive(Debug)]
pub enum Error {
    Sqlite(rusqlite::Error),
    Closed,
}

impl Error {
    /// The extended SQLite result code, when SQLite produced the failure.
    pub fn extended_code(&self) -> Option<i32> {
        match self {
            Self::Sqlite(rusqlite::Error::SqliteFailure(error, _)) => Some(error.extended_code),
            _ => None,
        }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(error) => error.fmt(formatter),
            Self::Closed => formatter.write_str("database connection is closed"),
        }
    }
}

impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

struct ReadPoolState {
    available: Vec<Connection>,
    open: usize,
    closed: bool,
}

struct ReadPool {
    path: PathBuf,
    flags: OpenFlags,
    max_size: usize,
    state: Mutex<ReadPoolState>,
    available: Condvar,
}

impl ReadPool {
    fn new(path: PathBuf, readonly: bool) -> Self {
        let flags = if readonly {
            OpenFlags::SQLITE_OPEN_READ_ONLY
        } else {
            OpenFlags::SQLITE_OPEN_READ_WRITE
        } | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        Self {
            path,
            flags,
            max_size: DEFAULT_READ_POOL_SIZE,
            state: Mutex::new(ReadPoolState { available: Vec::new(), open: 0, closed: false }),
            available: Condvar::new(),
        }
    }

    fn with_connection<T>(&self, operation: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let mut state = self.state.lock().expect("SQLite read pool mutex poisoned");
        let connection = loop {
            if state.closed {
                return Err(Error::Closed);
            }
            if let Some(connection) = state.available.pop() {
                break connection;
            }
            if state.open < self.max_size {
                state.open += 1;
                match open_connection(&self.path, self.flags) {
                    Ok(connection) => break connection,
                    Err(error) => {
                        state.open -= 1;
                        self.available.notify_one();
                        return Err(error);
                    }
                }
            }
            state =
                self.available.wait(state).expect("SQLite read pool mutex poisoned while waiting");
        };

        drop(state);
        let result = operation(&connection);
        let mut state = self.state.lock().expect("SQLite read pool mutex poisoned");
        if state.closed {
            state.open -= 1;
        } else {
            state.available.push(connection);
        }
        self.available.notify_one();
        result
    }

    fn close(&self) {
        let mut state = self.state.lock().expect("SQLite read pool mutex poisoned");
        state.closed = true;
        let idle_connections = state.available.len();
        state.available.clear();
        state.open = state.open.saturating_sub(idle_connections);
        self.available.notify_all();
        while state.open != 0 {
            state =
                self.available.wait(state).expect("SQLite read pool mutex poisoned while closing");
        }
    }
}

struct DatabaseInner {
    writer: ReentrantMutex<RefCell<Option<Connection>>>,
    readers: Option<ReadPool>,
}

/// One open SQLite file: a serialized writer plus a bounded pool for typed reads.
#[derive(Clone)]
pub struct Database {
    inner: Arc<DatabaseInner>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>, readonly: bool) -> Result<Self> {
        let path = path.as_ref();
        let flags = if readonly {
            OpenFlags::SQLITE_OPEN_READ_ONLY
        } else {
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
        } | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let writer = open_connection(path, flags)?;
        // Independent connections do not share SQLite's special in-memory database.
        let readers =
            (path != Path::new(":memory:")).then(|| ReadPool::new(path.to_path_buf(), readonly));
        Ok(Self {
            inner: Arc::new(DatabaseInner {
                writer: ReentrantMutex::new(RefCell::new(Some(writer))),
                readers,
            }),
        })
    }

    pub fn exec(&self, sql: &str) -> Result<()> {
        self.with_writer(|connection| {
            connection.execute_batch(sql)?;
            Ok(())
        })
    }

    pub fn pragma(&self, sql: &str) -> Result<Vec<Row>> {
        self.with_writer(|connection| {
            query(connection, &format!("PRAGMA {sql}"), &Parameters::None)
        })
    }

    pub fn prepare(&self, sql: impl Into<String>) -> Statement {
        Statement { database: self.clone(), sql: sql.into() }
    }

    /// Run a fully synchronous callback inside a transaction.
    ///
    /// The re-entrant lock is intentional: statements invoked by the callback
    /// acquire the same writer on the same thread. Other threads remain blocked
    /// until commit or rollback.
    pub fn transaction<T>(&self, callback: impl FnOnce() -> Result<T>) -> Result<T> {
        self.transaction_with(callback)?
    }

    /// Run a callback whose own error type must cross a language boundary.
    ///
    /// SQLite failures remain the outer result; a callback failure is returned
    /// unchanged in the inner result after the transaction has rolled back.
    pub fn transaction_with<T, E>(
        &self,
        callback: impl FnOnce() -> std::result::Result<T, E>,
    ) -> Result<std::result::Result<T, E>> {
        let _guard = self.inner.writer.lock();
        self.with_writer(|connection| {
            connection.execute_batch("BEGIN")?;
            Ok(())
        })?;
        match callback() {
            Ok(value) => {
                self.with_writer(|connection| {
                    connection.execute_batch("COMMIT")?;
                    Ok(())
                })?;
                Ok(Ok(value))
            }
            Err(error) => {
                let _ = self.with_writer(|connection| {
                    connection.execute_batch("ROLLBACK")?;
                    Ok(())
                });
                Ok(Err(error))
            }
        }
    }

    /// Use a pooled read connection, falling back to the writer for `:memory:`.
    pub fn with_read_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        if let Some(readers) = &self.inner.readers {
            readers.with_connection(operation)
        } else {
            self.with_writer(operation)
        }
    }

    pub fn close(&self) -> Result<()> {
        let guard = self.inner.writer.lock();
        let mut slot = guard.borrow_mut();
        if slot.take().is_none() {
            return Err(Error::Closed);
        }
        if let Some(readers) = &self.inner.readers {
            readers.close();
        }
        Ok(())
    }

    fn with_writer<T>(&self, operation: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let guard = self.inner.writer.lock();
        let slot = guard.borrow();
        let connection = slot.as_ref().ok_or(Error::Closed)?;
        operation(connection)
    }
}

/// A reusable SQL string bound to its owning database.
#[derive(Clone)]
pub struct Statement {
    database: Database,
    sql: String,
}

impl Statement {
    pub fn run(&self, parameters: &Parameters) -> Result<RunResult> {
        self.database.with_writer(|connection| {
            let mut statement = connection.prepare(&self.sql)?;
            bind(&mut statement, parameters)?;
            let changes = statement.raw_execute()? as u64;
            Ok(RunResult { changes, last_insert_rowid: connection.last_insert_rowid() })
        })
    }

    pub fn get(&self, parameters: &Parameters) -> Result<Option<Row>> {
        self.database.with_writer(|connection| {
            Ok(query(connection, &self.sql, parameters)?.into_iter().next())
        })
    }

    pub fn all(&self, parameters: &Parameters) -> Result<Vec<Row>> {
        self.database.with_writer(|connection| query(connection, &self.sql, parameters))
    }

    /// Materialize rows with stable indices for the N-API iterator wrapper.
    pub fn iterate(&self, parameters: &Parameters) -> Result<Vec<Row>> {
        self.all(parameters)
    }
}

fn open_connection(path: &Path, flags: OpenFlags) -> Result<Connection> {
    let connection = Connection::open_with_flags(path, flags)?;
    connection.busy_timeout(BUSY_TIMEOUT)?;
    Ok(connection)
}

fn bind(statement: &mut SqliteStatement<'_>, parameters: &Parameters) -> Result<()> {
    match parameters {
        Parameters::None => {}
        Parameters::Positional(values) => {
            for (offset, value) in values.iter().enumerate() {
                statement.raw_bind_parameter(offset + 1, value)?;
            }
        }
        Parameters::Named(values) => {
            for (name, value) in values {
                let index = named_parameter_index(statement, name)?
                    .ok_or_else(|| rusqlite::Error::InvalidParameterName(name.clone()))?;
                statement.raw_bind_parameter(index, value)?;
            }
        }
    }
    Ok(())
}

fn named_parameter_index(
    statement: &SqliteStatement<'_>,
    name: &str,
) -> rusqlite::Result<Option<usize>> {
    if matches!(name.as_bytes().first(), Some(b'@' | b':' | b'$')) {
        return statement.parameter_index(name);
    }
    for prefix in ['@', ':', '$'] {
        if let Some(index) = statement.parameter_index(&format!("{prefix}{name}"))? {
            return Ok(Some(index));
        }
    }
    Ok(None)
}

fn query(connection: &Connection, sql: &str, parameters: &Parameters) -> Result<Vec<Row>> {
    let mut statement = connection.prepare(sql)?;
    let column_names: Vec<String> =
        statement.column_names().iter().map(ToString::to_string).collect();
    bind(&mut statement, parameters)?;
    let mut cursor = statement.raw_query();
    let mut result = Vec::new();
    while let Some(row) = cursor.next()? {
        result.push(read_row(row, &column_names)?);
    }
    Ok(result)
}

fn read_row(row: &SqliteRow<'_>, column_names: &[String]) -> Result<Row> {
    let mut result = Row::new();
    for (index, name) in column_names.iter().enumerate() {
        let value: rusqlite::types::Value = row.get(index)?;
        result.insert(name.clone(), value.into());
    }
    Ok(result)
}
