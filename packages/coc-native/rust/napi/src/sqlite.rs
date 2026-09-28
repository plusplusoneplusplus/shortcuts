//! N-API bindings for the synchronous SQLite handle.
//!
//! These classes are deliberately low-level. `src/sqlite.ts` owns the public
//! synchronous SQL API, including variadic arguments and iterators; this
//! module only converts JavaScript values and delegates to the core.

use std::collections::HashMap;

use coc_native_core::sqlite::process_reads::{self, ProcessFilter, ProcessWithTurns};
use coc_native_core::sqlite::process_search::{self, SearchFilter, SearchPage};
use coc_native_core::sqlite::{
    Database, Error as SqliteError, Parameters, Row, RunResult, Statement, Value,
};
use napi::bindgen_prelude::{AsyncTask, Buffer, Either4, Function, Null, Task, Unknown};
use napi::{Env, Error, Result, Status};
use napi_derive::napi;

type JsSqliteValue = Either4<f64, String, Buffer, Null>;
type JsSqliteRow = HashMap<String, JsSqliteValue>;

#[napi(object)]
pub struct NativeDatabaseOptions {
    pub readonly: Option<bool>,
}

#[napi(object)]
pub struct NativeRunResult {
    pub changes: f64,
    pub last_insert_rowid: f64,
}

#[napi(object)]
pub struct NativeConversationSearchFilter {
    pub workspace_id: Option<String>,
    pub statuses: Option<Vec<String>>,
    pub process_type: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

#[napi(object)]
pub struct NativeConversationSearchHit {
    pub process_id: String,
    pub turn_index: f64,
    pub role: String,
    pub snippet: String,
    pub rank: f64,
    pub process_title: Option<String>,
    pub prompt_preview: Option<String>,
    pub process_status: String,
    pub process_type: String,
    pub workspace_id: String,
    pub start_time: String,
}

#[napi(object)]
pub struct NativeConversationSearchPage {
    pub results: Vec<NativeConversationSearchHit>,
    pub total: f64,
}

#[napi(object)]
pub struct NativeProcessReadFilter {
    pub workspace_id: Option<String>,
    pub parent_process_id: Option<String>,
    pub statuses: Option<Vec<String>>,
    pub process_type: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
    pub exclude_conversation: Option<bool>,
}

#[napi(object)]
pub struct NativeProcessWithTurns {
    pub process: HashMap<String, Either4<f64, String, Buffer, Null>>,
    pub turns: Option<Vec<HashMap<String, Either4<f64, String, Buffer, Null>>>>,
}

pub struct ProcessTurnsTask {
    database: Database,
    process_id: String,
}

impl Task for ProcessTurnsTask {
    type Output = Vec<Row>;
    type JsValue = Vec<JsSqliteRow>;

    fn compute(&mut self) -> Result<Self::Output> {
        process_reads::get_conversation_turns(&self.database, &self.process_id)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, rows: Self::Output) -> Result<Self::JsValue> {
        Ok(to_js_rows(rows))
    }
}

pub struct AllProcessesTask {
    database: Database,
    filter: ProcessFilter,
}

impl Task for AllProcessesTask {
    type Output = Vec<ProcessWithTurns>;
    type JsValue = Vec<NativeProcessWithTurns>;

    fn compute(&mut self) -> Result<Self::Output> {
        process_reads::get_all_processes(&self.database, &self.filter).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, rows: Self::Output) -> Result<Self::JsValue> {
        Ok(rows
            .into_iter()
            .map(|entry| NativeProcessWithTurns {
                process: to_js_row(entry.process),
                turns: entry.turns.map(to_js_rows),
            })
            .collect())
    }
}

pub struct ConversationSearchTask {
    database: Database,
    query: String,
    filter: SearchFilter,
}

impl Task for ConversationSearchTask {
    type Output = SearchPage;
    type JsValue = NativeConversationSearchPage;

