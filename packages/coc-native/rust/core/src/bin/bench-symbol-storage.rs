use std::env;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::Path;
use std::process;
use std::time::Instant;

use coc_native_core::symbol_index::{ExtractionLimits, SymbolStore};
use serde_json::json;
use tempfile::Builder;

const FILES_PER_DIRECTORY: usize = 1_000;

struct Options {
    files: usize,
    runs: usize,
    target_lines: usize,
}

fn parse_positive(value: String, option: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("{option} must be a positive integer"))
}

fn parse_args() -> Result<Options, String> {
    let mut files = None;
    let mut runs = None;
    let mut target_lines = None;
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        let value = args.next().ok_or_else(|| format!("{argument} needs a value"))?;
        match argument.as_str() {
            "--files" => files = Some(parse_positive(value, "--files")?),
            "--runs" => runs = Some(parse_positive(value, "--runs")?),
            "--target-lines" => {
                target_lines = Some(parse_positive(value, "--target-lines")?);
            }
            _ => return Err(format!("unknown option: {argument}")),
        }
    }
    Ok(Options {
        files: files.ok_or_else(|| "--files is required".to_owned())?,
        runs: runs.ok_or_else(|| "--runs is required".to_owned())?,
        target_lines: target_lines.ok_or_else(|| "--target-lines is required".to_owned())?,
    })
}

fn create_fixture(
    root: &Path,
    files: usize,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    for index in 0..files {
        let directory = root.join(format!("shard-{:04}", index / FILES_PER_DIRECTORY));
        if index % FILES_PER_DIRECTORY == 0 {
            fs::create_dir_all(&directory)?;
        }
        writeln!(
            File::create(directory.join(format!("file-{index:06}.hpp")))?,
            "int benchmark_fixture_{index}();"
        )?;
    }
    Ok(())
}

fn write_target(
    path: &Path,
    lines: usize,
    run: usize,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut output = BufWriter::new(File::create(path)?);
    for _ in 1..lines {
        output.write_all(b"// benchmark padding\n")?;
    }
    writeln!(output, "int benchmark_symbol_{run}();")?;
    output.flush()?;
    Ok(())
}

fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let options = parse_args()?;
    let fixture_started = Instant::now();
    let workspace = Builder::new().prefix("coc-symbol-storage-bench-").tempdir()?;
    let root = workspace.path().join("repo");
    fs::create_dir(&root)?;
    create_fixture(&root, options.files)?;
    let fixture_ms = fixture_started.elapsed().as_secs_f64() * 1_000.0;

    let store = SymbolStore::open(&workspace.path().join("symbol-index.sqlite"))?;
    let initial_started = Instant::now();
    let initial = store.sync_repository(&root, ExtractionLimits::default())?;
    let initial_ms = initial_started.elapsed().as_secs_f64() * 1_000.0;
    if initial.parsed != options.files || !initial.failures.is_empty() {
        return Err(format!(
            "fixture indexing expected {} parsed files and no failures, got {} parsed and {} failures",
            options.files,
            initial.parsed,
            initial.failures.len()
        )
        .into());
    }

    let mut manifest_samples_ms = Vec::with_capacity(options.runs);
    for _ in 0..options.runs {
        let started = Instant::now();
        let stats = store.sync_repository(&root, ExtractionLimits::default())?;
        manifest_samples_ms.push(started.elapsed().as_secs_f64() * 1_000.0);
        if stats.unchanged != options.files || stats.parsed != 0 || !stats.failures.is_empty() {
            return Err("warm manifest sync changed the generated fixture".into());
        }
    }

    let target_relative = "shard-0000/file-000000.hpp";
    let target = root.join(target_relative);
    let mut targeted_samples_ms = Vec::with_capacity(options.runs);
    for run in 0..options.runs {
        write_target(&target, options.target_lines, run)?;
        let started = Instant::now();
        let stats = store.sync_changed_paths(
            &root,
            &[target_relative.to_owned()],
            ExtractionLimits::default(),
        )?;
        targeted_samples_ms.push(started.elapsed().as_secs_f64() * 1_000.0);
        if stats.parsed != 1 || !stats.failures.is_empty() {
            return Err("targeted update did not parse exactly one file".into());
        }
    }

    println!(
        "{}",
        json!({
            "files": options.files,
            "targetLines": options.target_lines,
            "fixtureMs": fixture_ms,
            "initialIndexMs": initial_ms,
            "manifestSamplesMs": manifest_samples_ms,
            "targetedSamplesMs": targeted_samples_ms,
        })
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("symbol-storage benchmark: {error}");
        process::exit(2);
    }
}
