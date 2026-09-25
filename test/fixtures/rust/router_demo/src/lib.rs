//! The router-demo crate root.
//!
//! A library crate so the binary AND the integration test both import it
//! by its Cargo name (`router_demo`, the `-` collapsed to `_`), which is
//! the link path only a real crate layout exercises.

pub mod router;
pub mod store;
