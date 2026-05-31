const std = @import("std");
const types = @import("types.zig");
const ssh_reader = @import("ssh_reader.zig");
const log_parser = @import("log_parser.zig");
const aggregator = @import("aggregator.zig");
const color_output = @import("color_output.zig");
const config_loader = @import("config.zig");
const connection_manager = @import("connection_manager.zig");
const flame_graph = @import("flame_graph.zig");

const SshReader = ssh_reader.SshReader;
const LogParser = log_parser.LogParser;
const LogAggregator = aggregator.LogAggregator;
const ColorOutput = color_output.ColorOutput;
const ConfigLoader = config_loader.ConfigLoader;
const Config = types.Config;
const LogEntry = types.LogEntry;
const ServiceConfig = types.ServiceConfig;
const ConnectionManager = connection_manager.ConnectionManager;
const FlameGraphGenerator = flame_graph.FlameGraphGenerator;

const ReaderContext = struct {
    reader: SshReader,
    buf: []u8,
    thread: std.Thread,
    should_stop: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false),
    aggregator: *LogAggregator,
    parser: *LogParser,
    service: ServiceConfig,
    is_local: bool = false,
    local_file: ?std.fs.File = null,
};

const LocalReaderContext = struct {
    file_path: []const u8,
    buf: []u8,
    should_stop: *std.atomic.Atomic(bool),
    aggregator: *LogAggregator,
    parser: *LogParser,
    service: ServiceConfig,
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var args = try std.process.argsWithAllocator(allocator);
    defer args.deinit();

    _ = args.skip();

    var config_path: ?[]const u8 = null;
    var trace_id: ?[]const u8 = null;
    var follow = false;
    var lines: u32 = 100;
    var show_help = false;
    var services_input = std.ArrayList([]const u8).init(allocator);
    defer services_input.deinit();
    var local_files = std.ArrayList([]const u8).init(allocator);
    defer local_files.deinit();
    var demo_mode = false;
    var flame_graph_output: ?[]const u8 = null;
    var show_stats = false;

    while (args.next()) |arg| {
        if (std.mem.eql(u8, arg, "--config") or std.mem.eql(u8, arg, "-c")) {
            config_path = args.next() orelse {
                std.debug.print("Error: --config requires a path\n", .{});
                return;
            };
        } else if (std.mem.eql(u8, arg, "--trace-id") or std.mem.eql(u8, arg, "-t")) {
            trace_id = args.next() orelse {
                std.debug.print("Error: --trace-id requires an ID\n", .{});
                return;
            };
        } else if (std.mem.eql(u8, arg, "--follow") or std.mem.eql(u8, arg, "-f")) {
            follow = true;
        } else if (std.mem.eql(u8, arg, "--lines") or std.mem.eql(u8, arg, "-n")) {
            const n = args.next() orelse {
                std.debug.print("Error: --lines requires a number\n", .{});
                return;
            };
            lines = std.fmt.parseInt(u32, n, 10) catch 100;
        } else if (std.mem.eql(u8, arg, "--service") or std.mem.eql(u8, arg, "-s")) {
            const svc = args.next() orelse {
                std.debug.print("Error: --service requires a value\n", .{});
                return;
            };
            try services_input.append(try allocator.dupe(u8, svc));
        } else if (std.mem.eql(u8, arg, "--local") or std.mem.eql(u8, arg, "-l")) {
            const file = args.next() orelse {
                std.debug.print("Error: --local requires a file path\n", .{});
                return;
            };
            try local_files.append(try allocator.dupe(u8, file));
        } else if (std.mem.eql(u8, arg, "--flame-graph")) {
            flame_graph_output = args.next() orelse {
                std.debug.print("Error: --flame-graph requires an output path\n", .{});
                return;
            };
        } else if (std.mem.eql(u8, arg, "--stats")) {
            show_stats = true;
        } else if (std.mem.eql(u8, arg, "--demo")) {
            demo_mode = true;
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            show_help = true;
        } else {
            std.debug.print("Unknown argument: {s}\n", .{arg});
            show_help = true;
        }
    }

    if (show_help) {
        printHelp();
        return;
    }

    const stdout = std.io.getStdOut().writer();
    var output = ColorOutput.init(allocator, stdout);

    var config: Config = undefined;
    if (config_path) |path| {
        var loader = ConfigLoader.init(allocator);
        config = loader.loadFromFile(path) catch |err| {
            try output.printError(try std.fmt.allocPrint(allocator, "Failed to load config: {}", .{err}));
            return;
        };
    } else {
        config = try buildConfigFromServices(allocator, services_input.items);
    }
    defer config.deinit();

    if (flame_graph_output) |fg| {
        config.flame_graph_output = try allocator.dupe(u8, fg);
    }

    if (demo_mode) {
        try runDemoMode(allocator, &output, trace_id orelse "abc123def456", config.flame_graph_output, show_stats);
        return;
    }

    if (local_files.items.len > 0) {
        try runLocalMode(allocator, &output, local_files.items, trace_id, config.flame_graph_output, show_stats);
        return;
    }

    if (config.services.items.len == 0) {
        try output.printError("No services configured. Use --config, --service, --local, or --demo options.");
        printHelp();
        return;
    }

    if (trace_id) |tid| {
        config.trace_id = try allocator.dupe(u8, tid);
    }
    config.follow = follow;
    config.lines = lines;

    try runTraceCli(allocator, &output, config, show_stats);
}

