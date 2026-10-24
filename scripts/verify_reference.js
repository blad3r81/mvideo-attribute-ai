import fs from 'node:fs';
import {getCatalog,requiredForCategory} from '../src/catalog-extractor.js';

const [cardsPath='data/holdout_cards.json',referencePath='data/holdout_assistant_reference.json',...extraExclusions]=process.argv.slice(2);
const cards=JSON.parse(fs.readFileSync(cardsPath,'utf8'));
const reference=JSON.parse(fs.readFileSync(referencePath,'utf8'));
const excludedPaths=['data/real_cards.json',...extraExclusions];
const catalog=getCatalog();
if(!Array.isArray(cards)||!cards.length||!Array.isArray(reference)||reference.length!==cards.length)
  throw Error('Expected a nonempty card set and exactly one reference row per card');
const excludedIds=new Set(excludedPaths.flatMap(path=>JSON.parse(fs.readFileSync(path,'utf8')).map(card=>String(card.id))));
const cardIds=new Set(cards.map(card=>String(card.id)));
if(cardIds.size!==cards.length)throw Error('Duplicate card ID');
const byId=new Map(reference.map(row=>[String(row.id),row]));
if(byId.size!==reference.length)throw Error('Duplicate reference ID');
const groups=new Map();
let fields=0;
for(const card of cards){
  const id=String(card.id),category=String(card.category_id),row=byId.get(id);
  if(excludedIds.has(id)||!row||String(row.category)!==category)throw Error(`Missing, changed, or excluded card ${id}`);
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
if(byId.size!==cardIds.size)throw Error('Extra reference row');
console.log(JSON.stringify({cards:cards.length,fields,categories:Object.fromEntries(groups),provenance:'assistant-curated from source text; not independent human gold'}));
