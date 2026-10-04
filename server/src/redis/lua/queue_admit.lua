-- KEYS_COUNT: 2
-- Admit batch of users from waiting room queue
-- KEYS[1] = show:{showId}:queue
-- KEYS[2] = show:{showId}:admitted
-- ARGV[1] = batchSize
-- ARGV[2] = admitWindowMs
-- ARGV[3] = nowMs

local queueKey = KEYS[1]
local admittedKey = KEYS[2]
local batchSize = tonumber(ARGV[1])
local admitWindowMs = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])

-- Remove expired admitted users first
redis.call('ZREMRANGEBYSCORE', admittedKey, 0, nowMs)

-- Pop next batch from queue
local users = redis.call('ZRANGE', queueKey, 0, batchSize - 1)
local admitted = {}

local expireScore = nowMs + admitWindowMs
for _, userId in ipairs(users) do
  redis.call('ZADD', admittedKey, expireScore, userId)
  redis.call('ZREM', queueKey, userId)
  table.insert(admitted, userId)
end

return cjson.encode(admitted)
