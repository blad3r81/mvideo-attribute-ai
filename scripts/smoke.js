import assert from 'node:assert/strict';
import {extract} from '../src/catalog-extractor.js';

const base=process.env.BASE_URL??'http://127.0.0.1:4174';
const headers={'content-type':'application/json',...(process.env.API_TOKEN?{authorization:`Bearer ${process.env.API_TOKEN}`}:{})};
const get=path=>fetch(base+path,{headers,signal:AbortSignal.timeout(15000)});
const post=card=>fetch(base+(process.env.API_TOKEN?'/api/extract':'/api/preview'),{method:'POST',headers,body:JSON.stringify({card}),signal:AbortSignal.timeout(15000)});
function grounded(result,card){
  for(const item of Object.values(result.attributes??{}))if(item.status==='accepted'){
    assert.ok(item.evidence?.text,`${item.attribute}: нет цитаты`);
    const field=item.evidence.field;
    const source=field==='title'||field==='description'?card[field]:card.seller_attributes?.[field.slice('seller_attributes.'.length)];
    assert.ok(String(source).includes(item.evidence.text),`${item.attribute}: цитата не найдена в источнике`);
    assert.ok(item.confidence>=0&&item.confidence<=1);
  }
}
const health=await get('/api/health');assert.equal(health.status,200,'health');
const schema=await get('/api/schema');assert.equal(schema.status,200,'schema');
const demo=await get('/api/demo');assert.equal(demo.status,200,'demo');
const cards=await demo.json();assert.ok(Array.isArray(cards));
const results=[];
const sample=[...cards.slice(0,4),...cards.filter(card=>/смартфон/i.test(card.category_name??'')).slice(0,1)];
for(const card of sample){
  const response=await post(card);assert.equal(response.status,200,`SKU ${card.id}`);
  const result=await response.json();assert.equal(result.id,String(card.id));
  assert.deepEqual(result.attributes,extract(card).attributes);
  grounded(result,card);
  results.push({id:card.id,accepted:Object.values(result.attributes).filter(x=>x.status==='accepted').length});
}
const manual={title:'Смартфон Samsung 256 GB black',description:'Экран 6,7 дюйма',seller_attributes:{Цвет:'black','Объём памяти':'256 GB'}};
const response=await post(manual);assert.equal(response.status,200);
const result=await response.json();grounded(result,manual);
assert.equal(result.attributes.brand.value,'Samsung');
assert.equal(result.attributes.storage_gb.value,256);
assert.equal(result.attributes.color.value,'чёрный');
assert.equal((await post({})).status,400);
assert.equal((await post({title:{bad:true}})).status,400);
assert.equal((await post({title:'Смартфон',description:'x'.repeat(1_100_000)})).status,413);
console.log(JSON.stringify({status:'ok',base,demo_cards_checked:results.length,results,manual_fields:['brand','storage_gb','color'],invalid_requests_rejected:3},null,2));
