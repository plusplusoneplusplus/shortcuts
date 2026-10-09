use std::process::{Command, Output};

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_teams-cli"))
        .args(args)
        .env_remove("TEAMS_TENANT_ID")
        .env_remove("TEAMS_USER_ID")
        .env_remove("TEAMS_GRAPH_TOKEN")
        .env_remove("TEAMS_GRAPH_TOKEN_EXPIRES_AT")
        .env_remove("TEAMS_IC3_TOKEN")
        .env_remove("TEAMS_IC3_TOKEN_EXPIRES_AT")
        .env("PATH", "")
        .output()
        .expect("run the built teams-cli binary")
}

#[test]
fn help_and_version_work_without_azure_cli_or_credentials() {
    for flag in ["--help", "-h"] {
        let output = run(&[flag]);
        assert!(output.status.success());
        let help = String::from_utf8(output.stdout).unwrap();
        assert!(help.contains("Usage: teams-cli "));
        assert!(help.contains("default: ic3"));
        assert!(help.contains("default: amer"));
        assert!(!help.contains("read_chats"));
        assert!(output.stderr.is_empty());
    }
    for flag in ["--version", "-V"] {
        let output = run(&[flag]);
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().trim(),
            format!("teams-cli {}", env!("CARGO_PKG_VERSION"))
        );
        assert!(output.stderr.is_empty());
    }
}

#[test]
fn invalid_commands_and_options_fail_before_authentication() {
    for args in [
        vec![],
        vec!["unknown"],
        vec!["view"],
        vec!["list", "--backend", "unknown"],
        vec!["list", "--backend", "ic3", "--region", "unknown"],
        vec!["list", "--tenant-id"],
        vec!["watch", "--backend=graph"],
        vec!["watch", "--seconds=0"],
        vec!["watch", "--seconds=3601"],
        vec!["watch", "--seconds=invalid"],
    ] {
        let output = run(&args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(!error.is_empty());
        assert!(!error.contains("Cannot run Azure CLI"));
    }
}

#[test]
fn subcommand_help_and_equals_options_use_clap_without_authentication() {
    for args in [
        vec!["list", "--help"],
        vec!["view", "--help"],
        vec!["watch", "--help"],
        vec!["list", "--backend=graph", "--help"],
        vec![
            "view",
            "--tenant-id=example-tenant",
            "--region=emea",
            "--help",
        ],
    ] {
        let output = run(&args);
        assert!(output.status.success());
        let help = String::from_utf8(output.stdout).unwrap();
        assert!(help.contains("Usage: teams-cli "));
        assert!(help.contains("--backend"));
        assert!(output.stderr.is_empty());
    }
}