    fn compute(&mut self) -> Result<Self::Output> {
        process_search::search_conversations(&self.database, &self.query, &self.filter)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, page: Self::Output) -> Result<Self::JsValue> {
        Ok(NativeConversationSearchPage {
            total: page.total as f64,
            results: page
                .results
                .into_iter()
                .map(|hit| NativeConversationSearchHit {
                    process_id: hit.process_id,
                    turn_index: hit.turn_index as f64,
                    role: hit.role,
                    snippet: hit.snippet,
                    rank: hit.rank,
                    process_title: hit.process_title,
                    prompt_preview: hit.prompt_preview,
                    process_status: hit.process_status,
                    process_type: hit.process_type,
                    workspace_id: hit.workspace_id,
                    start_time: hit.start_time,
                })
                .collect(),
        })
    }
}

fn to_napi_error(error: SqliteError) -> Error {
    let message = match error.extended_code() {
        Some(code) => format!("[sqlite:{code}] {error}"),
        None => error.to_string(),
    };
    Error::new(Status::GenericFailure, message)
}

fn to_core_value(value: JsSqliteValue) -> Value {
    match value {
        Either4::A(value) if value.fract() == 0.0 => Value::Integer(value as i64),
        Either4::A(value) => Value::Real(value),
        Either4::B(value) => Value::Text(value),
        Either4::C(value) => Value::Blob(value.to_vec()),
        Either4::D(_) => Value::Null,
    }
}

fn to_js_value(value: Value) -> JsSqliteValue {
    match value {
        Value::Null => Either4::D(Null),
        Value::Integer(value) => Either4::A(value as f64),
        Value::Real(value) => Either4::A(value),
        Value::Text(value) => Either4::B(value),
        Value::Blob(value) => Either4::C(Buffer::from(value)),
    }
}

fn parameters(
    values: Option<Vec<JsSqliteValue>>,
    names: Option<Vec<String>>,
) -> Result<Parameters> {
    let values = values.unwrap_or_default().into_iter().map(to_core_value).collect::<Vec<_>>();
    match names {
        Some(names) if names.len() != values.len() => Err(Error::new(
            Status::InvalidArg,
            "SQLite named parameter names and values must have the same length",
        )),
        Some(names) => Ok(Parameters::Named(names.into_iter().zip(values).collect())),
        None if values.is_empty() => Ok(Parameters::None),
        None => Ok(Parameters::Positional(values)),
    }
}

fn to_js_row(row: Row) -> JsSqliteRow {
    row.into_iter().map(|(name, value)| (name, to_js_value(value))).collect()
}

fn to_js_rows(rows: Vec<Row>) -> Vec<JsSqliteRow> {
    rows.into_iter().map(to_js_row).collect()
}

#[napi]
pub struct NativeStatementHandle {
    statement: Statement,
}

#[napi]
impl NativeStatementHandle {
    #[napi(
        ts_args_type = "values?: Array<number | string | Buffer | null>, names?: string[]",
        ts_return_type = "NativeRunResult"
    )]
    pub fn run(
        &self,
        values: Option<Vec<JsSqliteValue>>,
        names: Option<Vec<String>>,
    ) -> Result<NativeRunResult> {
        let RunResult { changes, last_insert_rowid } =
            self.statement.run(&parameters(values, names)?).map_err(to_napi_error)?;
        Ok(NativeRunResult { changes: changes as f64, last_insert_rowid: last_insert_rowid as f64 })
    }

    #[napi(
        ts_args_type = "values?: Array<number | string | Buffer | null>, names?: string[]",
        ts_return_type = "Record<string, number | string | Buffer | null> | null"
    )]
    pub fn get(
        &self,
        values: Option<Vec<JsSqliteValue>>,
        names: Option<Vec<String>>,
    ) -> Result<Option<JsSqliteRow>> {
        self.statement
            .get(&parameters(values, names)?)
            .map(|row| row.map(to_js_row))
            .map_err(to_napi_error)
    }

    #[napi(
        ts_args_type = "values?: Array<number | string | Buffer | null>, names?: string[]",
        ts_return_type = "Array<Record<string, number | string | Buffer | null>>"
    )]
    pub fn all(
        &self,
        values: Option<Vec<JsSqliteValue>>,
        names: Option<Vec<String>>,
    ) -> Result<Vec<JsSqliteRow>> {
        self.statement.all(&parameters(values, names)?).map(to_js_rows).map_err(to_napi_error)
    }

    #[napi(
        ts_args_type = "values?: Array<number | string | Buffer | null>, names?: string[]",
        ts_return_type = "Array<Record<string, number | string | Buffer | null>>"
    )]
    pub fn iterate(
        &self,
        values: Option<Vec<JsSqliteValue>>,
        names: Option<Vec<String>>,
    ) -> Result<Vec<JsSqliteRow>> {
        self.statement.iterate(&parameters(values, names)?).map(to_js_rows).map_err(to_napi_error)
    }
}

