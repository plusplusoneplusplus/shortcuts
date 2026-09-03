//! The per-file `Sink` that turns the searcher's callbacks into `ContentMatch`es.

use std::collections::VecDeque;
use std::io;

use grep_matcher::Matcher;
use grep_regex::RegexMatcher;
use grep_searcher::{Searcher, Sink, SinkContext, SinkContextKind, SinkMatch};

use super::options::MAX_LINE_UTF16;
use super::ContentMatch;

/// Collects one file's matches, with context, up to a per-file cap.
pub(super) struct MatchSink<'a> {
    matcher: &'a RegexMatcher,
    path: &'a str,
    context_lines: usize,
    max_per_file: usize,
    /// True when the searcher was built with `multi_line(true)`, i.e. the query
    /// itself can match across a line break. A callback then carries a whole
    /// region rather than exactly one line, and each match in it has to be cut
    /// back into per-line pieces.
    multi_line: bool,
    matches: Vec<ContentMatch>,
    /// The most recent context lines, waiting for the match they precede.
    pending_before: VecDeque<String>,
    /// Next id handed to a match that spans more than one line. Per file, which
    /// is all the client needs: a group is only ever compared within a path.
    next_group: u32,
    capped: bool,
}

impl<'a> MatchSink<'a> {
    pub(super) fn new(
        matcher: &'a RegexMatcher,
        path: &'a str,
        context_lines: usize,
        max_per_file: usize,
        multi_line: bool,
    ) -> Self {
        Self {
            matcher,
            path,
            context_lines,
            max_per_file,
            multi_line,
            matches: Vec::new(),
            pending_before: VecDeque::new(),
            next_group: 0,
            capped: false,
        }
    }

    /// True when this file had more matches than `max_per_file` allowed.
    pub(super) fn hit_per_file_cap(&self) -> bool {
        self.capped
    }

    pub(super) fn into_matches(self) -> Vec<ContentMatch> {
        self.matches
    }

    /// Turn one multi-line callback into per-line matches.
    ///
    /// The region can hold several matches and each of those can straddle a
    /// line break, so every match is cut at the line boundaries it crosses and
    /// each piece becomes its own `ContentMatch` — the shape single-line search
    /// already produces, so `start_column`/`end_column` stay offsets into one
    /// line of text. Pieces of the same match share a `group` id, which is how
    /// a client can tell "one match over three lines" from "three matches".
    fn matched_multi_line(&mut self, mat: &SinkMatch<'_>) -> Result<bool, io::Error> {
        let bytes = mat.bytes();
        let base_line = mat.line_number().unwrap_or(0);
        let mut spans = Vec::new();
        self.matcher
            .find_iter(bytes, |span| {
                spans.push(span);
                true
            })
            .map_err(io::Error::other)?;

        for span in spans {
            let pieces = split_span_by_line(bytes, span.start(), span.end());
            // A match confined to one line is indistinguishable from a
            // single-line hit, so it carries no group and the client needs no
            // special case for it.
            let group = if pieces.len() > 1 {
                let id = self.next_group;
                self.next_group += 1;
                Some(id)
            } else {
                None
            };
            for piece in pieces {
                if self.matches.len() >= self.max_per_file {
                    self.capped = true;
                    return Ok(false);
                }
                self.push_match(
                    base_line + piece.line_offset,
                    &bytes[piece.line_start..piece.line_end],
                    piece.seg_start,
                    piece.seg_end,
                    group,
                );
            }
        }
        Ok(true)
    }

    /// Record one line's worth of match: `line_bytes` is the line without its
    /// terminator, `start`/`end` are byte offsets of the match inside it.
    fn push_match(
        &mut self,
        line: u64,
        line_bytes: &[u8],
        start: usize,
        end: usize,
        group: Option<u32>,
    ) {
        // Decoded in three pieces so the columns are exact offsets into the
        // text returned, even when the line holds bytes that are not UTF-8 and
        // lossy decoding changes its length.
        let head = String::from_utf8_lossy(&line_bytes[..start]);
        let body = String::from_utf8_lossy(&line_bytes[start..end]);
        let tail = String::from_utf8_lossy(&line_bytes[end..]);
        let start_column = utf16_len(&head);
        let end_column = start_column + utf16_len(&body);
        let text = format!("{head}{body}{tail}");

        self.matches.push(ContentMatch {
            path: self.path.to_owned(),
            line,
            // Never cut into the match itself: the columns have to stay valid
            // indices into whatever text ends up on the wire.
            text: truncate_utf16(&text, MAX_LINE_UTF16.max(end_column)),
            start_column: start_column as u32,
            end_column: end_column as u32,
            group,
            before: self.pending_before.drain(..).collect(),
            after: Vec::new(),
        });
    }
}

