-- Dynamic keys: 4 base keys + N seat hold keys
-- KEYS[1] = show:{showId}:seats (seatsHash)
-- KEYS[2] = show:{showId}:holds:expiry (expiryZset)
-- KEYS[3] = hold:{holdId} (holdHash)
-- KEYS[4] = user:{userId}:holds:{showId} (userHoldsSet)
-- KEYS[4+i] = show:{showId}:hold:{seatId_i}
--
-- ARGV[1] = showId
-- ARGV[2] = userId
-- ARGV[3] = holdId
-- ARGV[4] = ttlSeconds
-- ARGV[5] = nowMs
-- ARGV[6] = maxSeats
-- ARGV[7...] = seatIds...

local seatsHash = KEYS[1]
local expiryZset = KEYS[2]
local holdHash = KEYS[3]
local userHoldsSet = KEYS[4]

local showId = ARGV[1]
local userId = ARGV[2]
local holdId = ARGV[3]
local ttlSeconds = tonumber(ARGV[4])
local nowMs = tonumber(ARGV[5])
local maxSeats = tonumber(ARGV[6])

local seatCount = #ARGV - 6
if seatCount <= 0 then
  return cjson.encode({ ok = false, err = 'TOO_MANY_SEATS', message = 'No seats requested' })
end

if seatCount > maxSeats then
  return cjson.encode({
    ok = false,
    err = 'TOO_MANY_SEATS',
    current = 0,
    requested = seatCount,
    max = maxSeats
  })
end

-- 1. Validate user's existing active held seats count
local existingHoldIds = redis.call('SMEMBERS', userHoldsSet)
local userActiveSeats = 0

for _, existingHoldId in ipairs(existingHoldIds) do
  local existingHoldKey = 'hold:' .. existingHoldId
  local status = redis.call('HGET', existingHoldKey, 'status')
  local expiresAt = redis.call('HGET', existingHoldKey, 'expiresAt')

  if status == 'ACTIVE' and expiresAt and tonumber(expiresAt) > nowMs then
    local seatsJson = redis.call('HGET', existingHoldKey, 'seats')
    if seatsJson then
      local decoded = cjson.decode(seatsJson)
      userActiveSeats = userActiveSeats + #decoded
    end
  else
    -- Clean up inactive or expired hold reference
    redis.call('SREM', userHoldsSet, existingHoldId)
  end
end

if (userActiveSeats + seatCount) > maxSeats then
  return cjson.encode({
    ok = false,
    err = 'TOO_MANY_SEATS',
    current = userActiveSeats,
    requested = seatCount,
    max = maxSeats
  })
end

-- 2. Verify EVERY requested seat status is AVAILABLE (All-or-Nothing check)
local unavailable = {}
for i = 1, seatCount do
  local seatId = ARGV[6 + i]
  local status = redis.call('HGET', seatsHash, seatId)
  if status ~= 'AVAILABLE' then
    table.insert(unavailable, seatId)
  end
end

if #unavailable > 0 then
  return cjson.encode({
    ok = false,
    err = 'SEAT_UNAVAILABLE',
    seats = unavailable
  })
end

-- 3. Atomically transition seats to HELD and write all hold structures
local expiresAt = nowMs + (ttlSeconds * 1000)
local seatsTable = {}

for i = 1, seatCount do
  local seatId = ARGV[6 + i]
  table.insert(seatsTable, seatId)

  -- Mark seat HELD
  redis.call('HSET', seatsHash, seatId, 'HELD')

  -- Set individual seat hold key with value "holdId:userId" and exact TTL
  local seatHoldKey = KEYS[4 + i]
  redis.call('SET', seatHoldKey, holdId .. ':' .. userId, 'EX', ttlSeconds)
end

local seatsJson = cjson.encode(seatsTable)

-- Write hold metadata hash
redis.call('HSET', holdHash,
  'holdId', holdId,
  'userId', userId,
  'showId', showId,
  'seats', seatsJson,
  'expiresAt', tostring(expiresAt),
  'status', 'ACTIVE'
)
redis.call('EXPIRE', holdHash, ttlSeconds + 60)

-- Add holdId to user's active set and sweeper expiry zset
redis.call('SADD', userHoldsSet, holdId)
redis.call('ZADD', expiryZset, expiresAt, holdId)

return cjson.encode({
  ok = true,
  holdId = holdId,
  expiresAt = expiresAt,
  seats = seatsTable
})
