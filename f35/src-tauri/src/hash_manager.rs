use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHash {
    pub path: String,
    pub hash: String,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashRecord {
    pub files: HashMap<String, FileHash>,
    pub last_updated: u64,
}

impl Default for HashRecord {
    fn default() -> Self {
        Self {
            files: HashMap::new(),
            last_updated: 0,
        }
    }
}

pub struct HashManager {
    base_path: Option<PathBuf>,
    hash_file: Option<PathBuf>,
    record: HashRecord,
}

impl HashManager {
    pub fn new() -> Self {
        Self {
            base_path: None,
            hash_file: None,
            record: HashRecord::default(),
        }
    }

    pub fn set_base_path(&mut self, path: &str) {
        let base_path = PathBuf::from(path);
        self.hash_file = Some(base_path.join(".file_hashes.json"));
        self.base_path = Some(base_path);
    }

    pub fn load_hashes(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(hash_file) = &self.hash_file {
            if hash_file.exists() {
                let content = fs::read_to_string(hash_file)?;
                self.record = serde_json::from_str(&content)?;
            } else {
                self.record = HashRecord::default();
                self.save_hashes()?;
            }
        }
        Ok(())
    }

    pub fn save_hashes(&self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(hash_file) = &self.hash_file {
            let content = serde_json::to_string_pretty(&self.record)?;
            fs::write(hash_file, content)?;
        }
        Ok(())
    }

    pub fn calculate_hash(&self, path: &str) -> Result<String, Box<dyn std::error::Error>> {
        let content = fs::read(path)?;
        let mut hasher = Sha256::new();
        hasher.update(content);
        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }

    pub fn update_file_hash(&mut self, path: &str) -> Result<(), Box<dyn std::error::Error>> {
        let hash = self.calculate_hash(path)?;
        let modified = get_timestamp();
        
        let relative_path = if let Some(base) = &self.base_path {
            let path_buf = PathBuf::from(path);
            if let Ok(rel) = path_buf.strip_prefix(base) {
                rel.to_string_lossy().to_string()
            } else {
                path.to_string()
            }
        } else {
            path.to_string()
        };

        self.record.files.insert(
            relative_path.clone(),
            FileHash {
                path: relative_path,
                hash,
                modified,
            },
        );
        self.record.last_updated = modified;
        self.save_hashes()?;
        Ok(())
    }

    pub fn remove_file_hash(&mut self, path: &str) -> Result<(), Box<dyn std::error::Error>> {
        let relative_path = if let Some(base) = &self.base_path {
            let path_buf = PathBuf::from(path);
            if let Ok(rel) = path_buf.strip_prefix(base) {
                rel.to_string_lossy().to_string()
            } else {
                path.to_string()
            }
        } else {
            path.to_string()
        };

        self.record.files.remove(&relative_path);
        self.record.last_updated = get_timestamp();
        self.save_hashes()?;
        Ok(())
    }

    pub fn get_all_hashes(&self) -> serde_json::Value {
        serde_json::to_value(&self.record).unwrap_or_default()
    }

    pub fn get_file_hash(&self, path: &str) -> Option<&FileHash> {
        self.record.files.get(path)
    }
}

fn get_timestamp() -> u64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
