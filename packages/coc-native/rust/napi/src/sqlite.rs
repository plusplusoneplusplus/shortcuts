//! N-API bindings for the synchronous SQLite handle.
//!
//! These classes are deliberately low-level. `src/sqlite.ts` owns the public
//! better-sqlite3-shaped API, including variadic arguments and iterators; this
//! module only converts JavaScript values and delegates to the core.

use std::collections::HashMap;

use coc_native_core::sqlite::{
    Database, Error as SqliteError, Parameters, Row, RunResult, Statement, Value,
};
use napi::bindgen_prelude::{Buffer, Either4, Function, Null, Unknown};
use napi::{Error, Result, Status};
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
}
