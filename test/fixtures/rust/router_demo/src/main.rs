//! The cli entry. Reads a table, routes every line in it, reports.

use router_demo::router::{parse_line, DropSink, LogSink, Router};
use router_demo::store::Store;
use std::process;

/// How many lines the table holds, for the closing report.
fn line_count(raw: &str) -> usize {
    raw.lines().count()
}

/// Route every line of the table, then report what was routed.
fn main() {
    let store = Store::open("table.txt");
    let mut router = Router::new();
    router.add("log", Box::new(LogSink { written: 0 }));
    router.add("drop", Box::new(DropSink));

    for line in store.raw.lines() {
        if let Some((key, value)) = parse_line(line) {
            match router.route(&key, &value) {
                Ok(()) => {}
                Err(reason) => eprintln!("dropped: {}", reason),
            }
        }
    }

    // A macro with a call inside: the argument is a TOKEN TREE, so the
    // call is invisible to a tree walk and the node is flagged instead.
    println!("routed {} of {}", router.count, line_count(&store.raw));
    // A macro with no call inside: nothing to flag.
    println!("done");

    process::exit(0)
}
