import Redis from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultOptions = {
  maxRetriesPerRequest: 20,
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    logger.warn({ times, delay }, 'Retrying Redis connection');
    return delay;
  },
  reconnectOnError(err) {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  }
};

/**
 * Creates an ioredis client instance.
 * @param {string} roleName
 * @returns {Redis}
 */
export function createRedisClient(roleName = 'primary') {
  const client = new Redis(config.REDIS_URL, defaultOptions);

  client.on('connect', () => {
    logger.info({ role: roleName }, 'Redis client connected');
  });

  client.on('ready', () => {
    logger.info({ role: roleName }, 'Redis client ready for commands');
  });

  client.on('error', (err) => {
    logger.error({ role: roleName, err: err.message }, 'Redis client connection error');
  });

  client.on('close', () => {
    logger.warn({ role: roleName }, 'Redis connection closed');
  });

  return client;
}

// Primary client for queries and mutations
export const redisClient = createRedisClient('primary');

// Duplicate clients dedicated to Socket.IO pub/sub adapter
export const redisPubClient = redisClient.duplicate();
export const redisSubClient = redisClient.duplicate();

/**
 * Load Lua scripts from /src/redis/lua/*.lua and register them as custom commands.
 * @param {Redis} client
 */
export function registerLuaScripts(client = redisClient) {
  const luaDir = path.join(__dirname, 'lua');
  if (!fs.existsSync(luaDir)) {
    return;
  }

  const files = fs.readdirSync(luaDir).filter((f) => f.endsWith('.lua'));
  for (const file of files) {
    const commandName = path.basename(file, '.lua');
    const luaCode = fs.readFileSync(path.join(luaDir, file), 'utf8');

    // Expected metadata header in the first line of Lua script:
    // -- KEYS_COUNT: <number>
    const match = luaCode.match(/--\s*KEYS_COUNT:\s*(\d+)/i);
    const numberOfKeys = match ? parseInt(match[1], 10) : undefined;

    const commandDef = { lua: luaCode };
    if (numberOfKeys !== undefined) {
      commandDef.numberOfKeys = numberOfKeys;
    }

    client.defineCommand(commandName, commandDef);

    logger.debug({ commandName, numberOfKeys }, 'Registered Redis Lua command');
  }
}

// Auto-register available Lua scripts
registerLuaScripts(redisClient);
