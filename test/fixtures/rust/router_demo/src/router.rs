//! Packet routing: named sinks, and the one entry that fans out to them.

use std::collections::HashMap;

/// A sink accepts a routed payload, or says why it could not.
pub trait Sink {
    fn deliver(&mut self, payload: &str) -> Result<(), String>;
}

/// Writes every payload it is handed to stdout.
pub struct LogSink {
    pub written: usize,
}

impl Sink for LogSink {
    fn deliver(&mut self, payload: &str) -> Result<(), String> {
        self.written += 1;
        println!("log: {}", payload);
        Ok(())
    }
}

/// Accepts everything and keeps none of it.
pub struct DropSink;

impl Sink for DropSink {
    fn deliver(&mut self, _payload: &str) -> Result<(), String> {
        Ok(())
    }
}

/// Holds the named sinks and counts what it has routed.
pub struct Router {
    sinks: HashMap<String, Box<dyn Sink>>,
    pub count: usize,
}

impl Router {
    /// An empty router with no sinks registered.
    pub fn new() -> Router {
        Router { sinks: HashMap::new(), count: 0 }
    }

    /// Register a sink under a name.
    pub fn add(&mut self, name: &str, sink: Box<dyn Sink>) {
        self.sinks.insert(name.to_string(), sink);
    }

    /// Route one payload to the named sink.
    ///
    /// The `?` short-circuits when the name is unknown; the tail call is
    /// the delivery itself, and it dispatches on a trait object, so which
    /// `deliver` runs is a genuine runtime question.
    pub fn route(&mut self, name: &str, payload: &str) -> Result<(), String> {
        let sink = self.sinks.get_mut(name).ok_or_else(|| unknown_sink(name))?;
        self.count += 1;
        sink.deliver(payload)
    }
}

/// The error text for a name no sink is registered under.
pub fn unknown_sink(name: &str) -> String {
    format!("no sink named {}", name)
}

/// Split one `key: value` line, or None when it is not one.
pub fn parse_line(line: &str) -> Option<(String, String)> {
    let mut parts = line.splitn(2, ':');
    let key = parts.next()?;
    let value = parts.next()?;
    match key.trim() {
        "" => None,
        k => Some((k.to_string(), value.trim().to_string())),
    }
}
