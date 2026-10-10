mod microsoft;
mod output;

use std::io;
use tokio_util::sync::CancellationToken;

fn cli() -> clap::Command {
    clap::Command::new("auth-cli")
        .version(env!("CARGO_PKG_VERSION"))
        .about("Source-pinned authentication using auth-sdk")
        .subcommand_required(true)
        .arg_required_else_help(true)
        .arg(
            clap::Arg::new("show-secrets")
                .long("show-secrets")
                .global(true)
                .action(clap::ArgAction::SetTrue)
                .help("DANGER: print complete secrets, including sign-in instructions"),
        )
        .after_help("Quick start: auth-cli microsoft login, then auth-cli microsoft token --resource https://graph.microsoft.com. Secrets show only the first/last 8 characters by default. Secrets of 16 characters or fewer are fully masked. Use --show-secrets for full token output or usable direct OAuth sign-in instructions. Output is JSON Lines; no secret files are exported.")
        .subcommand(microsoft::command())
}

#[tokio::main]
async fn main() {
    let matches = cli().get_matches();
    let show = matches.get_flag("show-secrets");
    if show {
        eprintln!(
            "WARNING: full secrets will be printed to stdout. Do not log or share this output."
        );
    }
    let cancel = CancellationToken::new();
    let mut stdout = io::stdout();
    let work = microsoft::run(
        matches.subcommand_matches("microsoft").expect("required vendor"),
        show,
        &cancel,
        &mut stdout,
        std::sync::Arc::new(auth_sdk::microsoft::Dependencies::default()),
    );
    let result = tokio::select! {
        biased;
        signal = tokio::signal::ctrl_c() => {
            cancel.cancel();
            if signal.is_err() {
                Err(io::Error::other("Unable to monitor cancellation.").into())
            } else {
                Err(auth_sdk::AuthError::new(auth_sdk::ErrorCode::Cancelled).into())
            }
        }
        result = work => result,
    };
    if let Err(error) = result {
        eprintln!("{error}");
        if error
            .downcast_ref::<auth_sdk::AuthError>()
            .is_some_and(|error| error.code == auth_sdk::ErrorCode::LoginRequired)
        {
            eprintln!("Run `auth-cli microsoft login`. If browser login needs terminal interaction, run `az login` directly.");
        }
        std::process::exit(1);
    }
}
