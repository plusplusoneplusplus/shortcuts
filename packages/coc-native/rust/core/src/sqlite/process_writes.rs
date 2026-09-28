//! Atomic streaming-turn writes on the shared serialized writer.

use super::{check_process_schema, Database, Result};
use rusqlite::params;

pub struct StreamingTurnInput {
    pub process_id: String,
    pub content: String,
    pub timeline: String,
    pub streaming: bool,
    pub timestamp: String,
}

pub fn upsert_streaming_turn(database: &Database, input: &StreamingTurnInput) -> Result<()> {
    database.transaction(|| {
        database.with_writer(|connection| {
            check_process_schema(connection)?;
            let streaming = i64::from(input.streaming);
            let changes = connection.prepare_cached(
                "UPDATE conversation_turns
                 SET content = ?1, timeline = ?2, streaming = ?3
                 WHERE process_id = ?4 AND streaming = 1",
            )?.execute(params![input.content, input.timeline, streaming, input.process_id])?;
            if changes == 0 {
                let next_idx: i64 = connection.query_row(
                    "SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_idx
                     FROM conversation_turns WHERE process_id = ?1",
                    params![input.process_id],
                    |row| row.get(0),
                )?;
                connection.execute(
                    "INSERT INTO conversation_turns (
                        process_id, turn_index, role, content, timestamp, streaming,
                        interrupted, interruption_reason, tool_calls, timeline, images,
                        historical, suggestions, token_usage, paste_externalized, model, mode,
                        sdk_event_id, display_only, compaction_summary, repo_group_context,
                        chat_mode_context, provider, segment_id, relay_request_id
                    ) VALUES (
                        ?1, ?2, 'assistant', ?3, ?4, ?5,
                        0, NULL, NULL, ?6, NULL,
                        0, NULL, NULL, 0, NULL, NULL,
                        NULL, 0, NULL, NULL,
                        NULL, NULL, NULL, NULL
                    )",
                    params![
                        input.process_id,
                        next_idx,
                        input.content,
                        input.timestamp,
                        streaming,
                        input.timeline
                    ],
                )?;
            }
            Ok(())
        })
    })
}
