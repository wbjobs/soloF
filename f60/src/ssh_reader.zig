const std = @import("std");
const types = @import("types.zig");
const ServiceConfig = types.ServiceConfig;

pub const SshReader = struct {
    allocator: std.mem.Allocator,
    service: ServiceConfig,
    child: ?std.ChildProcess = null,
    stdout: ?std.fs.File.Reader = null,
    stderr: ?std.fs.File.Reader = null,
    is_running: bool = false,
    stderr_buf: [1024]u8 = undefined,

    pub fn init(allocator: std.mem.Allocator, service: ServiceConfig) SshReader {
        return .{
            .allocator = allocator,
            .service = service,
        };
    }

    pub fn start(self: *SshReader, follow: bool, lines: u32) !void {
        if (self.is_running) {
            self.stop();
        }

        var args = std.ArrayList([]const u8).init(self.allocator);
        defer args.deinit();

        try args.append("ssh");
        try args.append("-o");
        try args.append("ConnectTimeout=10");
        try args.append("-o");
        try args.append("ServerAliveInterval=30");
        try args.append("-o");
        try args.append("ServerAliveCountMax=3");
        try args.append("-o");
        try args.append("StrictHostKeyChecking=no");
        try args.append("-o");
        try args.append("UserKnownHostsFile=/dev/null");
        try args.append("-o");
        try args.append("LogLevel=ERROR");
        try args.append("-o");
        try args.append("BatchMode=yes");

        const port_arg = try std.fmt.allocPrint(self.allocator, "-p{}", .{self.service.port});
        defer self.allocator.free(port_arg);
        try args.append(port_arg);

        const host_arg = try std.fmt.allocPrint(self.allocator, "{s}@{s}", .{ self.service.user, self.service.host });
        defer self.allocator.free(host_arg);
        try args.append(host_arg);

        var cmd_buf: [2048]u8 = undefined;
        const tail_cmd = if (follow)
            try std.fmt.bufPrint(&cmd_buf, "tail -n {} -F {}", .{ lines, self.service.log_path })
        else
            try std.fmt.bufPrint(&cmd_buf, "tail -n {} {}", .{ lines, self.service.log_path });

        try args.append(tail_cmd);

        const child = try std.ChildProcess.init(args.items, self.allocator);
        child.stdout_behavior = .Pipe;
        child.stderr_behavior = .Pipe;
        child.stdin_behavior = .Ignore;

        try child.spawn();

        self.child = child;
        self.stdout = if (child.stdout) |f| f.reader() else null;
        self.stderr = if (child.stderr) |f| f.reader() else null;
        self.is_running = true;
    }

    pub fn readLine(self: *SshReader, buf: []u8) !?[]u8 {
        if (!self.is_running) return null;
        if (self.stdout) |reader| {
            const line = reader.readUntilDelimiterOrEof(buf, '\n') catch |err| {
                if (err == error.EndOfStream) {
                    self.is_running = false;
                    return null;
                }
                self.is_running = false;
                return err;
            };
            if (line == null) {
                self.is_running = false;
            }
            return line;
        }
        return null;
    }

    pub fn drainStderr(self: *SshReader) void {
        if (self.stderr) |reader| {
            while (true) {
                reader.readUntilDelimiterOrEof(&self.stderr_buf, '\n') catch break;
            }
        }
    }

    pub fn stop(self: *SshReader) void {
        if (!self.is_running and self.child == null) return;

        if (self.child) |*child| {
            child.kill() catch {};
            std.time.sleep(10 * std.time.ns_per_ms);
            child.wait() catch {};
            child.deinit();
            self.child = null;
        }

        self.stdout = null;
        self.stderr = null;
        self.is_running = false;
    }

    pub fn checkAlive(self: *SshReader) bool {
        return self.is_running;
    }
};
