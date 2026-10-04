-- KEYS_COUNT: 4
-- Atomic confirm booking script
-- KEYS[1] = show:{showId}:seats
-- KEYS[2] = hold:{holdId}
-- KEYS[3] = user:{userId}:holds:{showId}
-- KEYS[4] = show:{showId}:holds:expiry
-- ARGV[1] = holdId
-- ARGV[2] = showId
-- ARGV[3] = bookingId

local seatsKey = KEYS[1]
local holdKey = KEYS[2]
local userHoldsKey = KEYS[3]
local expiryKey = KEYS[4]

local holdId = ARGV[1]
local showId = ARGV[2]
local bookingId = ARGV[3]

local status = redis.call('HGET', holdKey, 'status')
if not status or status ~= 'HELD' then
  return { 0, 'HOLD_NOT_FOUND_OR_EXPIRED' }
end

local seatsJson = redis.call('HGET', holdKey, 'seats')
local seats = {}
if seatsJson then
  seats = cjson.decode(seatsJson)
end

-- Transition seats to BOOKED
for _, seatId in ipairs(seats) do
  redis.call('HSET', seatsKey, seatId, 'BOOKED')
  local seatHoldKey = 'show:' .. showId .. ':hold:' .. seatId
  redis.call('DEL', seatHoldKey)
end

-- Update hold record status
redis.call('HSET', holdKey, 'status', 'CONFIRMED', 'bookingId', bookingId)
redis.call('EXPIRE', holdKey, 86400) -- Retain confirmed hold metadata for 24h

-- Remove from active holds sets
redis.call('SREM', userHoldsKey, holdId)
redis.call('ZREM', expiryKey, holdId)

return { 1, 'OK', seatsJson }
