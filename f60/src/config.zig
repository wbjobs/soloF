const std = @import("std");
const types = @import("types.zig");
const Config = types.Config;
const ServiceConfig = types.ServiceConfig;

pub const ConfigLoader = struct {
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) ConfigLoader {
        return .{ .allocator = allocator };
    }

    pub fn loadFromFile(self: *ConfigLoader, path: []const u8) !Config {
        const file = try std.fs.cwd().openFile(path, .{});
        defer file.close();

        const content = try file.readToEndAlloc(self.allocator, 1024 * 1024);
        defer self.allocator.free(content);

        return self.parseJson(content);
    }

    fn parseJson(self: *ConfigLoader, content: []const u8) !Config {
        var config = Config.init(self.allocator);
        errdefer config.deinit();

        var parsed = try std.json.parseFromSlice(std.json.Value, self.allocator, content, .{});
        defer parsed.deinit();

        const root = parsed.value;

        if (root == .object) {
            const services = root.object.get("services") orelse return error.MissingServices;
            if (services == .array) {
                for (services.array.items) |svc_val| {
                    if (svc_val == .object) {
                        const svc_obj = svc_val.object;
                        const name = try self.getString(svc_obj, "name");
                        const host = try self.getString(svc_obj, "host");
                        const user = try self.getString(svc_obj, "user");
                        const log_path = try self.getString(svc_obj, "log_path");
                        const port = self.getNumber(svc_obj, "port") orelse 22;
                        const color = self.getString(svc_obj, "color") catch "cyan";

                        const service = ServiceConfig{
                            .name = try self.allocator.dupe(u8, name),
                            .host = try self.allocator.dupe(u8, host),
                            .user = try self.allocator.dupe(u8, user),
                            .log_path = try self.allocator.dupe(u8, log_path),
                            .port = @intCast(port),
                            .color = try self.allocator.dupe(u8, color),
                        };

                        try config.services.append(service);
                    }
                }
            }
        }

        return config;
    }

    fn getString(self: *ConfigLoader, obj: std.json.ObjectMap, key: []const u8) ![]const u8 {
        _ = self;
        const val = obj.get(key) orelse return error.MissingKey;
        if (val == .string) return val.string;
        return error.InvalidType;
    }

    fn getNumber(self: *ConfigLoader, obj: std.json.ObjectMap, key: []const u8) ?i64 {
        _ = self;
        const val = obj.get(key) orelse return null;
        if (val == .integer) return val.integer;
        if (val == .float) return @intFromFloat(val.float);
        return null;
    }
};
