const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeModelResponse} = require('../dist/server/ai/runtime/transport');
const {executeManagedPrompt} = require('../dist/server/ai/runtime/managedExecution');
const {preparePrompt} = require('../dist/server/ai/prompts');
const {DEFAULT_MODEL_POLICY} = require('../dist/common/modelRouting');
const content = '{"suggestions":{"name":"沈青"}}';
const openai = (reason = 'stop') => ({id: 'reply', model: 'MiniMax-M3',
  choices: [{finish_reason: reason, message: {content, reasoning_content: 'not-final-text'}}],
  usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15}});
const anthropic = (reason = 'end_turn') => ({id: 'reply', model: 'MiniMax-M3', stop_reason: reason,
  content: [{type: 'thinking', thinking: 'not-final-text'}, {type: 'text', text: content.slice(0, 12)},
    {type: 'text', text: content.slice(12)}], usage: {input_tokens: 10, output_tokens: 5}});

for (const [openReason, anthropicReason, normalized] of [
  ['stop', 'end_turn', 'completed'], ['length', 'max_tokens', 'output_limit'],
  ['tool_calls', 'tool_use', 'tool_calls'], ['content_filter', 'refusal', 'refused'],
]) {
  test(`both protocols normalize ${openReason}/${anthropicReason} to ${normalized}`, () => {
    const a = normalizeModelResponse('openai-compatible', openai(openReason));
    const b = normalizeModelResponse('anthropic-compatible', anthropic(anthropicReason));
    assert.deepEqual({...a, rawFinishReason: null}, {...b, rawFinishReason: null});
    assert.equal(a.finishReason, normalized);
    assert.equal(a.rawFinishReason, openReason);
    assert.equal(b.rawFinishReason, anthropicReason);
    assert.equal(a.content, content);
    assert.equal(a.usedTokens, 15);
    assert.doesNotMatch(JSON.stringify(a), /choices|stop_reason|not-final-text/);
    assert.doesNotMatch(JSON.stringify(b), /choices|stop_reason|not-final-text/);
  });
}

test('missing content/usage/termination stays unknown in both protocols, not invented success', () => {
  const a = normalizeModelResponse('openai-compatible', {choices: [null]});
  const b = normalizeModelResponse('anthropic-compatible', {content: [{type: 'thinking', thinking: 'hidden'}]});
  assert.deepEqual(a, b);
  assert.equal(a.content, null);
  assert.equal(a.finishReason, 'unknown');
  assert.equal(a.inputTokens, null);
  assert.equal(a.usageReported, false);
  const foreign = normalizeModelResponse('anthropic-compatible', anthropic('pause_turn'));
  assert.equal(foreign.finishReason, 'other');
  assert.equal(foreign.rawFinishReason, 'pause_turn');
});

test('the selected protocol, not the MiniMax model name, drives transport and returns the same business object', async () => {
  const prompt = preparePrompt('form_assist', {bookName: '书', formName: '人物', cardTitle: '人物',
    currentValues: {}, instruction: '', fields: [{key: 'name', name: '姓名', description: '', type: 'short_text',
      required: true, options: [], defaultValue: null, group: '基础', order: 0}]});
  const outputs = [];
  for (const provider of ['openai-compatible', 'anthropic-compatible']) {
    const route = {primary: {provider, endpoint: provider === 'openai-compatible'
      ? 'https://api.minimax.cn/v1' : 'https://api.minimax.cn/anthropic',
      model: 'MiniMax-M3', credentialId: 'fixture'}, fallbacks: [],
      policy: {...DEFAULT_MODEL_POLICY, maxTotalTokens: 200000}, sourceLayers: []};
    let calls = 0;
    const result = await executeManagedPrompt('form_assist', prompt, {
      routeResolver: async () => route, snapshotWriter: async () => ({id: 'snapshot', snapshotHash: 'hash', taskType: 'form_assist', route}),
      credentialResolver: async () => 'fixture-key',
      fetcher: async (url, init) => {
        calls++;
        const request = JSON.parse(init.body);
        assert.equal(request.model, 'MiniMax-M3');
        if (provider === 'openai-compatible') {
          assert.equal(url, 'https://api.minimax.cn/v1/chat/completions');
          assert.equal(init.headers.Authorization, 'Bearer fixture-key');
          assert.equal(request.messages[0].role, 'system');
          assert.equal(request.system, undefined);
        } else {
          assert.equal(url, 'https://api.minimax.cn/anthropic/v1/messages');
          assert.equal(init.headers['x-api-key'], 'fixture-key');
          assert.equal(init.headers.Authorization, undefined);
          assert.equal(request.system, prompt.messages[0].content);
          assert.deepEqual(request.messages.map(message => message.role), ['user']);
        }
        if (provider === 'openai-compatible') {
          assert.equal(request.tool_choice.function.name, 'submit_creative_result');
          assert.deepEqual(request.tools[0].function.parameters, prompt.outputSchema);
          return new Response(JSON.stringify({...openai(), choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{type:'function',function:{name:'submit_creative_result',arguments:content}}]}}]}));
        }
        assert.equal(request.tool_choice.name, 'submit_creative_result');
        assert.deepEqual(request.tools[0].input_schema, prompt.outputSchema);
        return new Response(JSON.stringify({...anthropic(),stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_creative_result',input:JSON.parse(content)}]}));
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.modelSnapshot.provider, provider);
    assert.equal(result.usedTokens, 15);
    outputs.push(result.output);
  }
  assert.deepEqual(outputs, [{suggestions: {name: '沈青'}}, {suggestions: {name: '沈青'}}]);
});

test('structured result channel rejects foreign or multiple tool calls instead of using prose', () => {
  const tool='submit_creative_result', fn={type:'function',function:{name:tool,arguments:content}};
  for(const calls of [[{...fn,function:{...fn.function,name:'delete_book'}}],[fn,fn]]) {
    assert.equal(normalizeModelResponse('openai-compatible',{choices:[{message:{content,tool_calls:calls}}]},tool).content,null);
  }
  const block={type:'tool_use',name:tool,input:JSON.parse(content)};
  for(const blocks of [[{...block,name:'delete_book'}],[block,block],[{...block,input:'not-an-object'}]]) {
    assert.equal(normalizeModelResponse('anthropic-compatible',{content:[{type:'text',text:content},...blocks]},tool).content,null);
  }
  assert.equal(normalizeModelResponse('openai-compatible',{choices:[{message:{tool_calls:[fn]}}]}).content,null,'unsolicited tools are never creative text');
  assert.equal(normalizeModelResponse('openai-compatible',openai(),tool).content,content);
  assert.equal(normalizeModelResponse('anthropic-compatible',anthropic(),tool).content,content);
});
