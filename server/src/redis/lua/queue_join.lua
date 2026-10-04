-- KEYS_COUNT: 2
-- Join waiting room queue
-- KEYS[1] = show:{showId}:queue
-- KEYS[2] = show:{showId}:admitted
-- ARGV[1] = userId
-- ARGV[2] = nowMs

local queueKey = KEYS[1]
local admittedKey = KEYS[2]
local userId = ARGV[1]
local nowMs = tonumber(ARGV[2])

-- Check if already admitted
local admittedScore = redis.call('ZSCORE', admittedKey, userId)
if admittedScore and tonumber(admittedScore) > nowMs then
  return { 'ADMITTED', 0 }
end

-- Add to queue if not present
local existingScore = redis.call('ZSCORE', queueKey, userId)
if not existingScore then
  redis.call('ZADD', queueKey, nowMs, userId)
end

local rank = redis.call('ZRANK', queueKey, userId)
return { 'QUEUED', (rank or 0) + 1 }
