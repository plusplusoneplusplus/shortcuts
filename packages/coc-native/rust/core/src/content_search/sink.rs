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
    matches: Vec<ContentMatch>,
    /// The most recent context lines, waiting for the match they precede.
    pending_before: VecDeque<String>,
    capped: bool,
}

impl<'a> MatchSink<'a> {
    pub(super) fn new(
        matcher: &'a RegexMatcher,
        path: &'a str,
        context_lines: usize,
        max_per_file: usize,
    ) -> Self {
        Self {
            matcher,
            path,
            context_lines,
            max_per_file,
            matches: Vec::new(),
            pending_before: VecDeque::new(),
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
        let bytes = strip_line_terminator(mat.bytes());
        // `multi_line(false)` means one match per emitted line, so the first
        // span the matcher finds in these bytes is the span that matched.
        let Some(span) = self.matcher.find(bytes).map_err(io::Error::other)? else {
            return Ok(true);
        };

        // Decoded in three pieces so the columns are exact offsets into the
        // text returned, even when the line holds bytes that are not UTF-8 and
        // lossy decoding changes its length.
        let head = String::from_utf8_lossy(&bytes[..span.start()]);
        let body = String::from_utf8_lossy(&bytes[span.start()..span.end()]);
        let tail = String::from_utf8_lossy(&bytes[span.end()..]);
        let start_column = utf16_len(&head);
        let end_column = start_column + utf16_len(&body);
        let text = format!("{head}{body}{tail}");

        self.matches.push(ContentMatch {
            path: self.path.to_owned(),
            line: mat.line_number().unwrap_or(0),
            // Never cut into the match itself: the columns have to stay valid
            // indices into whatever text ends up on the wire.
            text: truncate_utf16(&text, MAX_LINE_UTF16.max(end_column)),
            start_column: start_column as u32,
            end_column: end_column as u32,
            before: self.pending_before.drain(..).collect(),
            after: Vec::new(),
        });
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
