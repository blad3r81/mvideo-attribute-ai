import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestMissing} from '../src/llm.js';
import {extract} from '../src/catalog-extractor.js';
import fs from 'node:fs';

test('LLM проверяет спорные поля реальной карточки, но не принимает их без справочника',async()=>{
  const card=JSON.parse(fs.readFileSync(new URL('../data/real_cards.json',import.meta.url))).find(x=>x.id==='401253882');
  assert.ok(card);
  const result=extract(card);
  assert.equal(Object.values(result.attributes).filter(x=>x.status==='review').length,15);
  const old={url:process.env.LLM_URL,key:process.env.LLM_API_KEY,model:process.env.LLM_MODEL,fetch:global.fetch};
  process.env.LLM_URL='https://example.test/chat/completions';process.env.LLM_API_KEY='test';process.env.LLM_MODEL='demo';
  global.fetch=async(_url,options)=>{
    const prompt=JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(Object.keys(prompt.review_attributes).length,15);
    assert.equal(prompt.review_attributes['Страна'].candidates[0].raw,'Бангладеш');
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({items:[],review_items:[
      {attribute:'Страна',verdict:'поддерживается',field:'Бангладеш',quote:'Бангладеш'},
      {attribute:'Пол',verdict:'supported',field:'seller_attributes.Пол_search',quote:'унисекс'},
      {attribute:'Сезон',verdict:'supported',field:'seller_attributes.Страна_search',quote:'Бангладеш'},
      {attribute:'Бренд',verdict:'supported',field:'seller_attributes.Бренд',quote:'Основа Лаб'}
    ]})}}],usage:{prompt_tokens:800,completion_tokens:100}})};
  };
  try{
    const out=await suggestMissing(card,result);
    assert.equal(out.llm.status,'completed');
    assert.deepEqual(out.llm.review_checks.map(x=>x.attribute),['Страна','Пол']);
    assert.equal(out.llm.review_checks[0].dictionary_verified,false);
    assert.equal(Object.values(out.attributes).filter(x=>x.status==='review').length,15);
  }finally{
    global.fetch=old.fetch;
    for(const [key,value] of [['LLM_URL',old.url],['LLM_API_KEY',old.key],['LLM_MODEL',old.model]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
