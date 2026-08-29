use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_BLOB_BYTES: usize = 2 * 1024 * 1024; // 2MB cap per snapshot

#[derive(Clone, Debug)]
pub struct BlobStore {
    root_dir: PathBuf,
}

impl BlobStore {
    pub fn new<P: AsRef<Path>>(root_dir: P) -> Self {
        Self {
            root_dir: root_dir.as_ref().to_path_buf(),
        }
    }

    pub fn default_store() -> Option<Self> {
        dirs::data_dir().map(|d| Self::new(d.join("voktty").join("review_blobs")))
    }

    pub fn compute_hash(content: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        hex::encode(hasher.finalize())
    }

    pub fn store(&self, content: &str) -> Result<String, String> {
        if content.len() > MAX_BLOB_BYTES {
            return Err(format!(
                "Snapshot content exceeds maximum size of {} bytes",
                MAX_BLOB_BYTES
            ));
        }

        let hash = Self::compute_hash(content);
        if !self.root_dir.exists() {
            fs::create_dir_all(&self.root_dir).map_err(|e| e.to_string())?;
        }

        let blob_path = self.root_dir.join(&hash);
        if !blob_path.exists() {
            fs::write(&blob_path, content.as_bytes()).map_err(|e| e.to_string())?;
        }

        Ok(hash)
    }

    pub fn read(&self, hash: &str) -> Result<String, String> {
        if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid hash format".to_string());
        }

        let blob_path = self.root_dir.join(hash);
        if !blob_path.exists() {
            return Err(format!("Blob not found for hash {}", hash));
        }

        fs::read_to_string(&blob_path).map_err(|e| e.to_string())
    }

    pub fn exists(&self, hash: &str) -> bool {
        self.root_dir.join(hash).is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blob_store_lifecycle() {
        let temp_dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(temp_dir.path());

        let content = "fn main() {\n    println!(\"Hello\");\n}\n";
        let hash = store.store(content).unwrap();

        assert_eq!(hash.len(), 64);
        assert!(store.exists(&hash));

        let retrieved = store.read(&hash).unwrap();
        assert_eq!(retrieved, content);
    }

    #[test]
    fn test_blob_store_size_limit() {
        let temp_dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(temp_dir.path());

        let large_content = "a".repeat(MAX_BLOB_BYTES + 10);
        let res = store.store(&large_content);
        assert!(res.is_err());
    }
}
