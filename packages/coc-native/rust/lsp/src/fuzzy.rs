//! The camel-case-aware scorer behind `workspace/symbol`.
//!
//! A palette query is not a prefix. `fwc` means `findWorkspaceConfig`, and a
//! reader typing it expects that entry above anything that merely happens to
//! contain the three letters in order. The scorer therefore accepts a
//! subsequence but pays for *where* each character landed: a word start (a
//! camel hump, or the letter after `_`, `-`, `.`, `:`) is worth far more than
//! a letter in the middle of a word, and a run of adjacent matches is worth
//! more than the same letters scattered.
//!
//! Every match carries the offsets it scored on, so the palette highlights
//! exactly the characters the ranking was based on. The offsets are UTF-16
//! code units because the only consumer is a browser, where a string is
//! indexed that way; a Rust `char` index would silently mis-highlight the
//! first identifier containing anything outside the BMP.

/// One accepted match: its score and the offsets that produced it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub score: i32,
    /// UTF-16 offsets into the candidate, ascending.
    pub indices: Vec<u32>,
}

/// A match starting at offset 0 outranks every interior match.
const PREFIX_BONUS: i32 = 400;
/// The candidate is exactly the query, ignoring case.
const EXACT_BONUS: i32 = 600;
/// Every character landed on a word start — the acronym the user typed.
const ACRONYM_BONUS: i32 = 200;
const WORD_START_BONUS: i32 = 60;
const CONSECUTIVE_BONUS: i32 = 40;
const MATCH_BONUS: i32 = 12;
/// Charged once per skipped character, so a tight match beats a sprawling one.
const GAP_PENALTY: i32 = 2;
/// Charged once on the whole candidate, so a short name wins a tie.
const LENGTH_PENALTY: i32 = 1;

/// Score `candidate` against `query`, or `None` when the query is not a
/// subsequence of it. An empty query matches nothing: the caller decides what
/// "everything" means, and for a palette it is an empty list.
///
/// Two passes, best wins. The first accepts a character only at a word start,
/// which is what makes `fwc` pick `findWorkspaceConfig` over the incidental
/// `fanciful_wordcraft`; the second is the plain left-to-right subsequence,
/// which is what still finds `unformatted` for `fmt`.
pub fn score(query: &str, candidate: &str) -> Option<Match> {
    if query.is_empty() {
        return None;
    }
    let needles: Vec<char> = query.chars().flat_map(char::to_lowercase).collect();
    let haystack: Vec<char> = candidate.chars().collect();
    let acronym = match_pass(&needles, &haystack, true).map(|mut matched| {
        matched.score += ACRONYM_BONUS;
        matched
    });
    let greedy = match_pass(&needles, &haystack, false);
    match (acronym, greedy) {
        (Some(a), Some(g)) => Some(if a.score >= g.score { a } else { g }),
        (matched, None) | (None, matched) => matched,
    }
}

/// One left-to-right subsequence pass. `word_starts_only` restricts every
/// accepted character to a word boundary.
fn match_pass(needles: &[char], haystack: &[char], word_starts_only: bool) -> Option<Match> {
    let mut indices = Vec::with_capacity(needles.len());
    let mut score = 0;
    let mut needle = 0;
    let mut utf16 = 0u32;
    let mut previous_match: Option<usize> = None;
    let mut gaps = 0;

    for (position, character) in haystack.iter().enumerate() {
        let width = character.len_utf16() as u32;
        let eligible = !word_starts_only || is_word_start(haystack, position);
        if eligible && needle < needles.len() && lowercase_eq(*character, needles[needle]) {
            score += MATCH_BONUS;
            if is_word_start(haystack, position) {
                score += WORD_START_BONUS;
            }
            if previous_match == Some(position.wrapping_sub(1)) {
                score += CONSECUTIVE_BONUS;
            } else if previous_match.is_some() {
                gaps += 1;
            }
            previous_match = Some(position);
            indices.push(utf16);
            needle += 1;
        }
        utf16 += width;
    }

    if needle < needles.len() {
        return None;
    }
    if indices.first() == Some(&0) {
        score += PREFIX_BONUS;
    }
    if haystack.len() == needles.len() {
        score += EXACT_BONUS;
    }
    score -= gaps * GAP_PENALTY;
    score -= (haystack.len() as i32) * LENGTH_PENALTY;
    Some(Match { score, indices })
}

/// Case-insensitive single-character comparison. `needle` is already lowered.
fn lowercase_eq(candidate: char, needle: char) -> bool {
    candidate == needle || candidate.to_lowercase().eq(std::iter::once(needle))
}

/// A hump (`aB`), a letter after a separator, a digit after a letter, or the
/// very first character.
fn is_word_start(haystack: &[char], position: usize) -> bool {
    if position == 0 {
        return true;
    }
    let previous = haystack[position - 1];
    let current = haystack[position];
    if matches!(previous, '_' | '-' | '.' | ':' | '/' | ' ') {
        return true;
    }
    if previous.is_lowercase() && current.is_uppercase() {
        return true;
    }
    previous.is_alphabetic() && current.is_numeric()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scored(query: &str, candidate: &str) -> i32 {
        score(query, candidate).expect("expected a match").score
    }

    #[test]
    fn camel_humps_beat_a_scattered_subsequence() {
        assert!(scored("fwc", "findWorkspaceConfig") > scored("fwc", "affableWaterCollection"));
    }

    #[test]
    fn a_prefix_beats_an_interior_match() {
        assert!(scored("parse", "parseHeader") > scored("parse", "reparseHeader"));
    }

    #[test]
    fn an_exact_name_beats_a_longer_prefix_match() {
        assert!(scored("parse", "parse") > scored("parse", "parseHeader"));
    }

    #[test]
    fn a_shorter_candidate_wins_an_otherwise_equal_tie() {
        assert!(scored("read", "readFile") > scored("read", "readFileSynchronously"));
    }

    #[test]
    fn indices_name_the_characters_that_matched() {
        let matched = score("fwc", "findWorkspaceConfig").expect("expected a match");
        let name: Vec<char> = "findWorkspaceConfig".chars().collect();
        let picked: String = matched.indices.iter().map(|i| name[*i as usize]).collect();
        assert_eq!(picked, "fWC");
    }

    #[test]
    fn a_missing_character_is_not_a_match() {
        assert_eq!(score("fwz", "findWorkspaceConfig"), None);
    }

    #[test]
    fn order_matters() {
        assert_eq!(score("cwf", "findWorkspaceConfig"), None);
    }

    #[test]
    fn an_empty_query_matches_nothing() {
        assert_eq!(score("", "anything"), None);
    }

    #[test]
    fn non_ascii_identifiers_do_not_panic_and_index_in_utf16() {
        let matched = score("ф", "префикс").expect("expected a match");
        assert_eq!(matched.indices, vec![3]);
        // An astral character is two UTF-16 units wide, so what follows shifts.
        let matched = score("x", "𝒜x").expect("expected a match");
        assert_eq!(matched.indices, vec![2]);
    }

    #[test]
    fn matching_is_case_insensitive_both_ways() {
        assert!(score("FWC", "findWorkspaceConfig").is_some());
        assert!(score("fwc", "FIND_WORKSPACE_CONFIG").is_some());
    }

    #[test]
    fn separators_start_words_too() {
        assert!(scored("fwc", "find_workspace_config") > scored("fwc", "fanciful_wordcraft"));
    }
}
