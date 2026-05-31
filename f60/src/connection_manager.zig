const std = @import("std");
const types = @import("types.zig");
const ssh_reader = @import("ssh_reader.zig");
const ServiceConfig = types.ServiceConfig;
const SshReader = ssh_reader.SshReader;

pub const ConnectionManager = struct {
    allocator: std.mem.Allocator,
    readers: std.ArrayList(*SshReader),
    max_connections: usize = 50,

    pub fn init(allocator: std.mem.Allocator) ConnectionManager {
        return .{
            .allocator = allocator,
            .readers = std.ArrayList(*SshReader).init(allocator),
        };
    }

    pub fn deinit(self: *ConnectionManager) void {
        for (self.readers.items) |reader| {
            reader.stop();
            self.allocator.destroy(reader);
        }
        self.readers.deinit();
    }

    pub fn createConnection(self: *ConnectionManager, service: ServiceConfig) !*SshReader {
        if (self.readers.items.len >= self.max_connections) {
            return error.TooManyConnections;
        }

        const reader = try self.allocator.create(SshReader);
        reader.* = SshReader.init(self.allocator, service);

        try self.readers.append(reader);
        return reader;
    }

    pub fn removeConnection(self: *ConnectionManager, reader: *SshReader) void {
        const idx = std.mem.indexOfScalar(*SshReader, self.readers.items, reader) orelse return;
        reader.stop();
        self.allocator.destroy(reader);
        _ = self.readers.orderedRemove(idx);
    }

    pub fn stopAll(self: *ConnectionManager) void {
        for (self.readers.items) |reader| {
            reader.stop();
        }
    }

    pub fn activeCount(self: *ConnectionManager) usize {
        var count: usize = 0;
        for (self.readers.items) |reader| {
            if (reader.is_running) count += 1;
        }
        return count;
    }

    pub fn cleanupDead(self: *ConnectionManager) usize {
        var removed: usize = 0;
        var i: usize = 0;
        while (i < self.readers.items.len) {
            const reader = self.readers.items[i];
            if (!reader.is_running) {
                reader.stop();
                self.allocator.destroy(reader);
                _ = self.readers.orderedRemove(i);
                removed += 1;
            } else {
                i += 1;
            }
        }
        return removed;
    }
};
