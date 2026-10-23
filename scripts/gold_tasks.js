// Prepare unlabeled, category-balanced cards from the case schema, not model predictions.
import fs from 'node:fs';
import path from 'node:path';
import {getCatalog,canonicalKey,requiredForCategory} from '../src/catalog-extractor.js';

const [cardsPath='data/real_cards.json',outputPath='work/gold_tasks.json',limitRaw='3',scope='all']=process.argv.slice(2);
const limit=Number(limitRaw);
if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('per-category limit must be 1..100');
if(!['all','required'].includes(scope))throw Error('scope must be all or required');
const cards=JSON.parse(fs.readFileSync(cardsPath,'utf8'));
const catalog=getCatalog();
if(!Array.isArray(cards))throw Error('cards must be a JSON array');
const groups=new Map();
for(const card of cards){
  if(card.id===undefined)continue;
  const category=String(card.category_id??'unknown');
  if(!groups.has(category))groups.set(category,[]);
  groups.get(category).push(card);
}
const tasks=[];
for(const [category,items] of groups){
  const schema=catalog.categories?.[category];
  if(!schema)continue;
  const required=requiredForCategory(schema,catalog);
  if(scope==='required'&&!required.length)continue;
  items.sort((a,b)=>Number(b.traffic_rows??0)-Number(a.traffic_rows??0)||String(a.id).localeCompare(String(b.id)));
  const count=Math.min(limit,items.length);
  const positions=new Set(Array.from({length:count},(_,index)=>count===1?0:Math.round(index*(items.length-1)/(count-1))));
  for(const index of positions){
    const card=items[index];
    const names=scope==='required'?required:[...(schema.search_attributes??[]).map(item=>canonicalKey(typeof item==='string'?item:item.name)),...required];
    tasks.push({id:String(card.id),category,seller_id:card.seller_id??null,traffic_rows:card.traffic_rows??null,title:card.title??'',description:card.description??'',seller_attributes:card.seller_attributes??{},attributes:Object.fromEntries([...new Set(names)].map(name=>[name,'__UNLABELED__']))});
  }
}
if(!tasks.length)throw Error('No matching cards for gold tasks');
fs.mkdirSync(path.dirname(outputPath),{recursive:true});
fs.writeFileSync(outputPath,JSON.stringify(tasks,null,2)+'\n');
console.log(`${tasks.length} unlabeled tasks in ${outputPath}; category groups: ${new Set(tasks.map(task=>task.category)).size}; scope: ${scope}`);
