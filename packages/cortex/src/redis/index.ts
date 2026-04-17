import type { CortexLocks, CortexMemory, CortexQueue, Cortex } from "../types";
import { createClient } from "redis";

export interface CortexRedisConnectionParams {
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: number;
  tls?: boolean;
  connectTimeoutMs?: number;
  keyPrefix?: string;
}

/** Resolves the TCP-backed Redis runtime. */
export function createRedisCortex(definition: CortexRedisConnectionParams): Cortex {
  const client = resolveRedisClient(definition);

  const prefix = definition.keyPrefix ?? "";
  const p = (k: string) => `${prefix}${k}`;

  const ensureConnected = async () => {
    if (!client.isOpen) {
      await client.connect();
    }
  };

  const memory: CortexMemory = {
    get: async <T = Record<string, unknown>>(key: string): Promise<T | undefined> => {
      await ensureConnected();

      const value = await client.get(p(key));

      return resolveRedisStringToJSON<T>(value);
    },
    set: async<T = Record<string, unknown>>(key: string, value: T) => {
      await ensureConnected();

      await client.set(p(key), JSON.stringify(value));
    },
    delete: async (key: string) => {
      await ensureConnected();

      await client.del(p(key));
    }
  };

  const queue: CortexQueue = {
    enqueue: async <T extends Record<string, unknown>>(queueKey: string, payload: T) => {
      await ensureConnected();
      await client.rPush(p(queueKey), JSON.stringify(payload));
    },
    dequeue: async <T extends Record<string, unknown>>(queueKey: string): Promise<T | undefined> => {
      await ensureConnected();

      const value = await client.lPop(p(queueKey));

      return resolveRedisStringToJSON<T>(value);
    }
  }

  const locks: CortexLocks = {
    acquire: async (lockKey: string, owner: string, ttlMs: number) => {
      await ensureConnected();
      const result = await client.set(p(lockKey), owner, {
        condition: "NX", expiration: {
          type: 'PX',
          value: ttlMs,
        }
      });

      return result === "OK";
    },
    renew: async (lockKey: string, owner: string, ttlMs: number) => {
      await ensureConnected();
      const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("pexpire", KEYS[1], ARGV[2])
          else
            return 0
          end
        `;
      const result = await client.eval(script, {
        keys: [p(lockKey)],
        arguments: [owner, ttlMs.toString()]
      });
      return result === 1;
    },
    release: async (lockKey: string, owner: string) => {
      await ensureConnected();
      const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
      const result = await client.eval(script, {
        keys: [p(lockKey)],
        arguments: [owner]
      });
      return result === 1;
    }
  }

  return {
    memory,
    queue,
    locks,
  }
}

/** Resolves Redis connection details and creates the client. */
function resolveRedisClient(definition: CortexRedisConnectionParams) {
  if (definition.url) {
    const url = new URL(definition.url);
    const database = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : definition.database;

    return createClient({
      url: definition.url,
      ...(typeof database === "number" ? { database } : {}),
      socket: {
        connectTimeout: definition.connectTimeoutMs ?? 5_000,
        ...(definition.tls ? { tls: true } : {})
      }
    });
  }

  return createClient({
    socket: {
      host: definition.host ?? "127.0.0.1",
      port: definition.port ?? 6379,
      connectTimeout: definition.connectTimeoutMs ?? 5_000,
      ...(definition.tls ? { tls: true } : {})
    },
    ...(definition.username ? { username: definition.username } : {}),
    ...(definition.password ? { password: definition.password } : {}),
    ...(typeof definition.database === "number" ? { database: definition.database } : {})
  });
}

export function resolveRedisStringToJSON<T = Record<string, unknown>>(value: string | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}