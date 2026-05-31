use clap::Parser;
use common::log_service::{log_service_client::LogServiceClient, LogEntry};
use std::path::PathBuf;
use std::time::SystemTime;
use tokio;
use anyhow::{Result, Context};
use tracing::{info, error, warn, debug};
use encoding_rs::{UTF_8, GBK, GB18030, BIG5};
use indicatif::{ProgressBar, ProgressStyle, MultiProgress};
use colored::*;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(long, help = "服务器列表，逗号分隔")]
    servers: String,

    #[arg(long, help = "日志路径")]
    log_path: String,

    #[arg(long, help = "后端gRPC地址")]
    grpc_addr: String,
}

async fn fetch_logs_from_server(server: &str, log_path: &str, pb: &ProgressBar) -> Result<Vec<LogEntry>> {
    pb.set_message(format!("{}: 正在扫描...", server));
    
    let mut entries = Vec::new();
    
    if server == "localhost" || server == "127.0.0.1" {
        entries = fetch_local_logs(log_path, server, pb).await?;
    } else {
        pb.set_message(format!("{}: 模拟远程拉取...", server));
        entries = simulate_remote_logs(server, log_path);
        pb.inc(1);
    }
    
    Ok(entries)
}

async fn fetch_local_logs(log_path: &str, server_name: &str, pb: &ProgressBar) -> Result<Vec<LogEntry>> {
    let mut entries = Vec::new();
    let path = PathBuf::from(log_path);
    
    if !path.exists() {
        pb.set_message(format!("{}: 路径不存在", server_name));
        warn!("日志路径不存在: {}", log_path);
        return Ok(entries);
    }
    
    if path.is_file() {
        pb.set_message(format!("{}: 读取文件...", server_name));
        entries.extend(read_log_file(&path, server_name).await?);
        pb.inc(1);
    } else if path.is_dir() {
        use walkdir::WalkDir;
        let files: Vec<_> = WalkDir::new(log_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .collect();
        
        pb.set_length(files.len() as u64);
        
        for entry in files {
            pb.set_message(format!("{}: {}", server_name, entry.path().display()));
            entries.extend(read_log_file(entry.path(), server_name).await?);
            pb.inc(1);
        }
    }
    
    Ok(entries)
}

fn detect_encoding(bytes: &[u8]) -> &'static encoding_rs::Encoding {
    if UTF_8.decode(bytes, false).1 {
        return UTF_8;
    }
    
    let (_, _, had_errors) = GBK.decode(bytes, false);
    if !had_errors {
        return GBK;
    }
    
    let (_, _, had_errors) = GB18030.decode(bytes, false);
    if !had_errors {
        return GB18030;
    }
    
    let (_, _, had_errors) = BIG5.decode(bytes, false);
    if !had_errors {
        return BIG5;
    }
    
    UTF_8
}

async fn read_log_file(file_path: &std::path::Path, server_name: &str) -> Result<Vec<LogEntry>> {
    let bytes = tokio::fs::read(file_path)
        .await
        .context(format!("读取文件失败: {:?}", file_path))?;
    
    let encoding = detect_encoding(&bytes);
    debug!("检测到文件 {:?} 编码: {}", file_path, encoding.name());
    
    let (content, _, _) = encoding.decode(&bytes);
    
    let mut entries = Vec::new();
    let file_path_str = file_path.to_string_lossy().to_string();
    
    for line in content.lines() {
        if !line.trim().is_empty() {
            let timestamp = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)?
                .as_secs() as i64;
            
            let log_type = if line.starts_with('{') && line.ends_with('}') {
                "json".to_string()
            } else {
                "text".to_string()
            };
            
            entries.push(LogEntry {
                server_name: server_name.to_string(),
                file_path: file_path_str.clone(),
                content: line.to_string(),
                timestamp,
                log_type,
            });
        }
    }
    
    info!("从文件 {:?} 读取了 {} 条日志 (编码: {})", file_path, entries.len(), encoding.name());
    Ok(entries)
}

