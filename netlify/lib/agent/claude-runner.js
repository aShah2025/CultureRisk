/**
 * CultureRisk AI — Claude agent engine (one step per HTTP request).
 *
 * Why stepwise: Netlify synchronous functions are capped at 30 s, and an agent
 * session is several model turns plus Qloo calls. Each request runs exactly
 * one model turn and executes any tool calls it makes. It then returns the
 * updated session state, which the browser echoes back for the next step.
 * Side benefits: the cockpit streams the agent's reasoning and every Qloo call
 * live, and no server-side session store is needed.
 *
 * The transcript is append-only and assistant content is echoed back
 * unchanged, including thinking blocks, which the API requires for continuity.
 */

'use strict';

const { SYSTEM_PROMPT, briefToMessage } = require('./prompt');
const { TOOL_DEFINITIONS, TERMINAL_TOOL, executeTool } = require('./tools');
const { createLedger, hydrateLedger, recordCalls } = require('./ledger');
const { finalizeSession, composeMemoFromLedger } = require('./finalize');

const NUDGE_SUBMIT = 'You have enough evidence. Call submit_greenlight_memo now.';

/** Build the per-step events the cockpit renders from one assistant message. */
function eventsFromContent(content) {
  const events = [];
  for (const block of content) {
    if (block.type === 'thinking' && block.thinking) events.push({ type: 'thinking', text: block.thinking });
    else if (block.type === 'text' && block.text.trim()) events.push({ type: 'narration', text: block.text.trim() });
    else if (block.type === 'tool_use' && block.name !== TERMINAL_TOOL) events.push({ type: 'tool_call', id: block.id, tool: block.name, input: block.input });
  }
  return events;
}

/**
 * Run one agent step.
 * @param {object} args
 * @param {object} args.brief          Normalised project brief.
 * @param {object|null} args.state     Echoed session state, or null to start.
 * @param {object} args.client         Anthropic SDK client (injected for tests).
 * @param {object} args.qloo           Qloo service.
 * @param {object} args.config         agentConfig().
 */
async function runClaudeStep({ brief, state, client, qloo, config }) {
  const messages = Array.isArray(state?.messages) && state.messages.length
    ? state.messages
    : [{ role: 'user', content: briefToMessage(brief) }];
  const ledger = state?.ledger ? hydrateLedger(state.ledger) : createLedger();
  const step = Number.isInteger(state?.step) ? state.step + 1 : 1;

  // Hard budget: if the model has not submitted in time, compose from evidence.
  if (step > config.maxSteps) {
    return {
      status: 'done',
      step,
      events: [{ type: 'narration', text: 'Step budget reached. Composing the memo directly from the Qloo evidence ledger.' }],
      ...finalizeSession(ledger, composeMemoFromLedger(ledger, brief), 'scripted'),
    };
  }

  const response = await client.beta.messages.create(
    {
      model: config.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: config.effort },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages,
    },
    { timeout: config.requestTimeoutMs, maxRetries: 0 },
  );

  if (response.stop_reason === 'refusal') {
    return { status: 'error', step, retryable: false, message: `The model declined this request (${response.stop_details?.category ?? 'policy'}).` };
  }
  if (response.stop_reason === 'max_tokens') {
    return { status: 'error', step, retryable: true, message: 'The model ran out of output budget on this step.' };
  }

  const events = eventsFromContent(response.content);
  const toolUses = response.content.filter((b) => b.type === 'tool_use');
  const memoCall = toolUses.find((b) => b.name === TERMINAL_TOOL);

  if (memoCall) {
    return { status: 'done', step, events, ...finalizeSession(ledger, memoCall.input, 'claude') };
  }

  const nextMessages = [...messages, { role: 'assistant', content: response.content }];

  if (toolUses.length === 0) {
    // Model ended its turn without submitting; steer it back to the terminal tool.
    nextMessages.push({ role: 'user', content: NUDGE_SUBMIT });
    return { status: 'continue', step, events, state: { messages: nextMessages, ledger, step } };
  }

  // Execute every tool call from this turn concurrently, then return all results in ONE user message.
  const before = qloo.calls.length;
  const results = await Promise.all(toolUses.map((tu) => executeTool(tu.name, tu.input, { qloo, ledger })));
  recordCalls(ledger, qloo.calls.slice(before));

  const toolResults = toolUses.map((tu, i) => ({
    type: 'tool_result',
    tool_use_id: tu.id,
    content: results[i].content,
    ...(results[i].isError ? { is_error: true } : {}),
  }));
  if (step === config.maxSteps - 1) toolResults.push({ type: 'text', text: NUDGE_SUBMIT });
  nextMessages.push({ role: 'user', content: toolResults });

  toolUses.forEach((tu, i) => {
    events.push({ type: 'tool_result', id: tu.id, tool: tu.name, ok: !results[i].isError, summary: results[i].summary });
  });

  return { status: 'continue', step, events, state: { messages: nextMessages, ledger, step } };
}

module.exports = { runClaudeStep, eventsFromContent };