impl Sink for MatchSink<'_> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, io::Error> {
        // Checked on entry rather than after pushing so that the capped match's
        // predecessor has already received its trailing context lines.
        if self.matches.len() >= self.max_per_file {
            self.capped = true;
            return Ok(false);
        }
        if self.multi_line {
            return self.matched_multi_line(mat);
        }
        let bytes = strip_line_terminator(mat.bytes());
        // `multi_line(false)` means one match per emitted line, so the first
        // span the matcher finds in these bytes is the span that matched.
        let Some(span) = self.matcher.find(bytes).map_err(io::Error::other)? else {
            return Ok(true);
        };
        self.push_match(mat.line_number().unwrap_or(0), bytes, span.start(), span.end(), None);
        Ok(true)
    }

    fn context(&mut self, _searcher: &Searcher, ctx: &SinkContext<'_>) -> Result<bool, io::Error> {
        if self.context_lines == 0 {
            return Ok(true);
        }
        let text = truncate_utf16(
            &String::from_utf8_lossy(strip_line_terminator(ctx.bytes())),
            MAX_LINE_UTF16,
        );
        match ctx.kind() {
            SinkContextKind::Before => {
                if self.pending_before.len() == self.context_lines {
                    self.pending_before.pop_front();
                }
                self.pending_before.push_back(text);
            }
            SinkContextKind::After => {
                if let Some(last) = self.matches.last_mut() {
                    if last.after.len() < self.context_lines {
                        last.after.push(text);
                    }
                }
            }
            SinkContextKind::Other => {}
        }
        Ok(true)
    }

    fn context_break(&mut self, _searcher: &Searcher) -> Result<bool, io::Error> {
        self.pending_before.clear();
        Ok(true)
    }
}

/// One line's share of a match that may cross line breaks.
struct SpanPiece {
    /// Lines past the start of the region the callback carried.
    line_offset: u64,
    /// Byte range of the line itself, terminator excluded.
    line_start: usize,
    line_end: usize,
    /// Byte range of the match within that line.
    seg_start: usize,
    seg_end: usize,
}

/// Cut the match `start..end` into the lines of `bytes` it covers.
///
/// A match that ends exactly on a line terminator contributes nothing to the
/// line after it, so `"a\n"` over `"a\nb\n"` is one piece, not two. A match
/// that *starts* on a terminator keeps its zero-width piece on that line —
/// dropping it would make a bare newline query find nothing.
fn split_span_by_line(bytes: &[u8], start: usize, end: usize) -> Vec<SpanPiece> {
    let mut pieces = Vec::new();
    let mut line_offset = 0u64;
    let mut cursor = 0usize;
    loop {
        let terminator = bytes[cursor..].iter().position(|&b| b == b'\n').map(|i| cursor + i);
        let line_end_inclusive = terminator.map_or(bytes.len(), |i| i + 1);
        let mut content_end = terminator.unwrap_or(bytes.len());
        if content_end > cursor && bytes[content_end - 1] == b'\r' {
            content_end -= 1;
        }
        if start < line_end_inclusive && (end > cursor || (end == start && start >= cursor)) {
            let seg_start = start.max(cursor).min(content_end) - cursor;
            let seg_end = end.min(content_end).max(cursor + seg_start) - cursor;
            pieces.push(SpanPiece {
                line_offset,
                line_start: cursor,
                line_end: content_end,
                seg_start,
                seg_end,
            });
        }
        let Some(_) = terminator else { break };
        cursor = line_end_inclusive;
        line_offset += 1;
        if cursor >= end || cursor >= bytes.len() {
            break;
        }
    }
    pieces
}

/// Drop the `\n` or `\r\n` the searcher includes with each line.
fn strip_line_terminator(bytes: &[u8]) -> &[u8] {
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    bytes.strip_suffix(b"\r").unwrap_or(bytes)
}

/// Length of `text` in UTF-16 code units — what `String.prototype.length` reports.
fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// Cut `text` to at most `max` UTF-16 code units, never mid-character.
fn truncate_utf16(text: &str, max: usize) -> String {
    let mut units = 0;
    for (offset, ch) in text.char_indices() {
        units += ch.len_utf16();
        if units > max {
            return text[..offset].to_owned();
        }
    }
    text.to_owned()
}
