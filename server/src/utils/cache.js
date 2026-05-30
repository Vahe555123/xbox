const config = require('../config');

class MemoryCache {
  constructor(defaultTtl = config.cache.ttl) {
    this._store = new Map();
    this._defaultTtl = defaultTtl * 1000;
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now > (entry.staleUntil ?? entry.expiresAt)) {
      this._store.delete(key);
      return null;
    }
    if (now > entry.expiresAt) {
      return null;
    }
    return entry.value;
  }

  getStale(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now > (entry.staleUntil ?? entry.expiresAt)) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlSeconds, staleTtlSeconds = 0) {
    const ttl = (ttlSeconds ?? this._defaultTtl / 1000) * 1000;
    const staleTtl = Math.max(0, Number(staleTtlSeconds) || 0) * 1000;
    const expiresAt = Date.now() + ttl;
    this._store.set(key, {
      value,
      expiresAt,
      staleUntil: expiresAt + staleTtl,
    });
  }

  delete(key) {
    this._store.delete(key);
  }

  clear() {
    this._store.clear();
  }

  get size() {
    this._prune();
    return this._store.size;
  }

  _prune() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > (entry.staleUntil ?? entry.expiresAt)) this._store.delete(key);
    }
  }
}

module.exports = new MemoryCache();
