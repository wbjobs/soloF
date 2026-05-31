use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Git error: {0}")]
    GitError(#[from] git2::Error),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Path error: {0}")]
    PathError(String),
    #[error("SSH error: {0}")]
    SshError(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}
