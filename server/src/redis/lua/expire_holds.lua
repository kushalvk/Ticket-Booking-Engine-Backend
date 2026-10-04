-- KEYS_COUNT: 2
-- Sweeper script to expire holds past their TTL
-- KEYS[1] = show:{showId}:seats
-- KEYS[2] = show:{showId}:holds:expiry
-- ARGV[1] = showId
-- ARGV[2] = nowMs
-- ARGV[3] = batchLimit

local seatsKey = KEYS[1]
local expiryKey = KEYS[2]

local showId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local batchLimit = tonumber(ARGV[3]) or 50

local expiredHoldIds = redis.call('ZRANGEBYSCORE', expiryKey, 0, nowMs, 'LIMIT', 0, batchLimit)
local releasedSeats = {}
local processedHoldIds = {}

for _, holdId in ipairs(expiredHoldIds) do
  local holdKey = 'hold:' .. holdId
  local status = redis.call('HGET', holdKey, 'status')

  if status == 'HELD' then
    local seatsJson = redis.call('HGET', holdKey, 'seats')
    local userId = redis.call('HGET', holdKey, 'userId')

    if seatsJson then
      local seats = cjson.decode(seatsJson)
      for _, seatId in ipairs(seats) do
        local seatStatus = redis.call('HGET', seatsKey, seatId)
        if seatStatus == 'HELD' then
          redis.call('HSET', seatsKey, seatId, 'AVAILABLE')
          table.insert(releasedSeats, seatId)
        end
        redis.call('DEL', 'show:' .. showId .. ':hold:' .. seatId)
      end
    end

    redis.call('HSET', holdKey, 'status', 'EXPIRED')
    redis.call('EXPIRE', holdKey, 300)

    if userId then
      redis.call('SREM', 'user:' .. userId .. ':holds:' .. showId, holdId)
    end
  end

  redis.call('ZREM', expiryKey, holdId)
  table.insert(processedHoldIds, holdId)
end

return { cjson.encode(processedHoldIds), cjson.encode(releasedSeats) }
