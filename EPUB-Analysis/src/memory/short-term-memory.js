function optionalRequire(moduleName) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(moduleName);
  } catch (error) {
    return null;
  }
}

function normalizeValue(value) {
  return String(value || "").trim();
}

function parseTtlSeconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

class InMemoryShortTermStore {
  constructor() {
    this.data = new Map();
    this.timers = new Map();
  }

  set(key, value, ttlSeconds) {
    const normalizedKey = normalizeValue(key);
    if (!normalizedKey) {
      return;
    }

    this.data.set(normalizedKey, value);
    const priorTimer = this.timers.get(normalizedKey);
    if (priorTimer) {
      clearTimeout(priorTimer);
    }

    if (ttlSeconds > 0) {
      const timer = setTimeout(() => {
        this.data.delete(normalizedKey);
        this.timers.delete(normalizedKey);
      }, ttlSeconds * 1000);
      timer.unref?.();
      this.timers.set(normalizedKey, timer);
    }
  }

  get(key) {
    return this.data.get(normalizeValue(key)) ?? null;
  }

  delete(key) {
    const normalizedKey = normalizeValue(key);
    const priorTimer = this.timers.get(normalizedKey);
    if (priorTimer) {
      clearTimeout(priorTimer);
      this.timers.delete(normalizedKey);
    }
    this.data.delete(normalizedKey);
  }

  has(key) {
    return this.data.has(normalizeValue(key));
  }
}

class ShortTermMemoryService {
  constructor(options = {}) {
    this.redisModule = options.redisModule || optionalRequire("redis");
    this.redisUrl = normalizeValue(options.redisUrl || process.env.REDIS_URL);
    this.defaultTtlSeconds = parseTtlSeconds(
      options.defaultTtlSeconds || process.env.SHORT_TERM_MEMORY_TTL_SECONDS,
      6 * 60 * 60
    );
    this.runContextTtlSeconds = parseTtlSeconds(
      options.runContextTtlSeconds || process.env.RUN_CONTEXT_TTL_SECONDS,
      this.defaultTtlSeconds
    );
    this.promptCacheTtlSeconds = Math.max(
      parseTtlSeconds(
        options.promptCacheTtlSeconds || process.env.PROMPT_CACHE_TTL_SECONDS,
        24 * 60 * 60
      ),
      24 * 60 * 60
    );
    this.memory = new InMemoryShortTermStore();
    this.client = null;
    this.status = {
      provider: "memory",
      configured: Boolean(this.redisUrl),
      supported: Boolean(this.redisModule && this.redisModule.createClient),
      activeProvider: "memory",
      lastError: "",
    };
  }

  async initialize() {
    if (this.client) {
      return this.client;
    }

    if (!this.status.configured || !this.status.supported) {
      return null;
    }

    try {
      const client = this.redisModule.createClient({ url: this.redisUrl });
      client.on("error", (error) => {
        this.status.lastError = error.message;
      });
      await client.connect();
      this.client = client;
      this.status.activeProvider = "redis";
      this.status.lastError = "";
      return this.client;
    } catch (error) {
      this.status.lastError = error.message;
      this.status.activeProvider = "memory";
      return null;
    }
  }

  async setJson(key, value, ttlSeconds = this.defaultTtlSeconds) {
    const normalizedKey = normalizeValue(key);
    if (!normalizedKey) {
      return;
    }

    const client = await this.initialize();
    const payload = JSON.stringify(value ?? null);
    if (client) {
      await client.set(normalizedKey, payload, { EX: ttlSeconds });
      return;
    }

    this.memory.set(normalizedKey, value ?? null, ttlSeconds);
  }

  async getJson(key) {
    const normalizedKey = normalizeValue(key);
    if (!normalizedKey) {
      return null;
    }

    const client = await this.initialize();
    if (client) {
      const value = await client.get(normalizedKey);
      return value ? JSON.parse(value) : null;
    }

    return this.memory.get(normalizedKey);
  }

  async delete(key) {
    const normalizedKey = normalizeValue(key);
    if (!normalizedKey) {
      return;
    }

    const client = await this.initialize();
    if (client) {
      await client.del(normalizedKey);
      return;
    }

    this.memory.delete(normalizedKey);
  }

  async setRunContext(runId, payload, ttlSeconds = this.runContextTtlSeconds) {
    return this.setJson(`run:${runId}:context`, payload, ttlSeconds);
  }

  async getRunContext(runId) {
    return this.getJson(`run:${runId}:context`);
  }

  async updateRunContext(runId, patch = {}, ttlSeconds = this.runContextTtlSeconds) {
    const current = (await this.getRunContext(runId)) || {};
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.setRunContext(runId, next, ttlSeconds);
    return next;
  }

  async clearRunContext(runId) {
    return this.delete(`run:${runId}:context`);
  }

  async setPromptCache(cacheKey, payload, ttlSeconds = this.promptCacheTtlSeconds) {
    return this.setJson(`promptcache:${cacheKey}`, payload, ttlSeconds);
  }

  async getPromptCache(cacheKey) {
    return this.getJson(`promptcache:${cacheKey}`);
  }

  async setTaskState(taskId, payload, ttlSeconds = this.defaultTtlSeconds) {
    return this.setJson(`task:${taskId}:state`, payload, ttlSeconds);
  }

  async getTaskState(taskId) {
    return this.getJson(`task:${taskId}:state`);
  }

  async acquireLock(lockKey, ttlSeconds = 120) {
    const normalizedKey = `lock:${normalizeValue(lockKey)}`;
    if (!normalizedKey || normalizedKey === "lock:") {
      return false;
    }

    const client = await this.initialize();
    if (client) {
      const acquired = await client.set(normalizedKey, "1", { EX: ttlSeconds, NX: true });
      return acquired === "OK";
    }

    if (this.memory.has(normalizedKey)) {
      return false;
    }

    this.memory.set(normalizedKey, "1", ttlSeconds);
    return true;
  }

  async releaseLock(lockKey) {
    return this.delete(`lock:${normalizeValue(lockKey)}`);
  }

  async getStatus() {
    await this.initialize();
    return {
      ...this.status,
      redisUrlPresent: Boolean(this.redisUrl),
      defaultTtlSeconds: this.defaultTtlSeconds,
      runContextTtlSeconds: this.runContextTtlSeconds,
      promptCacheTtlSeconds: this.promptCacheTtlSeconds,
    };
  }
}

const shortTermMemory = new ShortTermMemoryService();

module.exports = {
  InMemoryShortTermStore,
  ShortTermMemoryService,
  shortTermMemory,
};