fn buildConfigFromServices(allocator: std.mem.Allocator, services: []const []const u8) !Config {
    var config = Config.init(allocator);

    const colors = [_][]const u8{ "cyan", "green", "yellow", "magenta", "blue", "red", "bright_cyan", "bright_green" };

    for (services, 0..) |svc_str, i| {
        var parts = std.mem.split(u8, svc_str, ":");
        const name = parts.first();
        const user_host = parts.next() orelse continue;
        const log_path = parts.rest();

        if (user_host.len == 0 or log_path.len == 0) continue;

        var user_parts = std.mem.split(u8, user_host, "@");
        const user = user_parts.first();
        const host = user_parts.rest();

        if (host.len == 0) continue;

        try config.services.append(.{
            .name = try allocator.dupe(u8, name),
            .host = try allocator.dupe(u8, host),
            .user = try allocator.dupe(u8, user),
            .log_path = try allocator.dupe(u8, log_path),
            .port = 22,
            .color = try allocator.dupe(u8, colors[i % colors.len]),
        });
    }

    return config;
}

fn printHelp() void {
    std.debug.print(
        \\trace-cli - High-performance distributed log aggregator
        \\
        \\Usage: trace-cli [options]
        \\
        \\Options:
        \\  -c, --config <path>        Path to JSON config file
        \\  -t, --trace-id <id>        Filter logs by Trace-ID
        \\  -f, --follow               Follow log output (like tail -f)
        \\  -n, --lines <num>          Number of lines to retrieve (default: 100)
        \\  -s, --service <spec>       Service specification: name:user@host:log_path
        \\                             Can be used multiple times
        \\  -l, --local <path>         Read from local log file (format: name:color:path)
        \\  --demo                     Run in demo mode with sample data
        \\  --flame-graph <path>       Generate flame graph data file (collapsed stack format)
        \\  --stats                    Show per-service timing statistics
        \\  -h, --help                 Show this help message
        \\
        \\Example:
        \\  trace-cli -c config.json -t abc123 -f
        \\  trace-cli -s gateway:admin@192.168.1.1:/var/log/gateway.log \
        \\            -s auth:admin@192.168.1.2:/var/log/auth.log \
        \\            -s order:admin@192.168.1.3:/var/log/order.log \
        \\            -t trace-12345
        \\  trace-cli --demo -t abc123def456
        \\  trace-cli -l gateway:cyan:sample_logs/gateway.log \
        \\            -l auth:green:sample_logs/auth.log \
        \\            -t abc123def456
        \\  trace-cli --demo -t abc123def456 --flame-graph flamegraph.txt --stats
        \\
    , .{});
}

