//! A disallow-list matcher for shell commands an agent is about to run.
//!
//! Ask mode auto-approves `Bash`, so the only thing between a model and
//! `rm -rf /` is a screen like this one. The matcher is deliberately a
//! *disallow* list: it has no model of what a safe command looks like, only a
//! small hardcoded set of shapes that are almost never what anyone meant. A
//! command matching nothing runs exactly as it does today.
//!
//! One command is split into segments on `;`, `&&`, `||`, `|` and newlines,
//! because `ls && rm -rf /` is two commands and only the second one matters.
//! Each rule then matches either a single segment or the whole command:
//! pipe-to-shell (`curl … | sh`) is dangerous *because* of the pipe, so it is
//! the one shape that has to see the text the splitter took apart.
//!
//! ## Quoting is not parsed, on purpose
//!
//! The splitter does not track quotes. Because every command rule anchors at
//! the start of a segment, `echo "rm -rf /"` does **not** match — `echo` is
//! where the segment starts. But a quoted string holding a *separator* does
//! split, so `echo "hi; rm -rf /"` yields a second segment that matches and
//! prompts. That is the intended trade: this is a prompt, not a block, and a
//! shell-accurate parser is a much larger thing to get right than the failure
//! mode it removes. A false prompt costs a click; a missed `rm -rf /` costs a
//! machine.

use std::sync::OnceLock;

use regex::Regex;

/// Whether a rule looks at one segment of a command or the whole thing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Scope {
    /// Matched against each `;`/`&&`/`||`/`|`/newline-separated segment.
    Segment,
    /// Matched against the raw command, before splitting. Only for shapes
    /// defined by an operator the splitter would otherwise consume.
    Whole,
}

/// One hardcoded rule: a stable id, the text shown to the user, and the shape.
struct Rule {
    id: &'static str,
    description: &'static str,
    scope: Scope,
    pattern: &'static str,
}

/// What a matched rule reports back.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DangerousCommandMatch {
    /// Stable rule identifier — what a session-wide approval remembers.
    pub rule_id: String,
    /// Human-readable reason, shown in the approval prompt.
    pub description: String,
    /// The segment that matched, or the whole command for a whole-command rule.
    pub matched_segment: String,
}

/// The built-in rule set (v1).
///
/// Every rule anchoring on a command name repeats the same prefix —
/// `^\s*(?:NAME=value\s+)*(?:sudo\s+(?:-flag\s+)*)?` — spelled out inline
/// rather than assembled, so each pattern reads as one regex. It is there so
/// that `sudo reboot` and `FOO=1 rm -rf /` are not free bypasses.
///
/// Deliberately excluded, because they are ordinary work in this repository and
/// prompting on them would only train the user to click through: destructive
/// git commands, recursive `chmod`/`chown`, bare `sudo`, `npm publish`,
/// `docker push`.
static RULES: &[Rule] = &[
    Rule {
        id: "rm-recursive-dangerous-target",
        description: "Recursive delete targeting the filesystem root, the home directory, or an absolute path",
        scope: Scope::Segment,
        // `rm`, a recursive flag anywhere among its flags, and a target that is
        // absolute or home-anchored. A relative target (`rm -rf ./build`,
        // `rm -rf node_modules`) is ordinary work and does not match.
        pattern: r#"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+(?:-\S+\s+)*)?rm\s+(?:\S+\s+)*?(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive)(?:\s+\S+)*?\s+['"]?(?:/|~|\$\{?HOME\}?(?:[/\s'"]|$))"#,
    },
    Rule {
        id: "disk-destructive-tool",
        description: "Raw disk or filesystem tool that overwrites a device",
        scope: Scope::Segment,
        pattern: r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+(?:-\S+\s+)*)?(?:dd|mkfs(?:\.[A-Za-z0-9_-]+)?|fdisk|sfdisk|parted|wipefs)(?:\s|$)",
    },
    Rule {
        id: "device-write-redirect",
        description: "Redirection into a raw block device",
        scope: Scope::Segment,
        pattern: r#">\s*['"]?/dev/(?:sd|nvme|hd|vd|mmcblk)[a-z0-9]*"#,
    },
    Rule {
        id: "pipe-to-shell",
        description: "Downloaded script piped straight into a shell",
        scope: Scope::Whole,
        pattern: r"\b(?:curl|wget)\b[^|;\n]*\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:\S*/)?(?:ba|z|k|da)?sh\b",
    },
    Rule {
        id: "host-lifecycle",
        description: "Shuts down or restarts the host",
        scope: Scope::Segment,
        pattern: r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+(?:-\S+\s+)*)?(?:shutdown|reboot|halt|poweroff|systemctl\s+(?:poweroff|reboot|halt))(?:\s|$)",
    },
    Rule {
        id: "kill-every-process",
        description: "Sends SIGKILL to every process the user owns",
        scope: Scope::Segment,
        pattern: r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+(?:-\S+\s+)*)?kill\s+(?:-9\s+-1|-1\s+-9|-KILL\s+-1|-s\s+(?:9|KILL)\s+-1)(?:\s|$)",
    },
];

fn compiled() -> &'static Vec<(&'static Rule, Regex)> {
    static COMPILED: OnceLock<Vec<(&'static Rule, Regex)>> = OnceLock::new();
    COMPILED.get_or_init(|| {
        RULES
            .iter()
            .map(|rule| {
                let regex = Regex::new(rule.pattern).unwrap_or_else(|e| {
                    panic!("built-in rule {} is not a valid regex: {e}", rule.id)
                });
                (rule, regex)
            })
            .collect()
    })
}

/// Split a command into the pieces a shell would run separately.
///
/// Empty pieces are dropped, so a trailing `;` or a blank line costs nothing.
pub fn segments(command: &str) -> Vec<&str> {
    static SPLITTER: OnceLock<Regex> = OnceLock::new();
    let splitter = SPLITTER.get_or_init(|| Regex::new(r"\|\||&&|;|\||\n|\r").expect("splitter"));
    splitter.split(command).map(str::trim).filter(|segment| !segment.is_empty()).collect()
}

/// Match one command against the built-in rule set.
///
/// Returns the first rule that matches, in declaration order, so the reported
/// reason is stable for a command that trips more than one rule.
pub fn match_command(command: &str) -> Option<DangerousCommandMatch> {
    let parts = segments(command);
    for (rule, regex) in compiled() {
        let hit = match rule.scope {
            Scope::Whole => regex.is_match(command).then(|| command.trim()),
            Scope::Segment => parts.iter().copied().find(|segment| regex.is_match(segment)),
        };
        if let Some(segment) = hit {
            return Some(DangerousCommandMatch {
                rule_id: rule.id.to_string(),
                description: rule.description.to_string(),
                matched_segment: segment.to_string(),
            });
        }
    }
    None
}

/// Every built-in rule id, in declaration order. Exists so a caller can pin the
/// set in a test rather than restating the ids.
pub fn rule_ids() -> Vec<&'static str> {
    RULES.iter().map(|rule| rule.id).collect()
}
