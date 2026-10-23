import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestMissing} from '../src/llm.js';

test('LLM не вызывается для конфликта, а предложение модели не повторяет бренд',async()=>{
  const old={url:process.env.LLM_URL,key:process.env.LLM_API_KEY,model:process.env.LLM_MODEL,fetch:global.fetch};
  let requests=0;
  process.env.LLM_URL='https://example.test/chat/completions';
  process.env.LLM_API_KEY='test';
  process.env.LLM_MODEL='demo';
  global.fetch=async(_url,options)=>{
    requests++;
    const payload=JSON.parse(options.body);
    const allowed=JSON.parse(payload.messages[1].content).allowed_attributes;
    assert.deepEqual(allowed,['model','storage_gb']);
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({items:[
      {attribute:'model',value:'Lenovo',field:'title',quote:'Ноутбук Lenovo'},
      {attribute:'storage_gb',value:'512',field:'title',quote:'512 GB'}
    ]})}}],usage:{prompt_tokens:100,completion_tokens:20}})};
  };
  try{
    const card={title:'Ноутбук Lenovo 512 GB',seller_attributes:{}};
    const result={missing_required:['brand','model','storage_gb'],attributes:{
      brand:{status:'review',candidates:[{value:'Lenovo'}]},model:{status:'missing'},storage_gb:{status:'missing'}
    }};
    const out=await suggestMissing(card,result);
    assert.equal(requests,1);
    assert.equal(out.llm.status,'completed');
    assert.deepEqual(out.llm.suggestions.map(x=>[x.attribute,x.value,x.status]),[['storage_gb',512,'review']]);
    assert.equal(out.attributes.brand.status,'review');
  }finally{
    global.fetch=old.fetch;
    for(const [key,value] of [['LLM_URL',old.url],['LLM_API_KEY',old.key],['LLM_MODEL',old.model]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
test('оборванный ответ LLM не попадает в атрибуты',async()=>{
  const old={url:process.env.LLM_URL,key:process.env.LLM_API_KEY,model:process.env.LLM_MODEL,fetch:global.fetch};
  process.env.LLM_URL='https://example.test/chat/completions';process.env.LLM_API_KEY='test';process.env.LLM_MODEL='demo';
  global.fetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{"items":[{"attribute":"model"'}}],usage:{completion_tokens:512}})});
  try{
    const result={missing_required:['model'],attributes:{model:{status:'missing'}}};
    const out=await suggestMissing({title:'Смартфон Samsung'},result);
    assert.equal(out.llm.status,'truncated');assert.deepEqual(out.llm.suggestions,[]);
    assert.equal(out.attributes.model.status,'missing');
  }finally{
    global.fetch=old.fetch;
    for(const [key,value] of [['LLM_URL',old.url],['LLM_API_KEY',old.key],['LLM_MODEL',old.model]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
test('LLM не тратит вызов на батарею без ёмкости в тексте',async()=>{
  const old={url:process.env.LLM_URL,key:process.env.LLM_API_KEY,model:process.env.LLM_MODEL,fetch:global.fetch};
  process.env.LLM_URL='https://example.test/chat/completions';process.env.LLM_API_KEY='test';process.env.LLM_MODEL='demo';
  global.fetch=()=>{throw Error('Gateway should not be called');};
  try{
    const out=await suggestMissing({title:'Смартфон Apple iPhone 17',description:'Быстрая зарядка',seller_attributes:{}},
      {missing_required:['battery_mah'],attributes:{battery_mah:{status:'missing'}}});
    assert.equal(out.llm.status,'skipped_no_evidence');
  }finally{
    global.fetch=old.fetch;
    for(const [key,value] of [['LLM_URL',old.url],['LLM_API_KEY',old.key],['LLM_MODEL',old.model]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
