// Paid VM smoke test. Run explicitly; never as part of node --test.
import fs from 'node:fs';

const base=process.env.API_BASE??'http://127.0.0.1:8000';
const count=Number(process.argv[2]??8);
if(!Number.isSafeInteger(count)||count<1||count>12)throw Error('Count must be 1..12');
const capabilities=await (await fetch(`${base}/api/capabilities`)).json();
if(!capabilities.llm_available||!capabilities.llm_default)throw Error('Configured LLM default is required');
const cards=JSON.parse(fs.readFileSync(new URL('../data/real_cards.json',import.meta.url)));
const post=async(card,use_llm)=>{
  const payload=use_llm===undefined?{card}:{card,use_llm};
  const response=await fetch(`${base}/api/preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error(`HTTP ${response.status} for SKU ${card.id}`);
  return response.json();
};
const selected=[],used=new Set();
for(const card of cards){
  const category=String(card.category_id);
  if(used.has(category))continue;
  const rules=await post(card,false);
  if(!Object.values(rules.attributes??{}).some(item=>item.status==='review'))continue;
  used.add(category);selected.push({card,rules});
  if(selected.length===count)break;
}
if(selected.length<count)throw Error(`Only ${selected.length} distinct categories with review fields available`);
const rows=[];
for(const {card,rules} of selected){
  const hybrid=await post(card);
  if(JSON.stringify(rules.attributes)!==JSON.stringify(hybrid.attributes))throw Error(`LLM modified accepted attributes of SKU ${card.id}`);
  if(hybrid.llm?.status!=='completed')throw Error(`LLM did not complete on SKU ${card.id}: ${hybrid.llm?.status}`);
  for(const item of hybrid.llm.suggestions??[]){
    const source=item.source==='title'||item.source==='description'?card[item.source]:card.seller_attributes?.[item.source?.slice(18)];
    if(item.status!=='review'||typeof source!=='string'||!source.includes(item.evidence?.text))throw Error(`Unverified suggestion on SKU ${card.id}`);
  }
  rows.push({sku:String(card.id),category:String(card.category_id),llm:hybrid.llm.status,checks:hybrid.llm.review_checks?.length??0,suggestions:hybrid.llm.suggestions?.length??0,usage:hybrid.llm.usage??null});
}
console.log(JSON.stringify({cards:rows.length,completed:rows.filter(row=>row.llm==='completed').length,review_checks:rows.reduce((sum,row)=>sum+row.checks,0),suggestions:rows.reduce((sum,row)=>sum+row.suggestions,0),rows},null,2));
