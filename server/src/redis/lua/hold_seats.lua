-- KEYS_COUNT: 4
-- Atomic seat hold script
-- KEYS[1] = show:{showId}:seats
-- KEYS[2] = hold:{holdId}
-- KEYS[3] = user:{userId}:holds:{showId}
-- KEYS[4] = show:{showId}:holds:expiry
-- ARGV[1] = holdId
-- ARGV[2] = userId
-- ARGV[3] = showId
-- ARGV[4] = ttlSeconds
-- ARGV[5] = expiresAtEpochMs
-- ARGV[6] = seatsJson
-- ARGV[7] = maxSeats
-- ARGV[8...] = seatIds

local seatsKey = KEYS[1]
local holdKey = KEYS[2]
local userHoldsKey = KEYS[3]
local expiryKey = KEYS[4]

local holdId = ARGV[1]
local userId = ARGV[2]
local showId = ARGV[3]
local ttlSeconds = tonumber(ARGV[4])
local expiresAtEpochMs = tonumber(ARGV[5])
local seatsJson = ARGV[6]
local maxSeats = tonumber(ARGV[7])

local seatCount = #ARGV - 7
if seatCount <= 0 then
  return { 0, 'NO_SEATS_SPECIFIED' }
end

if seatCount > maxSeats then
  return { 0, 'MAX_SEATS_EXCEEDED' }
end

-- 1. Check all seats are AVAILABLE
local unavailable = {}
for i = 8, #ARGV do
  local seatId = ARGV[i]
  local status = redis.call('HGET', seatsKey, seatId)
  if status ~= 'AVAILABLE' then
    table.insert(unavailable, seatId)
  end
end

if #unavailable > 0 then
  return { 0, 'SEATS_UNAVAILABLE', cjson.encode(unavailable) }
end

-- 2. Mark all seats as HELD and write hold keys
for i = 8, #ARGV do
  local seatId = ARGV[i]
  redis.call('HSET', seatsKey, seatId, 'HELD')
  local seatHoldKey = 'show:' .. showId .. ':hold:' .. seatId
  redis.call('SET', seatHoldKey, holdId .. '|' .. userId, 'EX', ttlSeconds)
end

-- 3. Write hold hash metadata
redis.call('HSET', holdKey,
  'holdId', holdId,
  'userId', userId,
  'showId', showId,
  'seats', seatsJson,
  'expiresAt', tostring(expiresAtEpochMs),
  'status', 'HELD'
)
-- Keep hold key slightly longer than TTL so expired holds can still be inspected
redis.call('EXPIRE', holdKey, ttlSeconds + 60)

-- 4. Track user hold and schedule expiry sweeper score
redis.call('SADD', userHoldsKey, holdId)
redis.call('ZADD', expiryKey, expiresAtEpochMs, holdId)

return { 1, 'OK' }
