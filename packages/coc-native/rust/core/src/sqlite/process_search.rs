//! Typed, pooled conversation FTS search for the process database.

use rusqlite::params_from_iter;

use super::{check_process_schema, Database, Result};

#[derive(Clone, Debug, Default)]
pub struct SearchFilter {
    pub workspace_id: Option<String>,
    pub statuses: Vec<String>,
    pub process_type: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, PartialEq)]
pub struct SearchHit {
    pub process_id: String,
    pub turn_index: i64,
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

#[derive(Debug, PartialEq)]
pub struct SearchPage {
    pub results: Vec<SearchHit>,
    pub total: i64,
}

pub fn sanitize_fts_query(raw: &str) -> String {
    fn js_whitespace(ch: char) -> bool {
        matches!(ch,
            '\u{0009}'..='\u{000D}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' |
            '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' |
            '\u{205F}' | '\u{3000}' | '\u{FEFF}'
        )
    }

    raw.chars()
        .map(|ch| {
            if matches!(ch, '*' | '^' | ':' | '{' | '}' | '(' | ')' | '"') {
                '\0'
            } else if ch == '-' {
                ' '
            } else {
                ch
            }
        })
        .filter(|ch| *ch != '\0')
        .collect::<String>()
        .split(js_whitespace)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn search_conversations(
    database: &Database,
    query: &str,
    filter: &SearchFilter,
) -> Result<SearchPage> {
    database.with_read_connection(|connection| {
        check_process_schema(connection)?;
        let sanitized = sanitize_fts_query(query);
        if sanitized.is_empty() {
            return Ok(SearchPage { results: vec![], total: 0 });
        }
        let mut predicates = vec![
            "conversation_search MATCH ?".to_string(),
            "p.archived = 0".to_string(),
            "ct.interrupted = 0".to_string(),
        ];
        let mut values = vec![rusqlite::types::Value::Text(sanitized)];
        if let Some(workspace) = &filter.workspace_id {
            predicates.push("p.workspace_id = ?".into());
            values.push(workspace.clone().into());
        }
        if !filter.statuses.is_empty() {
            predicates
                .push(format!("p.status IN ({})", vec!["?"; filter.statuses.len()].join(", ")));
            values.extend(filter.statuses.iter().cloned().map(Into::into));
        }
        if let Some(process_type) = &filter.process_type {
            predicates.push("p.type = ?".into());
            values.push(process_type.clone().into());
        }
        if let Some(since) = &filter.since {
            predicates.push("p.last_event_at >= ?".into());
            values.push(since.clone().into());
        }
        if let Some(until) = &filter.until {
            predicates.push("p.last_event_at < ?".into());
            values.push(until.clone().into());
        }
        let from = format!(
            "FROM conversation_search cs \
             JOIN conversation_turns ct ON ct.id = cs.rowid \
             JOIN processes p ON ct.process_id = p.id WHERE {}",
            predicates.join(" AND ")
        );
        let total: i64 = connection.query_row(
            &format!("SELECT COUNT(*) {from}"),
            params_from_iter(&values),
            |row| row.get(0),
        )?;
        if total == 0 {
            return Ok(SearchPage { results: vec![], total });
        }
        values.push(filter.limit.into());
        values.push(filter.offset.into());
        let sql = format!(
            "SELECT ct.process_id, ct.turn_index, ct.role, \
             snippet(conversation_search, 0, '<mark>', '</mark>', '…', 48), cs.rank, \
             p.title, p.prompt_preview, p.status, p.type, p.workspace_id, p.start_time \
             {from} ORDER BY cs.rank LIMIT ? OFFSET ?"
        );
        let mut statement = connection.prepare(&sql)?;
        let results = statement
            .query_map(params_from_iter(&values), |row| {
                Ok(SearchHit {
                    process_id: row.get(0)?,
                    turn_index: row.get(1)?,
                    role: row.get(2)?,
                    snippet: row.get(3)?,
                    rank: row.get(4)?,
                    process_title: row.get(5)?,
                    prompt_preview: row.get(6)?,
                    process_status: row.get(7)?,
                    process_type: row.get(8)?,
                    workspace_id: row.get(9)?,
                    start_time: row.get(10)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(SearchPage { results, total })
    })
}
