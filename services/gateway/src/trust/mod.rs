//! Shared trust contract: the single source of truth for mapping independence
//! evidence to a trust tier. The NLP synthesis worker (Phase 2B-ii) is built
//! against this; acoustic converges onto it in a later migration.
pub mod contract;
