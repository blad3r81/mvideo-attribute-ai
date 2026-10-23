import test from 'node:test';
import assert from 'node:assert/strict';

process.env.API_TOKEN='quota-test-token';
process.env.LLM_AUTO_REVIEW='1';
process.env.LLM_DAILY_LIMIT='1';
process.env.LLM_URL='https://example.test/chat/completions';
process.env.LLM_API_KEY='test';
process.env.LLM_MODEL='demo';
const {handleApi}=await import('../src/api-handler.js?quota-test');

test('исчерпание лимита LLM сохраняет результат правил',async()=>{
  const oldFetch=global.fetch;
  let calls=0;
  global.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:'{"items":[],"review_items":[]}'}}]})};};
  const request=async()=>{
    const req={method:'POST',url:'/api/extract',headers:{authorization:'Bearer quota-test-token'},body:{card:{title:'Смартфон Samsung',seller_attributes:{Бренд:'Samsung'}}}};
    const res={writeHead(code){this.status=code;},end(value){this.data=JSON.parse(value);}};
    await handleApi(req,res);
    return res;
  };
  try{
    const first=await request(),second=await request();
    assert.equal(first.status,200);
    assert.equal(first.data.llm.status,'completed');
    assert.equal(second.status,200);
    assert.equal(second.data.llm.status,'quota_exceeded');
    assert.deepEqual(second.data.attributes,first.data.attributes);
    assert.equal(calls,1);
  }finally{global.fetch=oldFetch;}
});
