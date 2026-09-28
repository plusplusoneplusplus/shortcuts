//! Pooled process and conversation reads; TypeScript owns JSON/date conversion.

use std::collections::HashMap;

use rusqlite::{params_from_iter, Connection, Row as SqliteRow};

use super::{check_process_schema, query, Database, Error, Parameters, Result, Row, Value};

const TURN_QUERY: &str =
    "SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index";

#[derive(Clone, Debug, Default)]
pub struct ProcessFilter {
    pub workspace_id: Option<String>,
    pub parent_process_id: Option<String>,
    /// `Some([])` must retain SQL's empty-IN behavior.
    pub statuses: Option<Vec<String>>,
    pub process_type: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub exclude_conversation: bool,
}

pub struct ProcessWithTurns {
    pub process: Row,
    pub turns: Option<Vec<Row>>,
}

pub struct SummaryPage {
    pub rows: Vec<Row>,
    pub total: i64,
}

#[derive(Clone, Debug, Default)]
pub struct RecentFilter {
    pub workspace_id: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub exclude_process_id: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

fn where_clause(filter: &ProcessFilter, activity_time: bool) -> (String, Vec<Value>) {
    let mut conditions = Vec::new();
    let mut values = Vec::new();
    if let Some(workspace_id) = &filter.workspace_id {
        conditions.push("workspace_id = ?".to_owned());
        values.push(Value::Text(workspace_id.clone()));
    }
    if let Some(parent_process_id) = &filter.parent_process_id {
        conditions.push("parent_process_id = ?".to_owned());
        values.push(Value::Text(parent_process_id.clone()));
    }
    if let Some(statuses) = &filter.statuses {
        // `status = ?` and `IN (?)` return identical results, including NULL.
        conditions.push(format!("status IN ({})", vec!["?"; statuses.len()].join(", ")));
        values.extend(statuses.iter().cloned().map(Value::Text));
    }
    if let Some(process_type) = &filter.process_type {
        conditions.push("type = ?".to_owned());
        values.push(Value::Text(process_type.clone()));
    }
    let time_column = if activity_time { "last_event_at" } else { "start_time" };
    if let Some(since) = &filter.since {
        conditions.push(format!("{time_column} >= ?"));
        values.push(Value::Text(since.clone()));
    }
    if let Some(until) = &filter.until {
        conditions.push(format!("{time_column} < ?"));
        values.push(Value::Text(until.clone()));
    }
    let sql = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    (sql, values)
}

fn load_turns(connection: &Connection, process_id: &str) -> Result<Vec<Row>> {
    query(connection, TURN_QUERY, &Parameters::Positional(vec![Value::Text(process_id.to_owned())]))
}

pub fn get_conversation_turns(database: &Database, process_id: &str) -> Result<Vec<Row>> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
        load_turns(connection, process_id)
    })
}

pub fn get_conversation_turns_json(database: &Database, process_id: &str) -> Result<String> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
        let rows =
            query_json_rows(connection, TURN_QUERY, &[Value::Text(process_id.to_owned())], |_| {
                Ok(())
            })?;
        let mut output = String::from("[");
        for (index, (_, row)) in rows.iter().enumerate() {
            if index != 0 {
                output.push(',');
            }
            output.push_str(row);
        }
        output.push(']');
        Ok(output)
    })
}

fn process_query(filter: &ProcessFilter) -> (String, Vec<Value>) {
    let (where_clause, mut values) = where_clause(filter, false);
    let select = if filter.exclude_conversation {
        "id, workspace_id, type, prompt_preview, NULL AS full_prompt, status, \
             start_time, end_time, error, NULL AS result, result_file_path, \
             raw_stdout_file_path, metadata, group_metadata, NULL AS structured_result, \
             parent_process_id, sdk_session_id, active_provider_session, backend, working_directory, \
             title, custom_title, last_message_preview, token_limit, current_tokens, \
             cumulative_token_usage, stale, data_file_path, archived, pinned_at, seen_at, last_event_at"
    } else {
        "*"
    };
    let mut sql =
        format!("SELECT {select} FROM processes {where_clause} ORDER BY last_event_at DESC");
    if let Some(limit) = filter.limit {
        sql.push_str(" LIMIT ?");
        values.push(Value::Integer(limit));
    }
    if let Some(offset) = filter.offset {
        sql.push_str(" OFFSET ?");
        values.push(Value::Integer(offset));
    }
    (sql, values)
}

fn process_id(row: &Row, column: &str) -> Result<String> {
    match row.get(column) {
        Some(Value::Text(id)) => Ok(id.clone()),
        _ => Err(Error::Sqlite(rusqlite::Error::InvalidColumnName(column.into()))),
    }
}

