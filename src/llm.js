import {getRuleSchema,getCatalog} from './data-loader.js';
import {canonicalKey} from './catalog-extractor.js';

const fieldHints={
  brand:/бренд|производ|brand|manufacturer/iu,model:/модель|model/iu,
  storage_gb:/накоп|памят|storage|ssd|hdd/iu,ram_gb:/озу|оператив|\bram\b/iu,
  processor:/процессор|\bcpu\b|processor/iu,screen_inches:/диагонал|экран|screen/iu,
  battery_mah:/аккум|батар|[её]мкост|battery|\bmah\b/iu,
  color:/цвет|color/iu,size:/размер|size/iu,material:/материал|состав|material/iu
};
const batteryEvidence=/(?:аккум|батар|[её]мкост|battery|\bmah\b).{0,80}\d{3,5}|\d{3,5}.{0,80}(?:аккум|батар|[её]мкост|battery|\bmah\b|мА\s*[·*]?\s*ч)/iu;

// Optional second stage. A configured endpoint must accept OpenAI-compatible chat completions.
// Suggestions stay in review until confidence is calibrated on a real gold set.
export function llmConfig(env=process.env){
  const base=env.OPENAI_BASE_URL?.replace(/\/+$/,'');
  const requestedTimeout=Number(env.LLM_TIMEOUT_MS);
  return {
    url:env.LLM_URL||(base?`${base}/chat/completions`:undefined),
    key:env.LLM_API_KEY||env.OPENAI_API_KEY,
    model:env.LLM_MODEL,
    timeoutMs:Number.isFinite(requestedTimeout)&&requestedTimeout>=1000&&requestedTimeout<=120000?requestedTimeout:8000
  };
}

export function llmAvailable(env=process.env){
  const {url,key,model}=llmConfig(env);
  return Boolean(url&&key&&model);
}

