use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(name = "sctp-gateway", about = "SCTP Gateway with stream mapping and multi-path")]
pub struct CliArgs {
    #[arg(long, default_value = "127.0.0.1:9000", help = "SCTP listen address")]
    pub sctp_listen_addr: String,

    #[arg(long, default_value = "127.0.0.1:8080", help = "Control API listen address")]
    pub api_listen_addr: String,

    #[arg(long, help = "Network interfaces for multi-path (comma separated)")]
    pub network_interfaces: Option<String>,

    #[arg(long, default_value_t = 4096, help = "Maximum SCTP packet size")]
    pub max_packet_size: usize,

    #[arg(long, default_value_t = 65536, help = "Stream receive buffer size")]
    pub recv_buffer_size: usize,

    #[arg(long, default_value_t = 65536, help = "Stream send buffer size")]
    pub send_buffer_size: usize,

    #[arg(long, help = "Config file path")]
    pub config_file: Option<PathBuf>,

    #[arg(long, default_value_t = false, help = "Enable verbose logging")]
    pub verbose: bool,
}

impl CliArgs {
    pub fn parse_interfaces(&self) -> Vec<String> {
        self.network_interfaces
            .as_ref()
            .map(|s| s.split(',').map(|i| i.trim().to_string()).collect())
            .unwrap_or_default()
    }
}