fn turn_batch_query(ids: &[Value]) -> String {
    let placeholders = vec!["?"; ids.len()].join(", ");
    format!(
        "SELECT * FROM conversation_turns WHERE process_id IN ({placeholders}) \
         ORDER BY process_id, turn_index"
    )
}

pub fn get_all_processes(
    database: &Database,
    filter: &ProcessFilter,
) -> Result<Vec<ProcessWithTurns>> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
        let (sql, values) = process_query(filter);
        let rows = query(connection, &sql, &Parameters::Positional(values))?;
        if filter.exclude_conversation {
            return Ok(rows
                .into_iter()
                .map(|process| ProcessWithTurns { process, turns: None })
                .collect());
        }

        let mut turns_by_process: HashMap<String, Vec<Row>> = HashMap::new();
        for chunk in rows.chunks(500) {
            let ids = chunk
                .iter()
                .map(|row| process_id(row, "id").map(Value::Text))
                .collect::<Result<Vec<_>>>()?;
            for turn in query(connection, &turn_batch_query(&ids), &Parameters::Positional(ids))? {
                let id = process_id(&turn, "process_id")?;
                turns_by_process.entry(id).or_default().push(turn);
            }
        }
        rows.into_iter()
            .map(|process| {
                let id = process_id(&process, "id")?;
                let turns = Some(turns_by_process.remove(&id).unwrap_or_default());
                Ok(ProcessWithTurns { process, turns })
            })
            .collect()
    })
}

fn write_json_value(output: &mut String, value: &Value) {
    match value {
        Value::Null => output.push_str("null"),
        Value::Integer(value) => output.push_str(&value.to_string()),
        Value::Real(value) if value.is_finite() => {
            output.push_str(&serde_json::to_string(value).expect("finite real serializes"));
        }
        Value::Real(value) => {
            let number = if value.is_nan() {
                "NaN"
            } else if value.is_sign_positive() {
                "Infinity"
            } else {
                "-Infinity"
            };
            output.push_str(&format!(r#"{{"$sqliteNumber":"{number}"}}"#));
        }
        Value::Text(value) => {
            output.push_str(&serde_json::to_string(value).expect("SQLite text serializes"));
        }
        Value::Blob(bytes) => {
            output.push_str(r#"{"$sqliteBlob":"#);
            output.push_str(&serde_json::to_string(bytes).expect("SQLite blob serializes"));
            output.push('}');
        }
    }
}

fn json_row_id(row: &SqliteRow<'_>, column: &str) -> Result<String> {
    match row.get::<_, rusqlite::types::Value>(column)? {
        rusqlite::types::Value::Text(id) => Ok(id),
        _ => Err(Error::Sqlite(rusqlite::Error::InvalidColumnName(column.into()))),
    }
}

fn query_json_rows<Key>(
    connection: &Connection,
    sql: &str,
    parameters: &[Value],
    key: impl Fn(&SqliteRow<'_>) -> Result<Key>,
) -> Result<Vec<(Key, String)>> {
    let mut statement = connection.prepare(sql)?;
    let mut columns: Vec<(usize, String)> = statement
        .column_names()
        .iter()
        .enumerate()
        .map(|(index, name)| (index, (*name).to_owned()))
        .collect();
    columns.sort_unstable_by(|left, right| left.1.cmp(&right.1));
    for (_, name) in &mut columns {
        *name = format!("{}:", serde_json::to_string(name).expect("SQLite column names serialize"));
    }
    let mut cursor = statement.query(params_from_iter(parameters))?;
    let mut rows = Vec::new();
    while let Some(row) = cursor.next()? {
        let id = key(row)?;
        let mut json = String::new();
        json.push('{');
        for (index, (column_index, name)) in columns.iter().enumerate() {
            if index != 0 {
                json.push(',');
            }
            json.push_str(name);
            let value: rusqlite::types::Value = row.get(*column_index)?;
            write_json_value(&mut json, &value.into());
        }
        json.push('}');
        rows.push((id, json));
    }
    Ok(rows)
}

pub fn get_all_processes_json(database: &Database, filter: &ProcessFilter) -> Result<String> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
        let (sql, values) = process_query(filter);
        let processes = query_json_rows(connection, &sql, &values, |row| json_row_id(row, "id"))?;
        let mut turns_by_process: HashMap<String, Vec<String>> = HashMap::new();
        if !filter.exclude_conversation {
            for chunk in processes.chunks(500) {
                let ids = chunk.iter().map(|(id, _)| Value::Text(id.clone())).collect::<Vec<_>>();
                for (id, turn) in
                    query_json_rows(connection, &turn_batch_query(&ids), &ids, |row| {
                        json_row_id(row, "process_id")
                    })?
                {
                    turns_by_process.entry(id).or_default().push(turn);
                }
            }
        }
        let mut output = String::new();
        output.push('[');
        for (index, (id, process)) in processes.iter().enumerate() {
            if index != 0 {
                output.push(',');
            }
            output.push_str(r#"{"process":"#);
            output.push_str(process);
            if !filter.exclude_conversation {
                output.push_str(r#","turns":["#);
                for (turn_index, turn) in
                    turns_by_process.remove(id).unwrap_or_default().iter().enumerate()
                {
                    if turn_index != 0 {
                        output.push(',');
                    }
                    output.push_str(turn);
                }
                output.push(']');
            }
            output.push('}');
        }
        output.push(']');
        Ok(output)
    })
}

fn with_summary_page<T>(
    database: &Database,
    filter: &ProcessFilter,
    read: impl FnOnce(&Connection, &str, &[Value]) -> Result<T>,
) -> Result<(i64, T)> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
        let snapshot = connection.unchecked_transaction()?;
        let (where_clause, mut values) = where_clause(filter, true);
        let total = snapshot.query_row(
            &format!("SELECT COUNT(*) FROM processes {where_clause}"),
            params_from_iter(&values),
            |row| row.get(0),
        )?;
        let mut sql = format!(
            "SELECT id, workspace_id, status, type, start_time, end_time, prompt_preview, error, \
             parent_process_id, title, custom_title, last_message_preview, last_event_at, pinned_at, archived, \
             COALESCE(json_array_length(json_extract(metadata, '$.__pendingAskUser')), 0) AS pending_ask_user_count, \
             json_extract(metadata, '$.compaction') AS compaction_json \
             FROM processes {where_clause} ORDER BY last_event_at DESC"
        );
        if let Some(limit) = filter.limit {
            sql.push_str(" LIMIT ?");
            values.push(Value::Integer(limit));
        }
        if let Some(offset) = filter.offset {
            sql.push_str(" OFFSET ?");
            values.push(Value::Integer(offset));
        }
        let rows = read(&snapshot, &sql, &values)?;
        snapshot.commit()?;
        Ok((total, rows))
    })
}

