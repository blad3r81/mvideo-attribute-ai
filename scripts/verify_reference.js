import fs from 'node:fs';
import {getCatalog,requiredForCategory} from '../src/catalog-extractor.js';

const cards=JSON.parse(fs.readFileSync(new URL('../data/holdout_cards.json',import.meta.url)));
const reference=JSON.parse(fs.readFileSync(new URL('../data/holdout_assistant_reference.json',import.meta.url)));
const demo=JSON.parse(fs.readFileSync(new URL('../data/real_cards.json',import.meta.url)));
const catalog=getCatalog();
if(cards.length!==30||reference.length!==cards.length)throw Error('Expected 30 complete reference cards');
const demoIds=new Set(demo.map(card=>String(card.id)));
const byId=new Map(reference.map(row=>[String(row.id),row]));
if(byId.size!==reference.length)throw Error('Duplicate reference ID');
const groups=new Map();
let fields=0;
for(const card of cards){
  const id=String(card.id),category=String(card.category_id),row=byId.get(id);
  if(demoIds.has(id)||!row||String(row.category)!==category)throw Error(`Missing, changed, or demo card ${id}`);
  const schema=catalog.categories?.[category];
  if(!schema)throw Error(`Unknown category ${category}`);
  const expected=requiredForCategory(schema,catalog).sort();
  const actual=Object.keys(row.attributes??{}).sort();
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error(`Incomplete required fields for ${id}`);
  for(const [key,value] of Object.entries(row.attributes)){
    if(value==='__UNLABELED__'||(value!==null&&(typeof value!=='string'&&typeof value!=='number')))
      throw Error(`Invalid label ${id}:${key}`);
    fields++;
  }
  groups.set(category,(groups.get(category)??0)+1);
}
if(fields!==190||groups.size!==3||[...groups.values()].some(n=>n!==10))throw Error('Unexpected reference coverage');
console.log(JSON.stringify({cards:cards.length,fields,categories:Object.fromEntries(groups),provenance:'assistant-curated from frozen source text; not independent human gold'}));
