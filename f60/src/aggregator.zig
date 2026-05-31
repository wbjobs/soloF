const std = @import("std");
const types = @import("types.zig");
const LogEntry = types.LogEntry;

pub const LogAggregator = struct {
    allocator: std.mem.Allocator,
    entries: std.ArrayList(LogEntry),

    pub fn init(allocator: std.mem.Allocator) LogAggregator {
        return .{
            .allocator = allocator,
            .entries = std.ArrayList(LogEntry).init(allocator),
        };
    }

    pub fn deinit(self: *LogAggregator) void {
        for (self.entries.items) |*entry| {
            entry.deinit(self.allocator);
        }
        self.entries.deinit();
    }

    pub fn addEntry(self: *LogAggregator, entry: LogEntry) !void {
        try self.entries.append(entry);
    }

    pub fn sortByTimestamp(self: *LogAggregator) void {
        std.mem.sort(LogEntry, self.entries.items, {}, compareByTimestamp);
    }

    fn compareByTimestamp(_: void, a: LogEntry, b: LogEntry) bool {
        return a.timestamp_ms < b.timestamp_ms;
    }

    pub fn filterByTraceId(self: *LogAggregator, trace_id: []const u8) std.ArrayList(LogEntry) {
        var filtered = std.ArrayList(LogEntry).init(self.allocator);
        for (self.entries.items) |entry| {
            if (std.mem.eql(u8, entry.trace_id, trace_id)) {
                const dup = self.dupeEntry(entry) catch continue;
                filtered.append(dup) catch {};
            }
        }
        return filtered;
    }

    fn dupeEntry(self: *LogAggregator, entry: LogEntry) !LogEntry {
        return LogEntry{
            .timestamp = entry.timestamp,
            .service = try self.allocator.dupe(u8, entry.service),
            .trace_id = try self.allocator.dupe(u8, entry.trace_id),
            .level = try self.allocator.dupe(u8, entry.level),
            .message = try self.allocator.dupe(u8, entry.message),
            .raw = try self.allocator.dupe(u8, entry.raw),
            .color = try self.allocator.dupe(u8, entry.color),
        };
    }

    pub fn getEntries(self: *LogAggregator) []const LogEntry {
        return self.entries.items;
    }

    pub fn len(self: *LogAggregator) usize {
        return self.entries.items.len;
    }
};
