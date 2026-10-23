import test from 'node:test';
import assert from 'node:assert/strict';
import {llmConfig} from '../src/llm.js';

test('шлюз VM использует OpenAI-совместимый адрес и ключ без изменения результата правил',()=>{
  const config=llmConfig({OPENAI_BASE_URL:'https://hub.gigaschool.ru/api/v1/llm/v1/',OPENAI_API_KEY:'test-secret',LLM_MODEL:'GigaChat/GigaChat-3-Pro',LLM_TIMEOUT_MS:'30000'});
  assert.equal(config.url,'https://hub.gigaschool.ru/api/v1/llm/v1/chat/completions');
  assert.equal(config.key,'test-secret');
  assert.equal(config.model,'GigaChat/GigaChat-3-Pro');
  assert.equal(config.timeoutMs,30000);
});

test('явный LLM_URL имеет приоритет для локального и Vercel запуска',()=>{
  const config=llmConfig({LLM_URL:'https://example.test/chat/completions',LLM_API_KEY:'explicit',LLM_MODEL:'demo',OPENAI_BASE_URL:'https://hub.gigaschool.ru/api/v1/llm/v1',OPENAI_API_KEY:'vm'});
  assert.equal(config.url,'https://example.test/chat/completions');
  assert.equal(config.key,'explicit');
});