fn simulate_remote_logs(server: &str, log_path: &str) -> Vec<LogEntry> {
    let mut entries = Vec::new();
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    let sample_logs = vec![
        "2024-01-15 10:00:00 INFO Application started successfully",
        "2024-01-15 10:00:01 WARN Memory usage is high: 85%",
        "2024-01-15 10:00:02 ERROR Failed to connect to database",
        "2024-01-15 10:00:03 DEBUG Processing request id=12345",
        r#"{"timestamp": "2024-01-15T10:00:04Z", "level": "ERROR", "message": "Connection timeout", "service": "api-gateway"}"#,
        r#"{"timestamp": "2024-01-15T10:00:05Z", "level": "WARN", "message": "Rate limit approaching", "service": "auth-service"}"#,
    ];
    
    for (i, log) in sample_logs.iter().enumerate() {
        let log_type = if log.starts_with('{') { "json" } else { "text" };
        entries.push(LogEntry {
            server_name: server.to_string(),
            file_path: format!("{}/app{}.log", log_path, i),
            content: log.to_string(),
            timestamp: timestamp + i as i64,
            log_type: log_type.to_string(),
        });
    }
    
    entries
}

async fn send_logs(grpc_addr: &str, entries: Vec<LogEntry>, pb: &ProgressBar) -> Result<()> {
    pb.set_message("连接gRPC服务...");
    
    let mut client = LogServiceClient::connect(grpc_addr.to_string())
        .await
        .context("连接gRPC服务失败")?;
    
    pb.set_message(format!("发送 {} 条日志...", entries.len()));
    
    let request = common::log_service::SendLogEntriesRequest { entries };
    
    let response = client.send_log_entries(tonic::Request::new(request))
        .await
        .context("发送日志失败")?;
    
    let response = response.into_inner();
    pb.finish_with_message(format!("发送成功! 接收: {} 条", response.received_count));
    
    Ok(())
}

fn create_progress_style() -> ProgressStyle {
    ProgressStyle::default_bar()
        .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos:>7}/{len:7} {msg}")
        .unwrap()
        .progress_chars("=>-")
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    
    let args = Args::parse();
    
    println!("\n{}", "╔════════════════════════════════════════╗".bright_yellow());
    println!("{}", "║        日志收集器 CLI 工具           ║".bright_yellow());
    println!("{}", "╚════════════════════════════════════════╝".bright_yellow());
    println!();
    println!("{} {}", "服务器列表:".bright_cyan(), args.servers);
    println!("{} {}", "日志路径:".bright_cyan(), args.log_path);
    println!("{} {}", "gRPC地址:".bright_cyan(), args.grpc_addr);
    println!();
    
    let servers: Vec<&str> = args.servers.split(',').map(|s| s.trim()).collect();
    
    let multi_pb = MultiProgress::new();
    let style = create_progress_style();
    
    println!("{}", "📥  正在从服务器拉取日志...".bright_green());
    println!();
    
    let mut all_entries = Vec::new();
    
    for server in &servers {
        let pb = multi_pb.add(ProgressBar::new(100));
        pb.set_style(style.clone());
        pb.set_message(format!("{}: 初始化...", server));
        
        match fetch_logs_from_server(server, &args.log_path, &pb).await {
            Ok(entries) => {
                pb.finish_with_message(format!("{}: 获取 {} 条日志 ✓", server, entries.len()));
                all_entries.extend(entries);
            }
            Err(e) => {
                pb.finish_with_message(format!("{}: 拉取失败 ✗", server));
                error!("从服务器 {} 拉取日志失败: {}", server, e);
            }
        }
    }
    
    multi_pb.clear()?;
    println!();
    
    if !all_entries.is_empty() {
        println!("{}", "📤  正在发送日志到后端...".bright_green());
        
        let send_pb = ProgressBar::new(all_entries.len() as u64);
        send_pb.set_style(style.clone());
        
        send_logs(&args.grpc_addr, all_entries, &send_pb).await?;
    } else {
        println!("{}", "⚠️  没有获取到任何日志".bright_yellow());
    }
    
    println!();
    println!("{}", "✅  任务完成!".bright_green());
    println!();
    
    Ok(())
}
