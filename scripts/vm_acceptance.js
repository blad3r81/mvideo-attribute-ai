import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extract} from '../src/catalog-extractor.js';

const base=process.env.BASE_URL??'https://tochka-sborki-2026-team-013.hub.gigaschool.ru';
const cards=JSON.parse(fs.readFileSync(new URL('../data/real_cards.json',import.meta.url)));
const byId=new Map(cards.map(card=>[card.id,card]));
const checks=[];
const post=async (payload,signal)=>fetch(`${base}${process.env.API_TOKEN?'/api/extract':'/api/preview'}`,{method:'POST',headers:{'content-type':'application/json',...(process.env.API_TOKEN?{authorization:`Bearer ${process.env.API_TOKEN}`}:{})},body:JSON.stringify(payload),signal});
async function check(name,fn){
  const started=performance.now();
  try { const detail=await fn(); checks.push({name,passed:true,ms:Math.round(performance.now()-started),...detail}); }
  catch(error){ checks.push({name,passed:false,ms:Math.round(performance.now()-started),error:error.message}); }
}
function grounded(result,card){
  for(const item of Object.values(result.attributes??{}))if(item.status==='accepted'){
    assert.ok(item.evidence?.text,`${item.attribute}: no evidence`);
    const field=item.evidence.field;
    const source=field==='title'||field==='description'?card[field]:card.seller_attributes?.[field.slice('seller_attributes.'.length)];
    assert.ok(String(source).includes(item.evidence.text),`${item.attribute}: quote not in source`);
  }
}
async function realSku(id){
  const card=byId.get(id);assert.ok(card);
  const response=await post({card});assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.id,id);
  assert.deepEqual(result.attributes,extract(card).attributes);
  grounded(result,card);
  return {accepted:Object.values(result.attributes).filter(item=>item.status==='accepted').length,review:Object.values(result.attributes).filter(item=>item.status==='review').length};
}

await check('01 endpoints and dataset counts',async()=>{
  const [health,stats,schema,demo,ui,presentation]=await Promise.all(['/api/health','/api/stats','/api/schema?category_id=914','/api/demo?q=30087001','/','/presentation'].map(path=>fetch(base+path)));
  for(const response of [health,stats,schema,demo,ui,presentation])assert.equal(response.status,200,response.url);
  const h=await health.json(),s=await stats.json(),d=await demo.json();
  assert.equal(h.demo_cards,110);assert.equal(s.sku_desc_rows,1177200);assert.equal(d[0].id,'30087001');
  return {demo_cards:h.demo_cards,sku_with_description:s.sku_desc_rows};
});
await check('02 real smartphone SKU',()=>realSku('30087001'));
await check('03 real laptop SKU',()=>realSku('30072187'));
await check('04 real TV SKU',()=>realSku('400000387'));
await check('05 real clothing SKU',()=>realSku('401253899'));
await check('06 bilingual color and EU size',async()=>{
  const card={title:'Футболка красная хлопок 100% размер EU 42',description:'Размер EU 42; Цвет red',seller_attributes:{'Размер производителя':'EU 42','Цвет':'red'}};
  const result=await(await post({card})).json();assert.equal(result.attributes.color.value,'красный');assert.deepEqual(result.attributes.size.value,{system:'EU',value:'42'});grounded(result,card);
  return {color:result.attributes.color.value,size:result.attributes.size.value};
});
await check('07 conflicting seller values',async()=>{
  const card={title:'Смартфон Samsung 256 GB',seller_attributes:{Цвет:'red',Цвет_search:'black'}};
  const result=await(await post({card})).json();assert.equal(result.attributes.color.status,'review');return {reason:result.attributes.color.reason};
});
await check('08 range is not exact value',async()=>{
  const card={title:'Смартфон Samsung',seller_attributes:{'Емкость аккумулятора':'4000-5000 мАч'}};
  const result=await(await post({card})).json();assert.notEqual(result.attributes.battery_mah.status,'accepted');return {status:result.attributes.battery_mah.status};
});
await check('09 unknown category rejected',async()=>{
  const response=await post({card:{title:'Смартфон',category_id:'999999999'}});assert.equal(response.status,400);return {};
});
await check('10 malformed and oversized requests rejected',async()=>{
  assert.equal((await post({card:{}})).status,400);
  assert.equal((await post({card:{title:{text:'wrong'}}})).status,400);
  assert.equal((await post({card:{title:'Смартфон',description:'x'.repeat(1_100_000)}})).status,413);
  return {};
});
await check('11 unknown price stays review',async()=>{
  const card={title:'Телевизор Samsung',seller_attributes:{Цена:'49990 ₽'}};
  const result=await(await post({card})).json();assert.notEqual(result.attributes.Цена?.status,'accepted');return {status:result.attributes.Цена?.status??'absent'};
});

const llmChecks=[];
if(process.argv.includes('--llm')){
  for(const [name,card,expected] of [
    ['12 LLM reviews other uncertain fields without battery evidence',byId.get('30087001'),'completed'],
    ['13 LLM on real laptop',byId.get('30072074'),'completed'],
    ['14 LLM on manual smartphone',{title:'Смартфон Samsung Galaxy A55 256 ГБ черный',description:'Экран 6,6 дюйма. Аккумулятор емкостью 5000 миллиампер-часов.',seller_attributes:{Бренд:'Samsung','Объем памяти':'256 ГБ'}},'completed'],
    ['15 LLM on manual laptop',{title:'Ноутбук Lenovo 16 GB RAM 512 GB 15.6 дюйма черный',description:'Процессор Intel N100',seller_attributes:{Бренд:'Lenovo'}},'completed']
  ])await check(name,async()=>{
    const plain=await(await post({card})).json();assert.ok(plain.missing_required.length,'no missing required field');
    const response=await post({card,use_llm:true},AbortSignal.timeout(45000));assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.llm?.status,expected);assert.deepEqual(result.attributes,plain.attributes);
    for(const item of result.llm.suggestions??[]){assert.equal(item.status,'review');assert.ok(plain.missing_required.includes(item.attribute));const source=item.source==='title'||item.source==='description'?card[item.source]:card.seller_attributes?.[item.source.slice('seller_attributes.'.length)];assert.ok(String(source).includes(item.evidence.text));}
    const detail={missing:plain.missing_required,llm_status:result.llm.status,suggestions:result.llm.suggestions?.length??0,usage:result.llm.usage};if(expected==='completed')llmChecks.push(detail);return detail;
  });
}

const concurrency=10,total=100,latencies=[],errors=[];
let next=0;
await Promise.all(Array.from({length:concurrency},async()=>{
  while(next<total){
    const i=next++,start=performance.now();
    try{
      const card=byId.get(['30087001','30072187','400000387','401253899'][i%4]);
      const response=await post({card},AbortSignal.timeout(15000));assert.equal(response.status,200);
      const data=await response.json();assert.equal(data.id,card.id);
      latencies.push(performance.now()-start);
    }catch(error){errors.push({i,error:error.message});}
  }
}));
latencies.sort((a,b)=>a-b);
const percentile=p=>latencies[Math.min(latencies.length-1,Math.ceil(latencies.length*p)-1)]??null;
const stress={requests:total,concurrency,success:latencies.length,failures:errors.length,p50_ms:Math.round(percentile(.5)),p95_ms:Math.round(percentile(.95)),max_ms:Math.round(percentile(1)),errors:errors.slice(0,5)};
const report={time:new Date().toISOString(),base,checks,stress,llm_calls:llmChecks.length,passed:checks.every(check=>check.passed)&&!errors.length};
fs.writeFileSync(new URL('../reports/vm_acceptance.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
