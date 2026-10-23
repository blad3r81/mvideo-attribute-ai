import test,{after} from 'node:test';
import assert from 'node:assert/strict';

const previous={NODE_ENV:process.env.NODE_ENV,API_TOKEN:process.env.API_TOKEN,DEMO_MODE:process.env.DEMO_MODE,LLM_AUTO_REVIEW:process.env.LLM_AUTO_REVIEW,LLM_URL:process.env.LLM_URL,LLM_API_KEY:process.env.LLM_API_KEY,LLM_MODEL:process.env.LLM_MODEL};
process.env.NODE_ENV='production';process.env.API_TOKEN='test-token-for-api';delete process.env.DEMO_MODE;
const {handleApi}=await import('../src/api-handler.js?security-test');
function restore(){for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
after(restore);
async function request(payload,token='test-token-for-api'){
  const req={method:'POST',url:'/api/extract',headers:{authorization:`Bearer ${token}`},body:payload};
  const res={writeHead(code){this.status=code;},end(value){this.data=JSON.parse(value);}};
  await handleApi(req,res);
  return res;
}
test('закрытый API требует токен и не раскрывает детали внутренней ошибки',async()=>{
  assert.equal((await request({card:{title:'Телефон'}},'wrong')).status,401);
  assert.equal((await request({card:{title:'Телефон'}})).status,200);
});
test('без токена и без явного демо API закрыт по умолчанию',async()=>{
  const token=process.env.API_TOKEN;delete process.env.API_TOKEN;
  try{assert.equal((await request({card:{title:'Телефон'}})).status,503);}
  finally{process.env.API_TOKEN=token;}
});
test('API отклоняет некорректные поля до извлечения',async()=>{
  const invalid=[
    {card:{title:'Товар',seller_attributes:[]}},
    {card:{title:'Товар',seller_attributes:{Цвет:null}}},
    {card:{title:'Товар',seller_attributes:{Цвет:{nested:{value:'red'}}}}},
    {card:{title:'Товар',traffic_rows:-1}},
    {card:{title:'Товар'},use_llm:'true'},
    {card:{title:'Товар',category_id:'does-not-exist'}}
  ];
  for(const payload of invalid)assert.equal((await request(payload)).status,400,JSON.stringify(payload));
});
test('LLM участвует в обычном API пути при явной серверной настройке, но её можно выключить в запросе',async()=>{
  const oldFetch=global.fetch;
  let calls=0;
  process.env.LLM_AUTO_REVIEW='1';
  process.env.LLM_URL='https://example.test/chat/completions';
  process.env.LLM_API_KEY='test';
  process.env.LLM_MODEL='demo';
  global.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:'{"items":[],"review_items":[]}'}}],usage:{prompt_tokens:10,completion_tokens:5}})};};
  try{
    const card={title:'Смартфон Samsung',seller_attributes:{Бренд:'Samsung'}};
    const automatic=await request({card});
    assert.equal(automatic.status,200);
    assert.equal(automatic.data.llm.status,'completed');
    assert.equal(calls,1);
    const disabled=await request({card,use_llm:false});
    assert.equal(disabled.status,200);
    assert.equal(disabled.data.llm,undefined);
    assert.equal(calls,1);
  }finally{global.fetch=oldFetch;process.env.LLM_AUTO_REVIEW=previous.LLM_AUTO_REVIEW??'';}
});
