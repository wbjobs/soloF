use git2::Cred;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshAuthConfig {
    pub private_key_path: String,
    pub passphrase: Option<String>,
    pub use_ssh_agent: bool,
}

impl Default for SshAuthConfig {
    fn default() -> Self {
        let default_key = if cfg!(windows) {
            dirs::home_dir()
                .map(|h| h.join(".ssh").join("id_rsa"))
                .unwrap_or_else(|| PathBuf::from("C:\\Users\\user\\.ssh\\id_rsa"))
                .to_string_lossy()
                .to_string()
        } else {
            dirs::home_dir()
                .map(|h| h.join(".ssh").join("id_rsa"))
                .unwrap_or_else(|| PathBuf::from("~/.ssh/id_rsa"))
                .to_string_lossy()
                .to_string()
        };

        Self {
            private_key_path: default_key,
            passphrase: None,
            use_ssh_agent: true,
        }
    }
}

pub fn create_ssh_credentials(
    config: Option<&SshAuthConfig>,
    url: &str,
    username_from_url: Option<&str>,
    allowed_types: git2::CredentialType,
) -> Result<Cred, git2::Error> {
    let username = username_from_url.unwrap_or("git");

    if allowed_types.is_ssh_key() {
        if let Some(cfg) = config {
            if cfg.use_ssh_agent {
                match Cred::ssh_key_from_agent(username) {
                    Ok(cred) => {
                        println!("SSH Agent authentication successful for user: {}", username);
                        return Ok(cred);
                    }
                    Err(e) => {
                        println!("SSH Agent failed, falling back to key file: {}", e);
                    }
                }
            }

            if !cfg.private_key_path.is_empty() {
                let key_path = std::path::Path::new(&cfg.private_key_path);
                if key_path.exists() {
                    let pubkey_path: Option<&std::path::Path> = None;
                    let passphrase = cfg.passphrase.as_deref();

                    match Cred::ssh_key(username, pubkey_path, key_path, passphrase) {
                        Ok(cred) => {
                            println!("SSH key authentication successful: {}", cfg.private_key_path);
                            return Ok(cred);
                        }
                        Err(e) => {
                            println!("SSH key file authentication failed: {}", e);
                        }
                    }
                } else {
                    println!("SSH key file not found: {}", cfg.private_key_path);
                }
            }
        }

        if cfg!(windows) {
            if let Ok(home) = dirs::home_dir() {
                let default_keys = [
                    home.join(".ssh").join("id_ed25519"),
                    home.join(".ssh").join("id_rsa"),
                    home.join(".ssh").join("id_ecdsa"),
                ];

                for key_path in &default_keys {
                    if key_path.exists() {
                        if let Ok(cred) = Cred::ssh_key(username, None, key_path, None) {
                            println!("Default SSH key found and used: {:?}", key_path);
                            return Ok(cred);
                        }
                    }
                }
            }
        }
    }

    if allowed_types.is_user_pass_plaintext() {
        if let Some(cfg) = config {
            if let Some(pass) = cfg.passphrase.as_deref() {
                return Cred::userpass_plaintext(username, pass);
            }
        }
    }

    if allowed_types.is_default() {
        return Cred::default();
    }

    Err(git2::Error::from_str(&format!(
        "No supported authentication method available. Allowed types: {:?}, URL: {}",
        allowed_types, url
    )))
}