fn runTraceCli(allocator: std.mem.Allocator, output: *ColorOutput, config: Config, show_stats: bool) !void {
    var agg = LogAggregator.init(allocator);
    defer agg.deinit();

    var parser = LogParser.init(allocator);

    try output.printHeader(config.trace_id, config.services.items);
    try output.printInfo("Connecting to services...");

    var readers = std.ArrayList(*ReaderContext).init(allocator);
    defer {
        for (readers.items) |ctx| {
            ctx.should_stop.store(true, .SeqCst);
            ctx.reader.stop();
            ctx.thread.join();
            allocator.free(ctx.buf);
            allocator.destroy(ctx);
        }
        readers.deinit();
    }

    var failed_count: usize = 0;
    for (config.services.items) |svc| {
        const ctx = try allocator.create(ReaderContext);
        ctx.* = .{
            .reader = SshReader.init(allocator, svc),
            .buf = try allocator.alloc(u8, 8192),
            .thread = undefined,
            .aggregator = &agg,
            .parser = &parser,
            .service = svc,
        };

        ctx.reader.start(config.follow, config.lines) catch |err| {
            failed_count += 1;
            try output.printError(try std.fmt.allocPrint(allocator, "Failed to connect to {s}@{s}: {}", .{ svc.user, svc.host, err }));
            allocator.free(ctx.buf);
            allocator.destroy(ctx);
            continue;
        };

        ctx.thread = try std.Thread.spawn(.{}, readLoop, .{ctx});
        try readers.append(ctx);

        const info = try std.fmt.allocPrint(allocator, "Connected to {s} ({s}@{s})", .{ svc.name, svc.user, svc.host });
        try output.printInfo(info);
        allocator.free(info);
    }

    if (readers.items.len == 0) {
        try output.printError("No successful connections");
        return;
    }

    if (failed_count > 0) {
        const warn_msg = try std.fmt.allocPrint(allocator, "{} service(s) failed to connect", .{failed_count});
        try output.printInfo(warn_msg);
        allocator.free(warn_msg);
    }

    try output.printInfo("Reading logs...");

    const read_duration = if (config.follow)
        60 * std.time.ns_per_s
    else
        5 * std.time.ns_per_s;

    var waited: u64 = 0;
    const check_interval = 500 * std.time.ns_per_ms;

    while (waited < read_duration) {
        std.time.sleep(check_interval);
        waited += check_interval;

        var active_count: usize = 0;
        for (readers.items) |ctx| {
            if (ctx.reader.is_running) {
                active_count += 1;
            }
        }

        if (active_count == 0) {
            break;
        }

        if (!config.follow and agg.len() > 0) {
            break;
        }
    }

    try output.printInfo("Stopping readers and collecting results...");

    for (readers.items) |ctx| {
        ctx.should_stop.store(true, .SeqCst);
        ctx.reader.stop();
    }

    for (readers.items) |ctx| {
        ctx.thread.join();
    }

    agg.sortByTimestamp();

    const total_entries = agg.len();
    var display_entries = agg.getEntries();

    if (config.trace_id) |tid| {
        var filtered = std.ArrayList(LogEntry).init(allocator);
        defer {
            for (filtered.items) |*entry| {
                entry.deinit(allocator);
            }
            filtered.deinit();
        }

        for (display_entries) |entry| {
            if (std.mem.eql(u8, entry.trace_id, tid)) {
                const dup = try allocator.create(LogEntry);
                dup.* = .{
                    .timestamp_ms = entry.timestamp_ms,
                    .timestamp = entry.timestamp,
                    .service = try allocator.dupe(u8, entry.service),
                    .trace_id = try allocator.dupe(u8, entry.trace_id),
                    .level = try allocator.dupe(u8, entry.level),
                    .message = try allocator.dupe(u8, entry.message),
                    .raw = try allocator.dupe(u8, entry.raw),
                    .color = try allocator.dupe(u8, entry.color),
                    .duration_ms = entry.duration_ms,
                };
                try filtered.append(dup.*);
                allocator.destroy(dup);
            }
        }
        display_entries = filtered.items;
    }

    for (display_entries) |entry| {
        try output.printEntry(entry);
    }

    try output.printStats(total_entries, display_entries.len, config.services.items.len);

    if (config.flame_graph_output) |fg_path| {
        if (config.trace_id) |tid| {
            var fg_gen = FlameGraphGenerator.init(allocator);
            fg_gen.generate(agg.getEntries(), tid, fg_path) catch |err| {
                try output.printError(try std.fmt.allocPrint(allocator, "Failed to generate flame graph: {}", .{err}));
                return;
            };
            const fg_msg = try std.fmt.allocPrint(allocator, "Flame graph data saved to: {s}", .{fg_path});
            try output.printInfo(fg_msg);
            allocator.free(fg_msg);
        } else {
            try output.printError("Flame graph requires a Trace-ID to be specified");
        }
    }

    if (show_stats) {
        if (config.trace_id) |tid| {
            var fg_gen = FlameGraphGenerator.init(allocator);
            fg_gen.generatePerServiceStats(agg.getEntries(), tid) catch {};
        }
    }
}

