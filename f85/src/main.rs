use clap::Parser;
use std::net::SocketAddr;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use sctp_gateway::*;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = CliArgs::parse();

    let log_level = if args.verbose { "debug" } else { "info" };
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("{}={}", module_path!(), log_level)));

    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .json()
        .init();

    info!(version = %env!("CARGO_PKG_VERSION"), "Starting SCTP Gateway");
    info!(sctp_addr = %args.sctp_listen_addr, api_addr = %args.api_listen_addr, "Configuration");

    let mut gateway = SctpGateway::new(args.clone());
    gateway.initialize().await?;

    let api_state = gateway.api_state();

    let api_addr: SocketAddr = args.api_listen_addr.parse()?;
    tokio::spawn(async move {
        if let Err(e) = api::server::start_api_server(api_addr, api_state).await {
            warn!(error = %e, "API server error");
        }
    });

    gateway.run().await?;

    info!("SCTP Gateway stopped");
    Ok(())
}
