use std::collections::HashSet;
use std::env;
use std::path::PathBuf;
use std::process;

use coc_native_core::symbol_index::{benchmark_repository, ExtractionLimits};
use serde_json::json;

struct Options {
    root: PathBuf,
    threads: usize,
    excluded_paths: HashSet<String>,
    included_extensions: HashSet<String>,
}

fn parse_args() -> Result<Options, String> {
    let mut root = None;
    let mut threads = None;
    let mut excluded_paths = HashSet::new();
    let mut included_extensions = HashSet::new();
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        let value = args.next().ok_or_else(|| format!("{argument} needs a value"))?;
        match argument.as_str() {
            "--root" => root = Some(PathBuf::from(value)),
            "--threads" => {
                let parsed =
                    value.parse::<usize>().map_err(|_| format!("invalid thread count: {value}"))?;
                if parsed == 0 {
                    return Err("thread count must be positive".to_owned());
                }
                threads = Some(parsed);
            }
            "--exclude" => {
                excluded_paths.insert(value.replace('\\', "/"));
            }
            "--extension" => {
                included_extensions.insert(value.to_ascii_lowercase());
            }
            _ => return Err(format!("unknown option: {argument}")),
        }
    }
    Ok(Options {
        root: root.ok_or_else(|| "--root is required".to_owned())?,
        threads: threads.ok_or_else(|| "--threads is required".to_owned())?,
        excluded_paths,
        included_extensions,
    })
}

fn run() -> Result<(), String> {
    let options = parse_args()?;
    let stats = benchmark_repository(
        &options.root,
        ExtractionLimits::default(),
        options.threads,
        &options.excluded_paths,
        (!options.included_extensions.is_empty()).then_some(&options.included_extensions),
    )
    .map_err(|error| error.to_string())?;
    println!(
        "{}",
        json!({
            "threads": options.threads,
            "files": stats.files_scanned,
            "bytes": stats.bytes_read,
            "symbols": stats.symbols_extracted,
            "failures": stats.failures,
            "failurePaths": stats.failure_paths,
            "walkMs": stats.walk_time.as_secs_f64() * 1_000.0,
            "extractionMs": stats.extraction_time.as_secs_f64() * 1_000.0,
        })
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("symbol-index benchmark: {error}");
        process::exit(2);
    }
}
