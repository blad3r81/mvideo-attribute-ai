import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';

const [goldPath,predPath]=process.argv.slice(2);
if(!goldPath||!predPath){console.error('Usage: node scripts/evaluate.js gold.json predictions_full.jsonl.gz');process.exit(2);}
const gold=JSON.parse(fs.readFileSync(goldPath,'utf8'));
if(!Array.isArray(gold)||!gold.length)throw Error('Gold must be a nonempty JSON array');
const seen=new Set();
for(const row of gold){
  if(!row||row.id===undefined||seen.has(String(row.id)))throw Error(`Missing or duplicate gold ID ${row?.id}`);
  seen.add(String(row.id));
  if(!row.attributes||typeof row.attributes!=='object'||Array.isArray(row.attributes)||!Object.keys(row.attributes).length)throw Error(`Gold attributes missing for ${row.id}`);
  if(Object.values(row.attributes).some(value=>value==='__UNLABELED__'))throw Error(`Unlabeled gold card ${row.id}`);
}
const required=new Set(gold.map(x=>String(x.id)));
const predictions=new Map();
if(predPath.endsWith('.jsonl.gz')){
  const stream=fs.createReadStream(predPath).pipe(zlib.createGunzip());
  for await(const line of readline.createInterface({input:stream,crlfDelay:Infinity})){
    if(!line)continue;
    const row=JSON.parse(line);
    if(required.has(String(row.id))){
      if(predictions.has(String(row.id)))throw Error(`Duplicate prediction ID ${row.id}`);
      predictions.set(String(row.id),row);
    }
  }
}else{
  for(const row of JSON.parse(fs.readFileSync(predPath,'utf8')))if(required.has(String(row.id))){
    if(predictions.has(String(row.id)))throw Error(`Duplicate prediction ID ${row.id}`);
    predictions.set(String(row.id),row);
  }
}
const clean=x=>JSON.stringify(x??null).toLocaleLowerCase();
const stats=new Map();
const calibration=Array.from({length:10},(_,index)=>({bin:index,n:0,correct:0,confidence_sum:0}));
for(const card of gold){
  const prediction=predictions.get(String(card.id));
  if(!prediction)throw Error(`No prediction for gold ID ${card.id}`);
  if(prediction.status==='error')throw Error(`Prediction failed for gold ID ${card.id}`);
  const weight=Number.isFinite(Number(card.traffic_rows))&&Number(card.traffic_rows)>0?Number(card.traffic_rows):1;
  for(const [name,expected] of Object.entries(card.attributes??{})){
    const keys=['overall',`attribute:${name}`,`category:${card.category??'unknown'}:__all__`,`category:${card.category??'unknown'}:${name}`,`seller:${card.seller_id??'unknown'}:${name}`];
    const item=prediction.attributes?.[name];
    const actual=item?.status==='accepted'?item.value:null;
    const expectedPresent=expected!==null&&expected!=='';
    if(actual!==null&&Number.isFinite(Number(item.confidence))){
      const score=Math.max(0,Math.min(1,Number(item.confidence)));
      const bucket=calibration[Math.min(9,Math.floor(score*10))];
      bucket.n++;bucket.confidence_sum+=score;
      if(expectedPresent&&clean(actual)===clean(expected))bucket.correct++;
    }
    for(const key of keys){
      const s=stats.get(key)??{tp:0,fp:0,fn:0,total:0,filled:0,wtp:0,wfp:0,wfn:0,wtotal:0,wfilled:0};
      s.total++;s.wtotal+=weight;
      if(actual!==null){s.filled++;s.wfilled+=weight;}
      if(expectedPresent&&clean(actual)===clean(expected)){s.tp++;s.wtp+=weight;}
      else{if(actual!==null){s.fp++;s.wfp+=weight;}if(expectedPresent){s.fn++;s.wfn+=weight;}}
      stats.set(key,s);
    }
  }
}
const rows=[...stats].map(([slice,s])=>({slice,n:s.total,
  precision:s.tp+s.fp?s.tp/(s.tp+s.fp):null,
  recall:s.tp+s.fn?s.tp/(s.tp+s.fn):null,
  f1:2*s.tp+s.fp+s.fn?2*s.tp/(2*s.tp+s.fp+s.fn):null,
  coverage:s.total?s.filled/s.total:null,
  traffic_weighted_precision:s.wtp+s.wfp?s.wtp/(s.wtp+s.wfp):null,
  traffic_weighted_recall:s.wtp+s.wfn?s.wtp/(s.wtp+s.wfn):null,
  traffic_weighted_f1:2*s.wtp+s.wfp+s.wfn?2*s.wtp/(2*s.wtp+s.wfp+s.wfn):null,
  traffic_weighted_coverage:s.wtotal?s.wfilled/s.wtotal:null,
  tp:s.tp,fp:s.fp,fn:s.fn}));
const perAttribute=rows.filter(row=>row.slice.startsWith('attribute:')&&row.f1!==null);
const macroF1=perAttribute.length?perAttribute.reduce((sum,row)=>sum+row.f1,0)/perAttribute.length:null;
const perCategory=rows.filter(row=>row.slice.startsWith('category:')&&row.slice.endsWith(':__all__'));
const categoryMacroF1=perCategory.filter(row=>row.f1!==null);
const cardsPerCategory=new Map();
for(const card of gold){const key=String(card.category??'unknown');cardsPerCategory.set(key,(cardsPerCategory.get(key)??0)+1);}
const calibrationRows=calibration.filter(bucket=>bucket.n).map(bucket=>({bin:bucket.bin,n:bucket.n,mean_confidence:bucket.confidence_sum/bucket.n,accuracy:bucket.correct/bucket.n}));
const acceptedTotal=calibrationRows.reduce((sum,bucket)=>sum+bucket.n,0);
const ece=acceptedTotal?calibrationRows.reduce((sum,bucket)=>sum+bucket.n*Math.abs(bucket.mean_confidence-bucket.accuracy),0)/acceptedTotal:null;
console.log(JSON.stringify({gold_cards:gold.length,overall:rows.find(row=>row.slice==='overall'),macro_f1_attributes:macroF1,macro_f1_categories:categoryMacroF1.length?categoryMacroF1.reduce((sum,row)=>sum+row.f1,0)/categoryMacroF1.length:null,category_summary:perCategory.map(row=>{const category=row.slice.slice(9,-8),cards=cardsPerCategory.get(category)??0;return {...row,cards,small_sample:cards<30};}),calibration:{ece,bins:calibrationRows},note:'Metrics describe agreement with the supplied labels. Independent human gold is required for an unbiased quality claim. Null means absent or unconfirmed attribute. n counts labeled fields, not cards. Small category slices are descriptive, not reliable population estimates. traffic_rows is a click-frequency proxy, not impressions or CTR.',rows},null,2));
