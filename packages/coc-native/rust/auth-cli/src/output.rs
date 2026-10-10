use auth_sdk::{microsoft::SignInInstructions, Token};
use serde_json::json;
use std::io::{self, Write};
use zeroize::Zeroizing;

pub fn secret(value: &str, show: bool) -> Zeroizing<String> {
    if show {
        return Zeroizing::new(value.to_owned());
    }
    let count = value.chars().count();
    if count <= 16 {
        return Zeroizing::new("[redacted]".into());
    }
    let prefix_end = value.char_indices().nth(8).expect("long secret").0;
    let suffix_start = value.char_indices().nth(count - 8).expect("long secret").0;
    Zeroizing::new(format!("{}...[redacted]...{}", &value[..prefix_end], &value[suffix_start..]))
}

fn authorization_url(value: &str, show: bool) -> Zeroizing<String> {
    if show {
        return Zeroizing::new(value.to_owned());
    }
    // The authorization URL includes secret state/nonce values. Mask its entire
    // query so future protocol parameters cannot silently escape redaction.
    let end = value.find(['?', '#']).unwrap_or(value.len());
    Zeroizing::new(if end == value.len() {
        value.to_owned()
    } else {
        format!("{}?[redacted]", &value[..end])
    })
}

fn line(writer: &mut impl Write, value: serde_json::Value) -> io::Result<()> {
    let encoded = Zeroizing::new(value.to_string());
    // JSON owns a copy of each secret string; explicitly erase those copies.
    let mut value = value;
    erase(&mut value);
    writer.write_all(encoded.as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()
}

fn erase(value: &mut serde_json::Value) {
    use zeroize::Zeroize;
    match value {
        serde_json::Value::String(value) => value.zeroize(),
        serde_json::Value::Array(values) => values.iter_mut().for_each(erase),
        serde_json::Value::Object(values) => values.values_mut().for_each(erase),
        _ => {}
    }
}

pub fn token(writer: &mut impl Write, token: &Token, show: bool) -> io::Result<()> {
    let access_token = secret(token.access_token.expose(), show);
    let mut value = json!({
        "event": "token",
        "accessToken": access_token.as_str(),
        "tokenType": token.token_type,
        "expiresAt": token.expires_at,
        "source": token.source,
        "target": token.target,
        "account": token.account,
        "secretsRedacted": !show,
    });
    if let Some(scopes) = &token.granted_scopes {
        value["grantedScopes"] = json!(scopes);
    }
    line(writer, value)
}

pub fn login(writer: &mut impl Write) -> io::Result<()> {
    line(writer, json!({ "event": "login", "source": "azure-cli", "authenticated": true }))
}

pub fn instructions(
    writer: &mut impl Write,
    instructions: &SignInInstructions,
    show: bool,
) -> io::Result<()> {
    let url = instructions.authorization_url.as_ref().map(|value| authorization_url(value, show));
    let code = instructions.user_code.as_ref().map(|value| secret(value, show));
    let verification =
        instructions.verification_uri.as_ref().map(|value| authorization_url(value, show));
    line(
        writer,
        json!({
            "event": "signInInstructions",
            "authorizationUrl": url.as_deref().map(String::as_str),
            "userCode": code.as_deref().map(String::as_str),
            "verificationUri": verification.as_deref().map(String::as_str),
            "expiresAt": instructions.expires_at,
            "secretsRedacted": !show,
            "instruction": if show {
                "Open the authorization URL, or open the verification URI and enter the user code."
            } else {
                "Sign-in instructions are masked. Cancel and rerun with --show-secrets to complete sign-in."
            },
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use auth_sdk::{Account, Secret};

    #[test]
    fn masks_short_overlap_empty_unicode_and_long_secrets() {
        for value in ["", "short", "1234567890123456"] {
            assert_eq!(secret(value, false).as_str(), "[redacted]");
        }
        assert_eq!(
            secret("12345678hidden87654321", false).as_str(),
            "12345678...[redacted]...87654321"
        );
        assert_eq!(secret("abcdefghXijklmnop", false).as_str(), "abcdefgh...[redacted]...ijklmnop");
        assert_eq!(secret("abcdefghSECRETijklmnop", true).as_str(), "abcdefghSECRETijklmnop");
        assert_eq!(
            secret("ééééééééhiddenøøøøøøøø", false).as_str(),
            "éééééééé...[redacted]...øøøøøøøø"
        );
    }

    #[test]
    fn token_dto_is_masked_by_default_and_never_invents_scopes() {
        let token = Token {
            access_token: Secret::new("abcdefghPRIVATEijklmnop".into()),
            token_type: "Bearer".into(),
            expires_at: 123,
            source: "oauth".into(),
            target: "fixture".into(),
            account: Account { id: "fixture".into(), tenant: "fixture".into() },
            granted_scopes: None,
        };
        for show in [false, true] {
            let mut bytes = Vec::new();
            super::token(&mut bytes, &token, show).unwrap();
            let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(value["secretsRedacted"], !show);
            assert_eq!(String::from_utf8(bytes).unwrap().contains("PRIVATE"), show);
            assert!(value.get("grantedScopes").is_none());
        }
    }

    #[test]
    fn sign_in_output_masks_protocol_secrets() {
        let value = SignInInstructions {
            authorization_url: Some(
                "https://login.example/authorize?state=PRIVATE&nonce=PRIVATE".into(),
            ),
            user_code: Some("PRIVATE".into()),
            verification_uri: Some("https://login.example/device?code=PRIVATE#PRIVATE".into()),
            expires_at: 123,
        };
        for show in [false, true] {
            let mut bytes = Vec::new();
            instructions(&mut bytes, &value, show).unwrap();
            assert_eq!(String::from_utf8(bytes).unwrap().contains("PRIVATE"), show);
        }
    }
}