pub fn get_process_summaries(database: &Database, filter: &ProcessFilter) -> Result<SummaryPage> {
    let (total, rows) = with_summary_page(database, filter, |connection, sql, values| {
        query(connection, sql, &Parameters::Positional(values.to_vec()))
    })?;
    Ok(SummaryPage { rows, total })
}

pub fn get_process_summaries_json(database: &Database, filter: &ProcessFilter) -> Result<String> {
    let (total, rows) = with_summary_page(database, filter, |connection, sql, values| {
        query_json_rows(connection, sql, values, |_| Ok(()))
    })?;
    let mut output = format!(r#"{{"total":{total},"rows":["#);
    for (index, (_, row)) in rows.iter().enumerate() {
        if index != 0 {
            output.push(',');
        }
        output.push_str(row);
    }
    output.push_str("]}");
    Ok(output)
}

fn recent_query(filter: &RecentFilter) -> (String, Vec<Value>) {
    let mut conditions = vec!["archived = 0".to_owned()];
    let mut values = Vec::new();
    if let Some(workspace_id) = &filter.workspace_id {
        conditions.push("workspace_id = ?".into());
        values.push(Value::Text(workspace_id.clone()));
    }
    if let Some(process_id) = &filter.exclude_process_id {
        conditions.push("id != ?".into());
        values.push(Value::Text(process_id.clone()));
    }
    if let Some(since) = &filter.since {
        conditions.push("last_event_at >= ?".into());
        values.push(Value::Text(since.clone()));
    }
    if let Some(until) = &filter.until {
        conditions.push("last_event_at < ?".into());
        values.push(Value::Text(until.clone()));
    }
    let sql = format!(
        "SELECT id, workspace_id, status, type, start_time, end_time, \
         prompt_preview, error, parent_process_id, title, custom_title, last_message_preview, \
         last_event_at, pinned_at, archived, \
         json_extract(metadata, '$.compaction') AS compaction_json \
         FROM processes WHERE {} ORDER BY last_event_at DESC LIMIT ? OFFSET ?",
        conditions.join(" AND ")
    );
    values.push(Value::Integer(filter.limit));
    values.push(Value::Integer(filter.offset));
    (sql, values)
}

pub fn list_recent_processes(database: &Database, filter: &RecentFilter) -> Result<Vec<Row>> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
        let (sql, values) = recent_query(filter);
        query(connection, &sql, &Parameters::Positional(values))
    })
}

pub fn list_recent_processes_json(database: &Database, filter: &RecentFilter) -> Result<String> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
        let (sql, values) = recent_query(filter);
        let rows = query_json_rows(connection, &sql, &values, |_| Ok(()))?;
        let mut output = String::from("[");
        for (index, (_, row)) in rows.iter().enumerate() {
            if index != 0 {
                output.push(',');
            }
            output.push_str(row);
        }
        output.push(']');
        Ok(output)
    })
}
