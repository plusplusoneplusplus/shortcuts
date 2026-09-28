//! Pooled process and conversation reads; TypeScript owns JSON/date conversion.

use rusqlite::Connection;

use super::{check_process_schema, query, Database, Error, Parameters, Result, Row, Value};

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

fn load_turns(connection: &Connection, process_id: &str) -> Result<Vec<Row>> {
    query(
        connection,
        "SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index",
        &Parameters::Positional(vec![Value::Text(process_id.to_owned())]),
    )
}

pub fn get_conversation_turns(database: &Database, process_id: &str) -> Result<Vec<Row>> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
        load_turns(connection, process_id)
    })
}

pub fn get_all_processes(
    database: &Database,
    filter: &ProcessFilter,
) -> Result<Vec<ProcessWithTurns>> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
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
            if statuses.len() == 1 {
                conditions.push("status = ?".to_owned());
            } else {
                conditions.push(format!("status IN ({})", vec!["?"; statuses.len()].join(", ")));
            }
            values.extend(statuses.iter().cloned().map(Value::Text));
        }
        if let Some(process_type) = &filter.process_type {
            conditions.push("type = ?".to_owned());
            values.push(Value::Text(process_type.clone()));
        }
        if let Some(since) = &filter.since {
            conditions.push("start_time >= ?".to_owned());
            values.push(Value::Text(since.clone()));
        }
        if let Some(until) = &filter.until {
            conditions.push("start_time < ?".to_owned());
            values.push(Value::Text(until.clone()));
        }
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
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
        let mut sql = format!("SELECT {select} FROM processes {where_clause} ORDER BY last_event_at DESC");
        if let Some(limit) = filter.limit {
            sql.push_str(" LIMIT ?");
            values.push(Value::Integer(limit));
        }
        if let Some(offset) = filter.offset {
            sql.push_str(" OFFSET ?");
            values.push(Value::Integer(offset));
        }
        let rows = query(connection, &sql, &Parameters::Positional(values))?;
        rows.into_iter().map(|process| {
            let turns = if filter.exclude_conversation {
                None
            } else {
                let id = match process.get("id") {
                    Some(Value::Text(id)) => id,
                    _ => return Err(Error::Sqlite(rusqlite::Error::InvalidColumnName("id".into()))),
                };
                Some(load_turns(connection, id)?)
            };
            Ok(ProcessWithTurns { process, turns })
        }).collect()
    })
}
