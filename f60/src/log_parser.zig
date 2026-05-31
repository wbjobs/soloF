const std = @import("std");
const types = @import("types.zig");
const LogEntry = types.LogEntry;

pub const LogParser = struct {
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) LogParser {
        return .{ .allocator = allocator };
    }

    pub fn parse(self: *LogParser, line: []const u8, service_name: []const u8, color: []const u8) ?LogEntry {
        if (line.len == 0) return null;

        const trace_id = self.extractTraceId(line) orelse "";
        const ts_ms = self.parseTimestampMs(line) orelse std.time.timestamp() * 1000;
        const level = self.extractLevel(line);
        const message = self.extractMessage(line);

        return LogEntry{
            .timestamp_ms = ts_ms,
            .timestamp = @divTrunc(ts_ms, 1000),
            .service = self.allocator.dupe(u8, service_name) catch return null,
            .trace_id = self.allocator.dupe(u8, trace_id) catch return null,
            .level = self.allocator.dupe(u8, level) catch return null,
            .message = self.allocator.dupe(u8, message) catch return null,
            .raw = self.allocator.dupe(u8, line) catch return null,
            .color = self.allocator.dupe(u8, color) catch return null,
            .duration_ms = self.extractDuration(line),
        };
    }

    fn extractTraceId(self: *LogParser, line: []const u8) ?[]const u8 {
        _ = self;
        const patterns = [_][]const u8{
            "trace_id=",
            "traceId=",
            "X-B3-TraceId:",
            "trace_id:",
            "tid=",
            "\"trace_id\":\"",
            "\"traceId\":\"",
        };

        for (patterns) |pattern| {
            if (std.mem.indexOf(u8, line, pattern)) |idx| {
                const start = idx + pattern.len;
                var end = start;
                while (end < line.len and line[end] != '"' and line[end] != ' ' and line[end] != ',' and line[end] != '}' and line[end] != '\n') {
                    end += 1;
                }
                if (end > start) {
                    return line[start..end];
                }
            }
        }

        var i: usize = 0;
        while (i + 16 <= line.len) : (i += 1) {
            if (self.isHexString(line[i .. i + 32])) {
                return line[i .. i + 32];
            }
            if (self.isHexString(line[i .. i + 16])) {
                return line[i .. i + 16];
            }
        }

        return null;
    }

    fn extractDuration(self: *LogParser, line: []const u8) ?i64 {
        _ = self;
        const patterns = [_][]const u8{
            "duration=",
            "duration_ms=",
            "latency=",
            "took=",
            "elapsed=",
            "time=",
        };

        for (patterns) |pattern| {
            if (std.mem.indexOf(u8, line, pattern)) |idx| {
                const start = idx + pattern.len;
                var end = start;
                while (end < line.len and (std.ascii.isDigit(line[end]) or line[end] == '.')) : (end += 1) {}
                if (end > start) {
                    const num_str = line[start..end];
                    if (std.mem.indexOfScalar(u8, num_str, '.')) |_| {
                        const val = std.fmt.parseFloat(f64, num_str) catch return null;
                        return @intFromFloat(val * 1000);
                    } else {
                        const val = std.fmt.parseInt(i64, num_str, 10) catch return null;
                        return val;
                    }
                }
            }
        }

        return null;
    }

    fn isHexString(self: *LogParser, s: []const u8) bool {
        _ = self;
        if (s.len < 8) return false;
        for (s) |c| {
            if (!std.ascii.isXDigit(c)) return false;
        }
        return true;
    }

    fn parseTimestampMs(self: *LogParser, line: []const u8) ?i64 {
        _ = self;
        var start_idx: usize = 0;

        while (start_idx < line.len) : (start_idx += 1) {
            if (line[start_idx] == '2' and start_idx + 1 < line.len and line[start_idx + 1] == '0') {
                break;
            }
        }

        if (start_idx >= line.len) return null;

        var end_idx = start_idx;
        while (end_idx < line.len and end_idx - start_idx < 40 and line[end_idx] != ' ' and line[end_idx] != '\t' and line[end_idx] != '"') {
            end_idx += 1;
        }

        if (end_idx <= start_idx) return null;

        const ts_str = line[start_idx..end_idx];
        return self.parseIsoTimestampMs(ts_str);
    }

    fn parseIsoTimestampMs(self: *LogParser, ts: []const u8) ?i64 {
        _ = self;
        var year: i32 = 2020;
        var month: u8 = 1;
        var day: u8 = 1;
        var hour: u8 = 0;
        var minute: u8 = 0;
        var second: u8 = 0;
        var millisecond: u16 = 0;

        var idx: usize = 0;

        if (ts.len >= 4) {
            year = std.fmt.parseInt(i32, ts[0..4], 10) catch 2020;
            idx = 4;
        }

        if (idx < ts.len and (ts[idx] == '-' or ts[idx] == '/')) idx += 1;
        if (idx + 2 <= ts.len) {
            month = std.fmt.parseInt(u8, ts[idx .. idx + 2], 10) catch 1;
            idx += 2;
        }

        if (idx < ts.len and (ts[idx] == '-' or ts[idx] == '/')) idx += 1;
        if (idx + 2 <= ts.len) {
            day = std.fmt.parseInt(u8, ts[idx .. idx + 2], 10) catch 1;
            idx += 2;
        }

        if (idx < ts.len and (ts[idx] == 'T' or ts[idx] == ' ')) idx += 1;
        if (idx + 2 <= ts.len) {
            hour = std.fmt.parseInt(u8, ts[idx .. idx + 2], 10) catch 0;
            idx += 2;
        }

        if (idx < ts.len and ts[idx] == ':') idx += 1;
        if (idx + 2 <= ts.len) {
            minute = std.fmt.parseInt(u8, ts[idx .. idx + 2], 10) catch 0;
            idx += 2;
        }

        if (idx < ts.len and ts[idx] == ':') idx += 1;
        if (idx + 2 <= ts.len) {
            second = std.fmt.parseInt(u8, ts[idx .. idx + 2], 10) catch 0;
            idx += 2;
        }

        if (idx < ts.len and (ts[idx] == '.' or ts[idx] == ',')) {
            idx += 1;
            var ms_end = idx;
            while (ms_end < ts.len and std.ascii.isDigit(ts[ms_end])) : (ms_end += 1) {}
            if (ms_end > idx) {
                const ms_len = @min(ms_end - idx, 3);
                const ms_str = ts[idx .. idx + ms_len];
                var ms_val = std.fmt.parseInt(u16, ms_str, 10) catch 0;
                if (ms_len == 1) ms_val *= 100;
                if (ms_len == 2) ms_val *= 10;
                millisecond = ms_val;
            }
        }

        const days_since_epoch = self.daysSinceEpoch(year, month, day);
        const seconds = days_since_epoch * 86400 + @as(i64, hour) * 3600 + @as(i64, minute) * 60 + second;
        return seconds * 1000 + millisecond;
    }

    fn daysSinceEpoch(self: *LogParser, year: i32, month: u8, day: u8) i64 {
        _ = self;
        var y = year;
        var m = month;

        if (m <= 2) {
            y -= 1;
            m += 12;
        }

        const era: i64 = @divFloor(y - 1, 400);
        const yoe: i64 = y - 1 - era * 400;
        const doy: i64 = @divFloor(153 * (m - 3) + 2, 5) + day - 1;
        const doe: i64 = yoe * 365 + @divFloor(yoe, 4) - @divFloor(yoe, 100) + doy;

        return era * 146097 + doe - 719468;
    }

    fn extractLevel(self: *LogParser, line: []const u8) []const u8 {
        _ = self;
        const levels = [_][]const u8{ "DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL", "TRACE" };
        for (levels) |lvl| {
            if (std.mem.indexOf(u8, line, lvl)) |_| {
                return lvl;
            }
            const lower = blk: {
                var buf: [16]u8 = undefined;
                for (lvl, 0..) |c, i| {
                    buf[i] = std.ascii.toLower(c);
                }
                break :blk buf[0..lvl.len];
            };
            if (std.mem.indexOf(u8, line, lower)) |_| {
                return lvl;
            }
        }
        return "INFO";
    }

    fn extractMessage(self: *LogParser, line: []const u8) []const u8 {
        _ = self;
        if (std.mem.indexOf(u8, line, "message\":\"")) |idx| {
            const start = idx + "message\":\"".len;
            var end = start;
            while (end < line.len and line[end] != '"') : (end += 1) {}
            return line[start..end];
        }
        if (std.mem.indexOf(u8, line, "msg\":\"")) |idx| {
            const start = idx + "msg\":\"".len;
            var end = start;
            while (end < line.len and line[end] != '"') : (end += 1) {}
            return line[start..end];
        }
        return line;
    }

    pub fn filterByTraceId(self: *LogParser, entries: std.ArrayList(LogEntry), trace_id: []const u8) std.ArrayList(LogEntry) {
        _ = self;
        var filtered = std.ArrayList(LogEntry).init(entries.allocator);
        for (entries.items) |entry| {
            if (std.mem.eql(u8, entry.trace_id, trace_id)) {
                filtered.append(entry) catch {};
            }
        }
        return filtered;
    }
};
