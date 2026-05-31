local bucket_key = KEYS[1]
local default_capacity = tonumber(ARGV[1])
local default_rate = tonumber(ARGV[2])
local current_time = tonumber(ARGV[3])
local stream_key = ARGV[4]
local user_id = ARGV[5]

local config_key = bucket_key .. ":config"
local last_refill_key = bucket_key .. ":last_refill"
local tokens_key = bucket_key .. ":tokens"

local capacity = default_capacity
local rate = default_rate

local config_exists = redis.call("EXISTS", config_key)
if config_exists == 1 then
    local config_capacity = redis.call("HGET", config_key, "capacity")
    local config_rate = redis.call("HGET", config_key, "rate")
    if config_capacity ~= false then
        capacity = tonumber(config_capacity)
    end
    if config_rate ~= false then
        rate = tonumber(config_rate)
    end
end

local last_refill = redis.call("GET", last_refill_key)
local tokens = redis.call("GET", tokens_key)

if last_refill == false then
    last_refill = current_time
    tokens = capacity
else
    last_refill = tonumber(last_refill)
    tokens = tonumber(tokens)
    local delta = current_time - last_refill
    local new_tokens = delta * rate / 1000
    tokens = math.min(capacity, tokens + new_tokens)
    last_refill = current_time
end

if tokens >= 1 then
    tokens = tokens - 1
    redis.call("SET", tokens_key, tokens)
    redis.call("SET", last_refill_key, last_refill)
    redis.call("EXPIRE", tokens_key, 86400)
    redis.call("EXPIRE", last_refill_key, 86400)
    return 1
else
    redis.call("SET", tokens_key, tokens)
    redis.call("SET", last_refill_key, last_refill)
    redis.call("EXPIRE", tokens_key, 86400)
    redis.call("EXPIRE", last_refill_key, 86400)
    
    redis.call("XADD", stream_key, "*", "user_id", user_id, "timestamp", current_time)
    redis.call("EXPIRE", stream_key, 86400)
    
    return 0
end
