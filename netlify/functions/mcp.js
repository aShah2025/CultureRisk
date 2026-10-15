/**
 * =============================================================================
 * CultureRisk AI — MCP server (Netlify Function)
 * =============================================================================
 *
 *   POST /api/mcp   JSON-RPC 2.0, Model Context Protocol (Streamable HTTP,
 *                   stateless, JSON responses)
 *
 * Lets any existing MCP-capable agent use CultureRisk's Qloo-grounded film
 * intelligence as a tool, e.g. in Claude Code:
 *
 *   claude mcp add --transport http culturerisk https://<site>.netlify.app/api/mcp
 *
 * Supported methods: initialize, ping, tools/list, tools/call, notifications/*.
 * =============================================================================
 */

'use strict';

const { json, parseJsonBody } = require('../lib/http');
const { TOOLS, callTool } = require('../lib/agent/tools');

const SERVER_INFO = { name: 'culturerisk', title: 'CultureRisk AI: Qloo greenlight intelligence', version: '3.0.0' };
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function dispatch(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid Request');
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Use greenlight_analysis to evaluate a film project against its comparable titles with Qloo taste data. Use audience_affinities for a single-domain lookup.',
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      if (!TOOLS.some((t) => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        return rpcResult(msg.id, await callTool(name, msg.params?.arguments || {}));
      } catch (err) {
        console.error('[mcp] tool failed:', err);
        return rpcResult(msg.id, { content: [{ type: 'text', text: 'Tool execution failed.' }], isError: true });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    // No server-initiated stream; advertise as a plain JSON endpoint.
    return json(405, { error: 'method_not_allowed', message: 'POST JSON-RPC messages to this endpoint.' }, { Allow: 'POST' });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' });

  const parsed = parseJsonBody(event, 64 * 1024);
  if (!parsed.ok) return json(400, rpcError(null, -32700, 'Parse error'));

  const body = parsed.value;
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map(dispatch))).filter(Boolean);
    return replies.length ? json(200, replies) : { statusCode: 202, headers: {}, body: '' };
  }
  const reply = await dispatch(body);
  return reply ? json(200, reply) : { statusCode: 202, headers: {}, body: '' };
};
