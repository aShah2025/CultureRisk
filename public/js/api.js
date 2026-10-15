/**
 * CultureRisk AI — API client for the same-origin Netlify routes.
 *   /api/agent        → netlify/functions/agent.js
 *   /api/qloo_bridge  → netlify/functions/qloo_bridge.js
 *   /api/mcp          → netlify/functions/mcp.js (for external agents)
 */

const STEP_TIMEOUT_MS = 32000; // just above Netlify's 30 s function cap

async function request(url, { method = 'GET', body, signal, timeoutMs = STEP_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!data) {
      const err = new Error(`HTTP ${res.status}: the server returned no JSON. Is /api routed to Netlify Functions? Run "netlify dev" locally.`);
      err.retryable = res.status >= 500;
      throw err;
    }
    if (!res.ok || data.status === 'error') {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.retryable = Boolean(data.retryable);
      throw err;
    }
    return data;
  } catch (err) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { cancelled: true });
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw Object.assign(new Error('The step timed out.'), { retryable: true });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export const getCapabilities = () => request('/api/agent', { timeoutMs: 8000 });

export const agentStep = (brief, state, signal) => request('/api/agent', { method: 'POST', body: { brief, state }, signal });

export function quickScan(anchor, domain, signal) {
  const params = new URLSearchParams({ scriptAnchor: anchor, targetDomain: domain });
  return request(`/api/qloo_bridge?${params}`, { signal, timeoutMs: 15000 });
}
