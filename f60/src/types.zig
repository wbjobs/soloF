const std = @import("std");

pub const ServiceConfig = struct {
    name: []const u8,
    host: []const u8,
    user: []const u8,
    log_path: []const u8,
    port: u16 = 22,
    color: []const u8 = "cyan",
};

pub const LogEntry = struct {
    timestamp_ms: i64,
    timestamp: i64,
    service: []const u8,
    trace_id: []const u8,
    level: []const u8,
    message: []const u8,
    raw: []const u8,
    color: []const u8,
    duration_ms: ?i64 = null,

    pub fn deinit(self: *LogEntry, allocator: std.mem.Allocator) void {
        allocator.free(self.service);
        allocator.free(self.trace_id);
        allocator.free(self.level);
        allocator.free(self.message);
        allocator.free(self.raw);
        allocator.free(self.color);
    }
};

pub const Config = struct {
    services: std.ArrayList(ServiceConfig),
    trace_id: ?[]const u8 = null,
    follow: bool = false,
    lines: u32 = 100,
    since: ?[]const u8 = null,
    until: ?[]const u8 = null,
    flame_graph_output: ?[]const u8 = null,

    pub fn init(allocator: std.mem.Allocator) Config {
        return .{
            .services = std.ArrayList(ServiceConfig).init(allocator),
        };
    }

    pub fn deinit(self: *Config) void {
        const allocator = self.services.allocator;
        for (self.services.items) |svc| {
            allocator.free(svc.name);
            allocator.free(svc.host);
            allocator.free(svc.user);
            allocator.free(svc.log_path);
            allocator.free(svc.color);
        }
        self.services.deinit();
        if (self.trace_id) |tid| allocator.free(tid);
        if (self.since) |s| allocator.free(s);
        if (self.until) |u| allocator.free(u);
        if (self.flame_graph_output) |fg| allocator.free(fg);
    }
};
