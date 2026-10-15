/**
 * CultureRisk AI — agent session controller.
 *
 * Drives the stepwise agent protocol: POST a step, render its events, echo
 * the returned state, repeat until "done". Retryable failures such as a slow
 * model step or a rate limit are retried with backoff. Stop aborts the
 * in-flight request.
 */

import { agentStep } from './api.js';

const MAX_ITERATIONS = 16;
const MAX_RETRIES_PER_STEP = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AgentSession {
  /**
   * @param {object} brief
   * @param {{onStep:Function, onRetry:Function}} hooks
   */
  constructor(brief, hooks) {
    this.brief = brief;
    this.hooks = hooks;
    this.controller = new AbortController();
  }

  stop() {
    this.controller.abort();
  }

  /** @returns {Promise<object>} the final "done" payload */
  async run() {
    let state = null;
    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      const result = await this.#stepWithRetry(state);
      this.hooks.onStep(result);
      if (result.status === 'done') return result;
      state = result.state;
    }
    throw new Error('The agent did not finish within the iteration budget.');
  }

  async #stepWithRetry(state) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await agentStep(this.brief, state, this.controller.signal);
      } catch (err) {
        if (err.cancelled || !err.retryable || attempt >= MAX_RETRIES_PER_STEP) throw err;
        this.hooks.onRetry?.(err, attempt + 1);
        await sleep(1500 * (attempt + 1));
      }
    }
  }
}
