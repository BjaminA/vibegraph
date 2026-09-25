//! Reading routing tables off disk.

use std::fs;

/// A routing table loaded from a file.
pub struct Store {
    pub raw: String,
}

impl Store {
    /// Read the table at `path`.
    ///
    /// The fs boundary this thread leaves through: `fs::read_to_string`
    /// is std, called by path, and the effect table stamps it.
    pub fn open(path: &str) -> Store {
        let raw = fs::read_to_string(path).unwrap_or_default();
        Store { raw }
    }

    /// The table as JSON, through the one declared third-party crate.
    pub fn as_json(&self) -> String {
        serde_json::to_string(&self.raw).unwrap_or_default()
    }
}
