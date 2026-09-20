//! `coc-symbols-lsp` — the C-family symbol index as a stdio language server.
//!
//! The index behind this binary is the same `coc-native-core` code the N-API
//! addon wraps; what changes is how CoC reaches it. Running it as a language
//! server puts it on the one transport `LanguageServerManager` already
//! supervises, next to clangd, instead of a bespoke HTTP route with its own
//! lifecycle and status plumbing.

mod framing;
mod fuzzy;
mod indexer;
mod locations;
mod positions;
mod server;
mod transport;
mod uri;
mod watcher;

use std::io::{self, BufReader};
use std::path::PathBuf;
use std::process::ExitCode;

use server::ServerOptions;

const USAGE: &str = "\
coc-symbols-lsp — C-family symbol index over stdio LSP

Usage: coc-symbols-lsp [--stdio] [--database <path>]

  --stdio            Accepted for symmetry with other servers; stdio is the
                     only transport.
  --database <path>  SQLite index file. Defaults to
                     <root>/.coc-symbols/symbol-index.sqlite.
";

fn main() -> ExitCode {
    let options = match parse_arguments(std::env::args().skip(1)) {
        Ok(Some(options)) => options,
        Ok(None) => {
            print!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(error) => {
            eprintln!("coc-symbols-lsp: {error}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let reader = BufReader::new(io::stdin());
    match server::run(reader, Box::new(io::stdout()), options) {
        Ok(code) => ExitCode::from(code as u8),
        Err(error) => {
            eprintln!("coc-symbols-lsp: {error}");
            ExitCode::FAILURE
        }
    }
}

/// `Ok(None)` means help was asked for.
fn parse_arguments(
    arguments: impl Iterator<Item = String>,
) -> Result<Option<ServerOptions>, String> {
    let mut options = ServerOptions::default();
    let mut arguments = arguments.peekable();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--stdio" => {}
            "--help" | "-h" => return Ok(None),
            "--database" => {
                let value = arguments.next().ok_or("--database needs a path")?;
                options.database = Some(PathBuf::from(value));
            }
            other => {
                if let Some(value) = other.strip_prefix("--database=") {
                    options.database = Some(PathBuf::from(value));
                } else {
                    return Err(format!("unknown argument: {other}"));
                }
            }
        }
    }
    Ok(Some(options))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> Result<Option<ServerOptions>, String> {
        parse_arguments(arguments.iter().map(|argument| argument.to_string()))
    }

    #[test]
    fn reads_the_database_path_in_both_spellings() {
        let split = parse(&["--stdio", "--database", "/data/index.sqlite"]).unwrap().unwrap();
        assert_eq!(split.database, Some(PathBuf::from("/data/index.sqlite")));
        let joined = parse(&["--database=/data/index.sqlite"]).unwrap().unwrap();
        assert_eq!(joined.database, Some(PathBuf::from("/data/index.sqlite")));
    }

    #[test]
    fn defaults_to_no_database_override() {
        assert_eq!(parse(&["--stdio"]).unwrap().unwrap().database, None);
    }

    #[test]
    fn rejects_an_unknown_argument_and_a_bare_database_flag() {
        assert!(parse(&["--tcp"]).is_err());
        assert!(parse(&["--database"]).is_err());
    }

    #[test]
    fn help_asks_for_no_server() {
        assert!(parse(&["--help"]).unwrap().is_none());
    }
}