fn readLoop(ctx: *ReaderContext) void {
    while (!ctx.should_stop.load(.SeqCst) and ctx.reader.is_running) {
        const line = ctx.reader.readLine(ctx.buf) catch break;
        if (line) |l| {
            if (l.len > 0) {
                const entry = ctx.parser.parse(l, ctx.service.name, ctx.service.color) orelse continue;
                ctx.aggregator.addEntry(entry) catch continue;
            }
        } else {
            break;
        }
    }
}

fn runLocalMode(allocator: std.mem.Allocator, output: *ColorOutput, files: []const []const u8, trace_id: ?[]const u8, flame_graph_output: ?[]const u8, show_stats: bool) !void {
    var agg = LogAggregator.init(allocator);
    defer agg.deinit();

    var parser = LogParser.init(allocator);

    var services = std.ArrayList(ServiceConfig).init(allocator);
    defer services.deinit();

    const colors = [_][]const u8{"cyan", "green", "yellow", "magenta", "blue", "red"};

    for (files, 0..) |file_spec, i| {
        var parts = std.mem.split(u8, file_spec, ":");
        const name = parts.first();
        const color = parts.next() orelse colors[i % colors.len];
        const path = parts.rest();

        if (path.len == 0) continue;

        try services.append(.{
            .name = try allocator.dupe(u8, name),
            .host = try allocator.dupe(u8, "local"),
            .user = try allocator.dupe(u8, "local"),
            .log_path = try allocator.dupe(u8, path),
            .port = 0,
            .color = try allocator.dupe(u8, color),
        });
    }

    try output.printHeader(trace_id, services.items);

    for (services.items) |svc| {
        const file = std.fs.cwd().openFile(svc.log_path, .{}) catch |err| {
            try output.printError(try std.fmt.allocPrint(allocator, "Failed to open {s}: {}", .{ svc.log_path, err }));
            continue;
        };
        defer file.close();

        const reader = file.reader();
        var buf: [8192]u8 = undefined;
        while (true) {
            const line = reader.readUntilDelimiterOrEof(&buf, '\n') catch break;
            if (line) |l| {
                const entry = parser.parse(l, svc.name, svc.color) orelse continue;
                agg.addEntry(entry) catch continue;
            } else {
                break;
            }
        }

        const info = try std.fmt.allocPrint(allocator, "Loaded {s} from {s}", .{ svc.name, svc.log_path });
        try output.printInfo(info);
        allocator.free(info);
    }

    agg.sortByTimestamp();

    const total_entries = agg.len();
    var display_entries = agg.getEntries();

    if (trace_id) |tid| {
        var filtered = std.ArrayList(LogEntry).init(allocator);
        defer {
            for (filtered.items) |*entry| {
                entry.deinit(allocator);
            }
            filtered.deinit();
        }

        for (display_entries) |entry| {
            if (std.mem.eql(u8, entry.trace_id, tid)) {
                const dup = try allocator.create(LogEntry);
                dup.* = .{
                    .timestamp_ms = entry.timestamp_ms,
                    .timestamp = entry.timestamp,
                    .service = try allocator.dupe(u8, entry.service),
                    .trace_id = try allocator.dupe(u8, entry.trace_id),
                    .level = try allocator.dupe(u8, entry.level),
                    .message = try allocator.dupe(u8, entry.message),
                    .raw = try allocator.dupe(u8, entry.raw),
                    .color = try allocator.dupe(u8, entry.color),
                    .duration_ms = entry.duration_ms,
                };
                try filtered.append(dup.*);
                allocator.destroy(dup);
            }
        }
        display_entries = filtered.items;
    }

    for (display_entries) |entry| {
        try output.printEntry(entry);
    }

    try output.printStats(total_entries, display_entries.len, services.items.len);

    if (flame_graph_output) |fg_path| {
        if (trace_id) |tid| {
            var fg_gen = FlameGraphGenerator.init(allocator);
            fg_gen.generate(agg.getEntries(), tid, fg_path) catch |err| {
                try output.printError(try std.fmt.allocPrint(allocator, "Failed to generate flame graph: {}", .{err}));
                return;
            };
            const fg_msg = try std.fmt.allocPrint(allocator, "Flame graph data saved to: {s}", .{fg_path});
            try output.printInfo(fg_msg);
            allocator.free(fg_msg);
        } else {
            try output.printError("Flame graph requires a Trace-ID to be specified");
        }
    }

    if (show_stats) {
        if (trace_id) |tid| {
            var fg_gen = FlameGraphGenerator.init(allocator);
            fg_gen.generatePerServiceStats(agg.getEntries(), tid) catch {};
        }
    }
}

