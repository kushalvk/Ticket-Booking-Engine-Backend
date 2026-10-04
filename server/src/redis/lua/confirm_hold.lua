-- KEYS_COUNT: 4
-- KEYS[1] = hold:{holdId}
-- KEYS[2] = show:{showId}:seats
-- KEYS[3] = show:{showId}:holds:expiry
-- KEYS[4] = user:{userId}:holds:{showId}
--
-- ARGV[1] = holdId
-- ARGV[2] = userId
-- ARGV[3] = showId
-- ARGV[4] = nowMs
-- ARGV[5] = bookingId (optional)

local holdHash = KEYS[1]
local seatsHash = KEYS[2]
local expiryZset = KEYS[3]
local userHoldsSet = KEYS[4]

local holdId = ARGV[1]
local userId = ARGV[2]
local showId = ARGV[3]
local nowMs = tonumber(ARGV[4])
local bookingId = ARGV[5] or ''

-- 1. Verify existence of hold
local holdUserId = redis.call('HGET', holdHash, 'userId')
local status = redis.call('HGET', holdHash, 'status')
local expiresAt = redis.call('HGET', holdHash, 'expiresAt')

if not holdUserId or not status then
  return cjson.encode({ ok = false, err = 'HOLD_NOT_FOUND' })
end

-- 2. Verify ownership
if holdUserId ~= userId then
  return cjson.encode({ ok = false, err = 'FORBIDDEN', message = 'You do not own this hold' })
end

-- 3. Verify status
if status ~= 'ACTIVE' then
  return cjson.encode({ ok = false, err = 'HOLD_NOT_ACTIVE', status = status })
end

-- 4. Verify not expired
if expiresAt and tonumber(expiresAt) <= nowMs then
  return cjson.encode({ ok = false, err = 'HOLD_EXPIRED' })
end

-- 5. Set seats to BOOKED and clean up individual hold keys
local seatsJson = redis.call('HGET', holdHash, 'seats')
local seats = {}
if seatsJson then
  seats = cjson.decode(seatsJson)
end

for _, seatId in ipairs(seats) do
  redis.call('HSET', seatsHash, seatId, 'BOOKED')
  local seatHoldKey = 'show:' .. showId .. ':hold:' .. seatId
  redis.call('DEL', seatHoldKey)
end

-- 6. Mark hold as CONFIRMED
redis.call('HSET', holdHash, 'status', 'CONFIRMED')
if bookingId ~= '' then
  redis.call('HSET', holdHash, 'bookingId', bookingId)
end
redis.call('EXPIRE', holdHash, 86400) -- Retain confirmed hold for 24h

-- 7. Clean up tracking references
redis.call('ZREM', expiryZset, holdId)
redis.call('SREM', userHoldsSet, holdId)

return cjson.encode({
  ok = true,
  holdId = holdId,
  seats = seats
})
