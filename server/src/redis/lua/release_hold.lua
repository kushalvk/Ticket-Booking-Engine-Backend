-- KEYS_COUNT: 4
-- Atomic hold release script
-- KEYS[1] = show:{showId}:seats
-- KEYS[2] = hold:{holdId}
-- KEYS[3] = user:{userId}:holds:{showId}
-- KEYS[4] = show:{showId}:holds:expiry
-- ARGV[1] = holdId
-- ARGV[2] = showId

local seatsKey = KEYS[1]
local holdKey = KEYS[2]
local userHoldsKey = KEYS[3]
local expiryKey = KEYS[4]

local holdId = ARGV[1]
local showId = ARGV[2]

local status = redis.call('HGET', holdKey, 'status')
if not status or status ~= 'HELD' then
  return { 0, 'HOLD_NOT_FOUND_OR_INACTIVE' }
end

local seatsJson = redis.call('HGET', holdKey, 'seats')
local seats = {}
if seatsJson then
  seats = cjson.decode(seatsJson)
end

-- Revert seat statuses back to AVAILABLE
for _, seatId in ipairs(seats) do
  local currentStatus = redis.call('HGET', seatsKey, seatId)
  if currentStatus == 'HELD' then
    redis.call('HSET', seatsKey, seatId, 'AVAILABLE')
  end
  local seatHoldKey = 'show:' .. showId .. ':hold:' .. seatId
  redis.call('DEL', seatHoldKey)
end

-- Update hold record
redis.call('HSET', holdKey, 'status', 'RELEASED')
redis.call('EXPIRE', holdKey, 60)

-- Clean up tracking sets
redis.call('SREM', userHoldsKey, holdId)
redis.call('ZREM', expiryKey, holdId)

return { 1, 'OK', seatsJson }