fn runDemoMode(allocator: std.mem.Allocator, output: *ColorOutput, trace_id: []const u8, flame_graph_output: ?[]const u8, show_stats: bool) !void {
    const demo_logs = [_][]const u8{
        "2024-01-15T10:30:01.123Z INFO  [gateway] trace_id=abc123def456 Request received: GET /api/v1/order/123",
        "2024-01-15T10:30:01.125Z INFO  [gateway] trace_id=abc123def456 Routing to auth-service",
        "2024-01-15T10:30:01.130Z INFO  [auth] trace_id=abc123def456 Validating token for user: user@example.com",
        "2024-01-15T10:30:01.180Z DEBUG [auth] trace_id=abc123def456 Token valid, roles: [user, admin]",
        "2024-01-15T10:30:01.190Z INFO  [auth] trace_id=abc123def456 Authentication successful",
        "2024-01-15T10:30:01.200Z INFO  [gateway] trace_id=abc123def456 Auth passed, forwarding to order-service",
        "2024-01-15T10:30:01.210Z INFO  [order] trace_id=abc123def456 Fetching order #123 from database",
        "2024-01-15T10:30:01.400Z DEBUG [order] trace_id=abc123def456 Order found: status=completed, total=$99.99",
        "2024-01-15T10:30:02.000Z INFO  [order] trace_id=abc123def456 Preparing order response",
        "2024-01-15T10:30:02.500Z INFO  [gateway] trace_id=abc123def456 Response sent: 200 OK",
        "2024-01-15T10:30:05.000Z INFO  [gateway] trace_id=xyz789ghi012 Request received: POST /api/v1/payment",
    };

    var agg = LogAggregator.init(allocator);
    defer agg.deinit();

    var parser = LogParser.init(allocator);

    var services = std.ArrayList(ServiceConfig).init(allocator);
    defer services.deinit();

    try services.append(.{
        .name = try allocator.dupe(u8, "gateway"),
        .host = try allocator.dupe(u8, "demo"),
        .user = try allocator.dupe(u8, "demo"),
        .log_path = try allocator.dupe(u8, "demo"),
        .port = 0,
        .color = try allocator.dupe(u8, "cyan"),
    });
    try services.append(.{
        .name = try allocator.dupe(u8, "auth"),
        .host = try allocator.dupe(u8, "demo"),
        .user = try allocator.dupe(u8, "demo"),
        .log_path = try allocator.dupe(u8, "demo"),
        .port = 0,
        .color = try allocator.dupe(u8, "green"),
    });
    try services.append(.{
        .name = try allocator.dupe(u8, "order"),
        .host = try allocator.dupe(u8, "demo"),
        .user = try allocator.dupe(u8, "demo"),
        .log_path = try allocator.dupe(u8, "demo"),
        .port = 0,
        .color = try allocator.dupe(u8, "yellow"),
    });

    try output.printHeader(trace_id, services.items);
    try output.printInfo("Running in demo mode...");

    for (demo_logs) |line| {
        var service_name: []const u8 = "unknown";
        var color: []const u8 = "white";

        if (std.mem.indexOf(u8, line, "[gateway]")) |_| {
            service_name = "gateway";
            color = "cyan";
        } else if (std.mem.indexOf(u8, line, "[auth]")) |_| {
            service_name = "auth";
            color = "green";
        } else if (std.mem.indexOf(u8, line, "[order]")) |_| {
            service_name = "order";
            color = "yellow";
        }

        const entry = parser.parse(line, service_name, color) orelse continue;
        try agg.addEntry(entry);
    }

    agg.sortByTimestamp();

    const total_entries = agg.len();
    var display_entries = agg.getEntries();

    var filtered = std.ArrayList(LogEntry).init(allocator);
    defer {
        for (filtered.items) |*entry| {
            entry.deinit(allocator);
        }
        filtered.deinit();
    }

    for (display_entries) |entry| {
        if (std.mem.eql(u8, entry.trace_id, trace_id)) {
            const dup = try allocator.create(LogEntry);
            dup.* = .{
                .timestamp_ms = entry.timestamp_ms,
                .timestamp = entry.timestamp,
                .service = try allocator.dupe(u8, entry.service),
                .trace_id = try allocator.dupe(u8, entry.trace_id),
                .level = try allocator.dupe(u8, entry.level),
                .message = try allocator.dupe(u8, entry.message),
                .raw = try allocator.dupe(u8, entry.raw),
                .color = try allocator.dupe(u8, entry.color),
                .duration_ms = entry.duration_ms,
            };
            try filtered.append(dup.*);
            allocator.destroy(dup);
        }
    }
    display_entries = filtered.items;

    for (display_entries) |entry| {
        try output.printEntry(entry);
    }

    try output.printStats(total_entries, display_entries.len, services.items.len);

    if (flame_graph_output) |fg_path| {
        var fg_gen = FlameGraphGenerator.init(allocator);
        fg_gen.generate(agg.getEntries(), trace_id, fg_path) catch |err| {
            try output.printError(try std.fmt.allocPrint(allocator, "Failed to generate flame graph: {}", .{err}));
            return;
        };
        const fg_msg = try std.fmt.allocPrint(allocator, "Flame graph data saved to: {s}", .{fg_path});
        try output.printInfo(fg_msg);
        allocator.free(fg_msg);
    }

    if (show_stats) {
        var fg_gen = FlameGraphGenerator.init(allocator);
        fg_gen.generatePerServiceStats(agg.getEntries(), trace_id) catch {};
    }
}
