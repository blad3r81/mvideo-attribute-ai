import fs from 'node:fs';
import {extract} from '../src/catalog-extractor.js';
import {llmAvailable,suggestMissing} from '../src/llm.js';

const args=process.argv.slice(2);
const explicitLlm=args.includes('--llm');
const rulesOnly=args.includes('--rules-only');
if(explicitLlm&&rulesOnly)throw Error('Choose either --llm or --rules-only');
const limitArg=args.find(arg=>arg.startsWith('--llm-limit='));
const positional=args.filter(arg=>!['--llm','--rules-only'].includes(arg)&&!arg.startsWith('--llm-limit='));
if(positional.length>2||positional.some(arg=>arg.startsWith('--')))throw Error('Usage: node scripts/predict.js [cards.json] [predictions.json] [--llm|--rules-only] [--llm-limit=N]');
const input=positional[0]??'data/real_cards.json';
const output=positional[1]??'data/real_predictions.json';
const useLlm=explicitLlm||(!rulesOnly&&process.env.LLM_AUTO_REVIEW==='1');
if(useLlm&&!llmAvailable())throw Error('LLM requested but endpoint, key, or model is not configured');
// Batch work can wait longer than the interactive API. A caller can still override this.
if(useLlm&&!process.env.LLM_TIMEOUT_MS)process.env.LLM_TIMEOUT_MS='30000';
const maxCalls=Number(limitArg?.slice('--llm-limit='.length)??process.env.LLM_DAILY_LIMIT??30);
if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>10000)throw Error('LLM call limit must be an integer from 1 to 10000');
const cards=JSON.parse(fs.readFileSync(input,'utf8'));
if(!Array.isArray(cards)||!cards.length)throw Error('Input must be a nonempty array of cards');
let failed=0,calls=0;
const predictions=[];
for(const [index,card] of cards.entries()){
  try{
    let result=extract(card);
    if(useLlm){
      try{
        result=await suggestMissing(card,result,{beforeCall:()=>{
          if(calls>=maxCalls)throw Error('LLM_BATCH_LIMIT');
          calls++;
        }});
      }catch(error){
        result={...result,llm:{status:error.message==='LLM_BATCH_LIMIT'?'quota_exceeded':'unavailable',suggestions:[],review_checks:[]}};
        if(error.message!=='LLM_BATCH_LIMIT')console.warn(JSON.stringify({event:'batch_llm_failed',row:index+1,reason:error.name??'Error'}));
      }
    }
    predictions.push(result);
  }
  catch(error){
    failed++;
    console.warn(JSON.stringify({event:'batch_card_failed',row:index+1,reason:error.name??'Error'}));
    predictions.push({id:card?.id==null?null:String(card.id),input_row:index+1,status:'error',error:{code:'EXTRACTION_FAILED'},category:{},attributes:{},missing_required:[]});
  }
}
if(failed===cards.length)throw Error('No cards were extracted successfully');
fs.writeFileSync(output,JSON.stringify(predictions,null,2)+'\n','utf8');
console.log(`${predictions.length} cards, ${failed} failed, ${calls} LLM calls -> ${output}`);
