const std = @import("std");
const types = @import("types.zig");
const LogEntry = types.LogEntry;

const Color = enum {
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    bright_black,
    bright_red,
    bright_green,
    bright_yellow,
    bright_blue,
    bright_magenta,
    bright_cyan,
    bright_white,
    reset,
};

const LevelColor = enum {
    debug,
    info,
    warn,
    error,
    fatal,
    trace,
};

pub const ColorOutput = struct {
    allocator: std.mem.Allocator,
    use_color: bool,
    writer: std.fs.File.Writer,

    pub fn init(allocator: std.mem.Allocator, writer: std.fs.File.Writer) ColorOutput {
        const use_color = std.io.tty.detectConfig(writer) != .no_color;
        return .{
            .allocator = allocator,
            .use_color = use_color,
            .writer = writer,
        };
    }

    fn getColorCode(color: []const u8) []const u8 {
        const lower = blk: {
            var buf: [32]u8 = undefined;
            for (color, 0..) |c, i| {
                if (i >= buf.len) break;
                buf[i] = std.ascii.toLower(c);
            }
            break :blk buf[0..@min(color.len, buf.len)];
        };

        if (std.mem.eql(u8, lower, "black")) return "\x1b[30m";
        if (std.mem.eql(u8, lower, "red")) return "\x1b[31m";
        if (std.mem.eql(u8, lower, "green")) return "\x1b[32m";
        if (std.mem.eql(u8, lower, "yellow")) return "\x1b[33m";
        if (std.mem.eql(u8, lower, "blue")) return "\x1b[34m";
        if (std.mem.eql(u8, lower, "magenta")) return "\x1b[35m";
        if (std.mem.eql(u8, lower, "cyan")) return "\x1b[36m";
        if (std.mem.eql(u8, lower, "white")) return "\x1b[37m";
        if (std.mem.eql(u8, lower, "bright_black")) return "\x1b[90m";
        if (std.mem.eql(u8, lower, "bright_red")) return "\x1b[91m";
        if (std.mem.eql(u8, lower, "bright_green")) return "\x1b[92m";
        if (std.mem.eql(u8, lower, "bright_yellow")) return "\x1b[93m";
        if (std.mem.eql(u8, lower, "bright_blue")) return "\x1b[94m";
        if (std.mem.eql(u8, lower, "bright_magenta")) return "\x1b[95m";
        if (std.mem.eql(u8, lower, "bright_cyan")) return "\x1b[96m";
        if (std.mem.eql(u8, lower, "bright_white")) return "\x1b[97m";
        return "\x1b[36m";
    }

    fn getLevelColor(level: []const u8) []const u8 {
        const lower = blk: {
            var buf: [16]u8 = undefined;
            for (level, 0..) |c, i| {
                if (i >= buf.len) break;
                buf[i] = std.ascii.toLower(c);
            }
            break :blk buf[0..@min(level.len, buf.len)];
        };

        if (std.mem.eql(u8, lower, "debug")) return "\x1b[36m";
        if (std.mem.eql(u8, lower, "info")) return "\x1b[32m";
        if (std.mem.eql(u8, lower, "warn") or std.mem.eql(u8, lower, "warning")) return "\x1b[33m";
        if (std.mem.eql(u8, lower, "error")) return "\x1b[31m";
        if (std.mem.eql(u8, lower, "fatal")) return "\x1b[91m";
        if (std.mem.eql(u8, lower, "trace")) return "\x1b[35m";
        return "\x1b[37m";
    }

    fn resetColor() []const u8 {
        return "\x1b[0m";
    }

    fn formatTimestamp(allocator: std.mem.Allocator, timestamp_ms: i64) ![]u8 {
        const timestamp = @divTrunc(timestamp_ms, 1000);
        const ms = @mod(timestamp_ms, 1000);
        const epoch_seconds = @as(u64, @intCast(timestamp));
        const epoch = std.time.epoch.EpochSeconds{ .secs = epoch_seconds };
        const day_seconds = epoch.getDaySeconds();
        const year_day = epoch.getEpochDay().calculateYearDay();
        const month_day = year_day.calculateMonthDay();

        var buf: [32]u8 = undefined;
        const formatted = try std.fmt.bufPrint(&buf, "{d:0>4}-{d:0>2}-{d:0>2} {d:0>2}:{d:0>2}:{d:0>2}.{d:0>3}", .{
            year_day.year,
            @intFromEnum(month_day.month) + 1,
            month_day.day,
            day_seconds.getHours(),
            day_seconds.getMinutes(),
            day_seconds.getSeconds(),
            @as(u32, @intCast(ms)),
        });

        return allocator.dupe(u8, formatted);
    }

    pub fn printEntry(self: *ColorOutput, entry: LogEntry) !void {
        if (self.use_color) {
            const ts = try formatTimestamp(self.allocator, entry.timestamp_ms);
            defer self.allocator.free(ts);

            const service_color = getColorCode(entry.color);
            const level_color = getLevelColor(entry.level);
            const reset = resetColor();

            try self.writer.print("{s}[{s}]{s} {s}{s:<8}{s} {s}{s:<10}{s} {s}{s}{s} {s}\n", .{
                "\x1b[90m", ts, reset,
                level_color, entry.level, reset,
                service_color, entry.service, reset,
                if (entry.trace_id.len > 0) "\x1b[95m" else "",
                if (entry.trace_id.len > 0) entry.trace_id else "",
                if (entry.trace_id.len > 0) reset else "",
                entry.message,
            });
        } else {
            const ts = try formatTimestamp(self.allocator, entry.timestamp_ms);
            defer self.allocator.free(ts);

            try self.writer.print("[{s}] {s:<8} {s:<10} {s} {s}\n", .{
                ts,
                entry.level,
                entry.service,
                if (entry.trace_id.len > 0) entry.trace_id else "-",
                entry.message,
            });
        }
    }

    pub fn printHeader(self: *ColorOutput, trace_id: ?[]const u8, services: []const types.ServiceConfig) !void {
        if (trace_id) |tid| {
            if (self.use_color) {
                try self.writer.print("{s}╔══════════════════════════════════════════════════════════════════════════╗{s}\n", .{ "\x1b[94m", resetColor() });
                try self.writer.print("{s}║{s} Trace-ID: {s}{s}{s}\n", .{ "\x1b[94m", resetColor(), "\x1b[95m", tid, resetColor() });
                try self.writer.print("{s}╠══════════════════════════════════════════════════════════════════════════╣{s}\n", .{ "\x1b[94m", resetColor() });
            } else {
                try self.writer.print("==========================================================================\n", .{});
                try self.writer.print("Trace-ID: {s}\n", .{tid});
                try self.writer.print("==========================================================================\n", .{});
            }
        }

        if (services.len > 0) {
            try self.writer.print("Services: ", .{});
            for (services, 0..) |svc, i| {
                if (i > 0) try self.writer.print(", ", .{});
                if (self.use_color) {
                    try self.writer.print("{s}{s}{s}", .{ getColorCode(svc.color), svc.name, resetColor() });
                } else {
                    try self.writer.print("{s}", .{svc.name});
                }
            }
            try self.writer.print("\n", .{});
            if (!self.use_color) {
                try self.writer.print("--------------------------------------------------------------------------\n", .{});
            }
        }
    }

    pub fn printStats(self: *ColorOutput, total: usize, filtered: usize, services: usize) !void {
        if (self.use_color) {
            try self.writer.print("{s}╠══════════════════════════════════════════════════════════════════════════╣{s}\n", .{ "\x1b[94m", resetColor() });
            try self.writer.print("{s}║{s} Total: {s}{d}{s} | Filtered: {s}{d}{s} | Services: {s}{d}{s}\n", .{
                "\x1b[94m", resetColor(),
                "\x1b[32m", total, resetColor(),
                "\x1b[33m", filtered, resetColor(),
                "\x1b[36m", services, resetColor(),
            });
            try self.writer.print("{s}╚══════════════════════════════════════════════════════════════════════════╝{s}\n", .{ "\x1b[94m", resetColor() });
        } else {
            try self.writer.print("--------------------------------------------------------------------------\n", .{});
            try self.writer.print("Total: {} | Filtered: {} | Services: {}\n", .{ total, filtered, services });
            try self.writer.print("==========================================================================\n", .{});
        }
    }

    pub fn printError(self: *ColorOutput, message: []const u8) !void {
        if (self.use_color) {
            try self.writer.print("{s}ERROR: {s}{s}\n", .{ "\x1b[91m", message, resetColor() });
        } else {
            try self.writer.print("ERROR: {s}\n", .{message});
        }
    }

    pub fn printInfo(self: *ColorOutput, message: []const u8) !void {
        if (self.use_color) {
            try self.writer.print("{s}INFO: {s}{s}\n", .{ "\x1b[36m", message, resetColor() });
        } else {
            try self.writer.print("INFO: {s}\n", .{message});
        }
    }
};
