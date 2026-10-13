/**
 * TokenBudget — a sliding-window governor for the Groq free tier.
 *
 * Why this exists: free/developer keys are capped at roughly
 * 8K TPM / 30 RPM / 1K RPD (and some orgs get far less, e.g. 1K TPM).
 * Every AI call in FitForge is:
 *   1. estimated  -> reserve(estimate) blocks until the window has room
 *   2. executed   -> commit(usage) replaces the estimate with the real number
 *   3. reconciled -> syncFromHeaders() clamps us to whatever Groq reports
 *
 * Requests are serialised through a FIFO chain so concurrent users can never
 * overspend, and the UI can show an honest "budget" meter at all times.
 */
import config from '../config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 60_000)));

const secondsToUtcMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
};

export class TokenBudget {
  constructor(opts = {}) {
    this.tpm = opts.tokensPerMinute ?? config.groq.tokensPerMinute;
    this.rpm = opts.requestsPerMinute ?? config.groq.requestsPerMinute;
    this.rpd = opts.requestsPerDay ?? config.groq.requestsPerDay;
    this.tokenWindow = [];   // { ts, tokens }
    this.requestWindow = []; // ts
    this.day = { date: '', count: 0 };
    this.blockedUntil = 0;   // from retry-after / remaining=0 headers
    this.queue = [];
    this.totalServed = 0;
    this.totalBlockedMs = 0;
    this.chain = Promise.resolve();
  }

  _today() {
    return new Date().toISOString().slice(0, 10);
  }

  _prune(now = Date.now()) {
    const cutoff = now - 60_000;
    while (this.tokenWindow.length && this.tokenWindow[0].ts < cutoff) this.tokenWindow.shift();
    while (this.requestWindow.length && this.requestWindow[0] < cutoff) this.requestWindow.shift();
    if (this.day.date !== this._today()) this.day = { date: this._today(), count: 0 };
  }

  tokensUsed() {
    this._prune();
    return this.tokenWindow.reduce((s, e) => s + e.tokens, 0);
  }

  requestsUsed() {
    this._prune();
    return this.requestWindow.length;
  }

  /** How long until `tokens` worth of budget is free (ms). 0 = go now. */
  waitMs(tokens = 0) {
    const now = Date.now();
    this._prune(now);
    if (this.blockedUntil > now) return this.blockedUntil - now;

    const waits = [];
    const used = this.tokensUsed();
    if (used + tokens > this.tpm) {
      // free up enough tokens by expiring the oldest entries
      let need = used + tokens - this.tpm;
      for (const e of this.tokenWindow) {
        need -= e.tokens;
        waits.push(e.ts + 60_000 - now);
        if (need <= 0) break;
      }
      if (need > 0) waits.push(60_000); // single request bigger than the window
    }
    if (this.requestWindow.length >= this.rpm) {
      waits.push(this.requestWindow[0] + 60_000 - now);
    }
    if (this.day.count >= this.rpd) {
      const midnight = new Date();
      midnight.setUTCHours(24, 0, 5, 0);
      waits.push(midnight.getTime() - now);
    }
    return waits.length ? Math.max(0, ...waits) : 0;
  }

  /** Run `fn` strictly after every previously queued reservation (FIFO). */
  _exclusive(fn) {
    const prev = this.chain;
    let release;
    this.chain = new Promise((r) => { release = r; });
    return prev.then(fn, fn).finally(release);
  }

  /**
   * Blocks until the sliding windows can absorb `tokens`, then books them.
   * Fails fast (429) instead of hanging when the wait would exceed maxWaitMs
   * or the daily quota is gone, so callers can degrade to the local engine.
   */
  reserve(tokens, { onWait, maxWaitMs = 120_000 } = {}) {
    return this._exclusive(async () => {
      let waited = 0;
      for (;;) {
        this._prune();
        if (this.day.count >= this.rpd) {
          const err = new Error('Daily Groq request quota exhausted. Try again tomorrow.');
          err.code = 'daily_quota';
          err.status = 429;
          err.retryAfter = secondsToUtcMidnight();
          throw err;
        }
        const w = this.waitMs(tokens);
        if (w <= 0) break;
        if (waited + w > maxWaitMs) {
          const err = new Error(
            `Token budget saturated — the next slot frees in ${Math.ceil(w / 1000)}s ` +
            `(waited limit ${Math.round(maxWaitMs / 1000)}s).`
          );
          err.code = 'budget_exhausted';
          err.status = 429;
          err.retryAfter = Math.ceil(w / 1000);
          throw err;
        }
        waited += w;
        this.totalBlockedMs += w;
        try { onWait?.(w, this.snapshot(tokens)); } catch { /* telemetry only */ }
        await sleep(w + 40);
      }
      this._prune();
      this.tokenWindow.push({ ts: Date.now(), tokens });
      this.requestWindow.push(Date.now());
      this.day.count += 1;
      return { waited };
    });
  }

  /** Replace the reservation estimate with the real usage reported by Groq. */
  commit(actualTokens, estimate) {
    if (!Number.isFinite(actualTokens)) return;
    const delta = actualTokens - (estimate || 0);
    if (!delta || !this.tokenWindow.length) return;
    // apply the correction to the most recent reservation
    const last = this.tokenWindow[this.tokenWindow.length - 1];
    last.tokens = Math.max(0, last.tokens + delta);
  }

  /** Learn the real limits from Groq response headers. */
  syncFromHeaders(headers = {}) {
    const h = (k) => headers.get?.(k) ?? headers[k];
    const limit = Number(h('x-ratelimit-limit-tokens'));
    if (Number.isFinite(limit) && limit > 0) {
      // never allow ourselves more than the provider says we have
      this.tpm = Math.min(this.tpm, limit);
    }
    const remaining = Number(h('x-ratelimit-remaining-tokens'));
    if (Number.isFinite(remaining) && remaining <= 0) {
      const reset = String(h('x-ratelimit-reset-tokens') || '60s');
      const secs = parseFloat(reset.replace(/[^\d.]/g, '')) || 60;
      this.blockedUntil = Math.max(this.blockedUntil, Date.now() + secs * 1000);
    }
    const retryAfter = Number(h('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      this.blockedUntil = Math.max(this.blockedUntil, Date.now() + retryAfter * 1000);
    }
  }

  /** Force a pause (used after a 429 that did not carry headers). */
  blockFor(ms) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
  }

  snapshot(pendingTokens = 0) {
    this._prune();
    const used = this.tokensUsed();
    const reqUsed = this.requestWindow.length;
    const now = Date.now();
    return {
      tokensPerMinute: this.tpm,
      tokensUsedThisMinute: used,
      tokensReserved: pendingTokens,
      tokensRemaining: Math.max(0, this.tpm - used - pendingTokens),
      requestsPerMinute: this.rpm,
      requestsUsedThisMinute: reqUsed,
      requestsPerDay: this.rpd,
      requestsUsedToday: this.day.count,
      blocked: this.blockedUntil > now,
      blockedForMs: Math.max(0, this.blockedUntil - now),
      nextFreeInMs: this.waitMs(1),
      totalServed: this.totalServed,
      totalThrottledMs: Math.round(this.totalBlockedMs),
      utilisation: this.tpm ? Math.round((used / this.tpm) * 100) : 0,
    };
  }
}

export const tokenBudget = new TokenBudget();
export default tokenBudget;