#[napi]
pub struct NativeDatabaseHandle {
    database: Database,
}

#[napi]
impl NativeDatabaseHandle {
    #[napi(constructor)]
    pub fn new(path: String, options: Option<NativeDatabaseOptions>) -> Result<Self> {
        let readonly = options.and_then(|options| options.readonly).unwrap_or(false);
        Database::open(path, readonly).map(|database| Self { database }).map_err(to_napi_error)
    }

    #[napi]
    pub fn exec(&self, sql: String) -> Result<()> {
        self.database.exec(&sql).map_err(to_napi_error)
    }

    #[napi(ts_return_type = "Array<Record<string, number | string | Buffer | null>>")]
    pub fn pragma(&self, sql: String) -> Result<Vec<JsSqliteRow>> {
        self.database.pragma(&sql).map(to_js_rows).map_err(to_napi_error)
    }

    #[napi]
    pub fn prepare(&self, sql: String) -> NativeStatementHandle {
        NativeStatementHandle { statement: self.database.prepare(sql) }
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        self.database.close().map_err(to_napi_error)
    }

    #[napi]
    pub fn transaction<'env>(
        &self,
        callback: Function<'env, (), Unknown<'env>>,
    ) -> Result<Unknown<'env>> {
        self.database.transaction_with(|| callback.call(())).map_err(to_napi_error)?
    }

    #[napi(ts_return_type = "Promise<NativeConversationSearchPage>")]
    pub fn search_conversations(
        &self,
        query: String,
        filter: Option<NativeConversationSearchFilter>,
    ) -> AsyncTask<ConversationSearchTask> {
        let filter = filter
            .map(|filter| SearchFilter {
                workspace_id: filter.workspace_id,
                statuses: filter.statuses.unwrap_or_default(),
                process_type: filter.process_type,
                since: filter.since,
                until: filter.until,
                limit: filter.limit.unwrap_or(50) as i64,
                offset: filter.offset.unwrap_or(0) as i64,
            })
            .unwrap_or_else(|| SearchFilter { limit: 50, ..SearchFilter::default() });
        AsyncTask::new(ConversationSearchTask { database: self.database.clone(), query, filter })
    }

    #[napi(ts_return_type = "Promise<Array<Record<string, number | string | Buffer | null>>>")]
    pub fn get_conversation_turns(&self, process_id: String) -> AsyncTask<ProcessTurnsTask> {
        AsyncTask::new(ProcessTurnsTask { database: self.database.clone(), process_id })
    }

    #[napi(ts_return_type = "Promise<Array<NativeProcessWithTurns>>")]
    pub fn get_all_processes(
        &self,
        filter: Option<NativeProcessReadFilter>,
    ) -> AsyncTask<AllProcessesTask> {
        let filter = filter
            .map(|filter| ProcessFilter {
                workspace_id: filter.workspace_id,
                parent_process_id: filter.parent_process_id,
                statuses: filter.statuses,
                process_type: filter.process_type,
                since: filter.since,
                until: filter.until,
                limit: filter.limit.map(i64::from),
                offset: filter.offset.map(i64::from),
                exclude_conversation: filter.exclude_conversation.unwrap_or(false),
            })
            .unwrap_or_default();
        AsyncTask::new(AllProcessesTask { database: self.database.clone(), filter })
    }
}
