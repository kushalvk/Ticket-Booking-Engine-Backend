-- KEYS_COUNT: 1
-- Sliding window rate limiter
-- KEYS[1] = ratelimit:{scope}:{id}
-- ARGV[1] = windowMs
-- ARGV[2] = maxHits
-- ARGV[3] = nowMs
-- ARGV[4] = memberId

local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local maxHits = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local memberId = ARGV[4]

local clearBefore = nowMs - windowMs
redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)

local currentHits = redis.call('ZCARD', key)

if currentHits < maxHits then
  redis.call('ZADD', key, nowMs, memberId)
  redis.call('PEXPIRE', key, windowMs)
  return { 1, maxHits - currentHits - 1 }
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetMs = windowMs
  if oldest and #oldest >= 2 then
    resetMs = math.max(0, (tonumber(oldest[2]) + windowMs) - nowMs)
  end
  return { 0, 0, resetMs }
end
