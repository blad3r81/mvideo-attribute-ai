import test,{after} from 'node:test';
import assert from 'node:assert/strict';

const previous={API_TOKEN:process.env.API_TOKEN,DEMO_MODE:process.env.DEMO_MODE};
process.env.API_TOKEN='private-integration-token';
process.env.DEMO_MODE='1';
const {handleApi}=await import('../src/api-handler.js?demo-security');
after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
async function request(url,token,payload={card:{title:'Смартфон Samsung 256 GB black'}}){
  const req={method:'POST',url,headers:token?{authorization:`Bearer ${token}`}:{},socket:{remoteAddress:'test-demo'},body:payload};
  const res={writeHead(code){this.status=code;},end(value){this.data=JSON.parse(value);}};
  await handleApi(req,res);
  return res;
}
test('публичный предпросмотр не открывает закрытый API',async()=>{
  assert.equal((await request('/api/extract')).status,401);
  assert.equal((await request('/api/extract','private-integration-token')).status,200);
  assert.equal((await request('/api/preview')).status,200);
});
test('публичный предпросмотр ограничивает размер и частоту запросов',async()=>{
  assert.equal((await request('/api/preview',null,{card:{title:'Смартфон',description:'x'.repeat(100000)}})).status,413);
  let limited=false;
  for(let index=0;index<61;index++)if((await request('/api/preview')).status===429){limited=true;break;}
  assert.equal(limited,true);
});
