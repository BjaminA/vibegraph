//! Integration tests — a separate crate, importing router-demo by name.

use router_demo::router::{parse_line, LogSink, Router};

/// A registered sink receives the payload.
#[test]
fn routes_to_named_sink() {
    let mut router = Router::new();
    router.add("log", Box::new(LogSink { written: 0 }));
    let outcome = router.route("log", "hello");
    assert!(outcome.is_ok());
}

/// An unregistered name is an error, not a panic.
#[test]
fn unknown_sink_errors() {
    let mut router = Router::new();
    let outcome = router.route("nope", "hello");
    assert!(outcome.is_err());
}

/// A line without a colon is not a pair.
#[test]
fn parse_line_needs_a_colon() {
    assert!(parse_line("no colon here").is_none());
}
