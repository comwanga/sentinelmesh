// services/blockchain/src/main.rs
mod config;
mod db;

fn main() {
    let _config = config::Config::from_env().unwrap_or_else(|e| {
        eprintln!("[blockchain] config error: {}", e);
        std::process::exit(1);
    });
    println!("blockchain config loaded");
}