export async function suggestMissing(card,result,{beforeCall}={}){
  const schema=getRuleSchema();
  const {url,key,model,timeoutMs}=llmConfig();
  if(!url || !key || !model) return {...result,llm:{status:'not_configured'}};
  const missing=result.missing_required.filter(key=>result.attributes[key]?.status==='missing');
  const text=[card.title,card.description,...Object.entries(card.seller_attributes??{}).map(([name,value])=>`${name}: ${value}`)].join('\n');
  const allowed=missing.filter(key=>key!=='battery_mah'||batteryEvidence.test(text));
  const review=Object.entries(result.attributes).filter(([,item])=>item.status==='review').slice(0,20);
  if(!allowed.length&&!review.length) return {...result,llm:{status:missing.length?'skipped_no_evidence':'skipped_no_missing_required'}};
  const reviewFields=new Set(review.flatMap(([,item])=>(item.candidates??[item]).map(x=>x.source).filter(x=>x?.startsWith('seller_attributes.')).map(x=>x.slice(18))));
  const seller_attributes=Object.fromEntries(Object.entries(card.seller_attributes??{}).filter(([name])=>reviewFields.has(name)||allowed.some(key=>!fieldHints[key]||fieldHints[key].test(name))));
  const category=getCatalog().categories?.[String(result.category?.value??'')];
  const optionsFor=key=>Object.entries(category?.allowed_values??{}).find(([name])=>canonicalKey(name)===key)?.[1];
  const definitions=Object.fromEntries(allowed.map(key=>[key,schema.attributes[key]??{type:'enum',values:(optionsFor(key)??[]).map(option=>typeof option==='string'?option:option.value)}]));
  const prompt={card:{title:String(card.title??'').slice(0,500),description:String(card.description??'').slice(0,8000),seller_attributes:Object.fromEntries(Object.entries(seller_attributes).map(([k,v])=>[k,String(v).slice(0,500)]))},allowed_attributes:allowed,definitions,review_attributes:Object.fromEntries(review.map(([key,item])=>[key,{reason:item.reason,candidates:(item.candidates??[item]).slice(0,3).map(x=>({value:x.value,raw:x.raw,source:x.source}))}]))};
  await beforeCall?.();
  const response=await fetch(url,{method:'POST',signal:AbortSignal.timeout(timeoutMs),headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model,temperature:0,max_tokens:Math.min(1800,512+review.length*65),response_format:{type:'json_object'},messages:[
    {role:'system',content:'Return JSON object with items and review_items arrays. For items, extract only explicitly stated allowed_attributes as {attribute,value,field,quote}; omit unknown values. For review_items, examine only review_attributes and return {attribute,verdict,field,quote} where verdict is supported, unsupported, or uncertain. Supported means the candidate is explicitly present in that exact source field; this does not validate an allowed-value dictionary. Quote must be an exact substring of field, at most 80 characters. Never invent a value or source. At most one response per attribute. If none, return empty arrays.'},
    {role:'user',content:JSON.stringify(prompt)}
  ]})});
  if(!response.ok) throw new Error(`LLM HTTP ${response.status}`);
  const declared=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(declared)&&declared>256_000)throw new Error('LLM response too large');
  let body;
  if(response.body?.getReader){
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>256_000){await reader.cancel();throw new Error('LLM response too large');}
      chunks.push(value);
    }
    body=JSON.parse(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))).toString('utf8'));
  }else body=await response.json();
  let parsed;
  try{parsed=JSON.parse(body.choices?.[0]?.message?.content??'{}');}
  catch{return {...result,llm:{status:body.choices?.[0]?.finish_reason==='length'?'truncated':'invalid_response',suggestions:[],review_checks:[],usage:body.usage??null}};}
  const suggestions=[];
  for(const item of Array.isArray(parsed.items)?parsed.items:[]) {
    if(!allowed.includes(item.attribute) || typeof item.quote!=='string' || !item.quote.trim() || item.value===null || item.value===undefined) continue;
    let source;
    if(item.field==='title'||item.field==='description') source=card[item.field];
    else if(typeof item.field==='string'&&item.field.startsWith('seller_attributes.')) source=card.seller_attributes?.[item.field.slice(18)];
    if(typeof source!=='string'||!source.includes(item.quote)) continue;
    const def=definitions[item.attribute];
    const categoryOptions=optionsFor(item.attribute);
    let canonical=item.value;
    if(categoryOptions){
      const option=categoryOptions.find(option=>{
        const variants=typeof option==='string'?[option]:[option.value,...(option.aliases??[])];
        return variants.some(value=>String(value).toLocaleLowerCase()===String(item.value).toLocaleLowerCase()&&item.quote.toLocaleLowerCase().includes(String(value).toLocaleLowerCase()));
      });
      if(!option)continue;
      canonical=typeof option==='string'?option:option.value;
    }else if(!item.quote.toLocaleLowerCase().includes(String(item.value).toLocaleLowerCase()))continue;
    if(def.type==='enum' && !def.values.includes(canonical)) continue;
    if(def.type==='number' && (!Number.isFinite(Number(item.value))||Number(item.value)<=0)) continue;
    if(item.attribute==='model'){
      const brand=result.attributes.brand;
      const knownBrands=brand?.candidates?.map(x=>x.value)??(brand?.value?[brand.value]:[]);
      if(knownBrands.some(value=>String(value).toLocaleLowerCase()===String(item.value).toLocaleLowerCase())) continue;
    }
    const value=def.type==='number'?Number(item.value):canonical;
    suggestions.push({attribute:item.attribute,value,source:item.field,evidence:{field:item.field,text:item.quote},method:'llm_suggestion',status:'review',confidence:null,reason:'requires_gold_calibration'});
  }
  const reviewChecks=[];
  for(const item of Array.isArray(parsed.review_items)?parsed.review_items:[]){
    const target=review.find(([key])=>key===item.attribute);
    const verdict=({supported:'supported',unsupported:'unsupported',uncertain:'uncertain','поддерживается':'supported','не поддерживается':'unsupported','неясно':'uncertain'})[String(item.verdict).toLocaleLowerCase()];
    if(!target||!verdict||typeof item.quote!=='string'||!item.quote.trim()||item.quote.length>80)continue;
    const candidates=target[1].candidates??[target[1]];
    const candidate=candidates.find(x=>typeof x.raw==='string'&&(x.raw.includes(item.quote)||item.quote.includes(x.raw)));
    if(!candidate)continue;
    const field=candidate.source;
    const source=field==='title'||field==='description'?card[field]:field?.startsWith('seller_attributes.')?card.seller_attributes?.[field.slice(18)]:null;
    if(typeof source!=='string'||!source.includes(item.quote))continue;
    reviewChecks.push({attribute:item.attribute,verdict,source:field,evidence:{field,text:item.quote},dictionary_verified:false,status:'review',method:'llm_review'});
  }
  return {...result,llm:{status:'completed',suggestions,review_checks:reviewChecks,reviewed_count:review.length,review_remaining:Object.values(result.attributes).filter(x=>x.status==='review').length-review.length,usage:body.usage??null}};
}
