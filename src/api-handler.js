import {extract} from './catalog-extractor.js';
import {getCatalog,getDemo,getStats} from './data-loader.js';
import {suggestMissing,llmAvailable} from './llm.js';
import {timingSafeEqual} from 'node:crypto';
import {log} from './log.js';

const maxBytes=1_000_000;
const demoMode=process.env.DEMO_MODE==='1';
const calls=[];
const previewCalls=new Map();
function allowPreview(req){
  const now=Date.now(),ip=req.socket?.remoteAddress??'unknown';
  const recent=(previewCalls.get(ip)??[]).filter(time=>now-time<60_000);
  if(recent.length>=60){previewCalls.set(ip,recent);return false;}
  recent.push(now);previewCalls.set(ip,recent);
  if(previewCalls.size>1000)for(const [key,times] of previewCalls)if(times.at(-1)<now-60_000)previewCalls.delete(key);
  return true;
}
const requestedLimit=Number(process.env.LLM_DAILY_LIMIT);
const dailyLimit=Number.isSafeInteger(requestedLimit)&&requestedLimit>0&&requestedLimit<=10000?requestedLimit:60;
function allowedLlmCall(){
  const now=Date.now(),day=86_400_000;
  while(calls.length&&calls[0]<now-day)calls.shift();
  if(calls.length>=dailyLimit)return false;
  calls.push(now);return true;
}
function authenticated(req){
  const secret=process.env.API_TOKEN;
  if(!secret)return false;
  const token=req.headers?.authorization?.replace(/^Bearer\s+/i,'')??'';
  const a=Buffer.from(token),b=Buffer.from(secret);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function fail(message,status=400){const error=Error(message);error.status=status;throw error;}
function validateCard(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Ожидается объект card');
  for(const key of ['title','description'])if(input[key]!=null&&(typeof input[key]!=='string'||input[key].length>(key==='title'?500:100_000)))fail(`${key}: требуется строка допустимой длины`);
  for(const key of ['id','sku_id','category_id','category_name'])if(input[key]!=null&&(!['string','number'].includes(typeof input[key])||String(input[key]).length>200))fail(`${key}: неверное значение`);
  if(input.traffic_rows!=null&&(!Number.isSafeInteger(input.traffic_rows)||input.traffic_rows<0))fail('traffic_rows: требуется неотрицательное целое число');
  const seller=input.seller_attributes??{};
  if(!seller||typeof seller!=='object'||Array.isArray(seller))fail('seller_attributes должен быть объектом');
  const entries=Object.entries(seller);
  if(entries.length>300)fail('Слишком много полей продавца');
  if(entries.reduce((count,[,value])=>count+(Array.isArray(value)?value.length:1),0)>1000)fail('Слишком много значений в полях продавца');
  for(const [key,value] of entries){
    if(!key||key.length>150)fail('Неверное имя поля продавца');
    const values=Array.isArray(value)?value:[value];
    if(values.length>100||values.some(v=>typeof v!=='string'&&typeof v!=='number'&&!(v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.value==='string'&&(!v.unit||typeof v.unit==='string'))))fail(`Неверное значение поля продавца: ${key}`);
    if(values.some(v=>JSON.stringify(v).length>1000))fail(`Слишком длинное значение поля продавца: ${key}`);
  }
  if(!String(input.title??'').trim()&&!String(input.description??'').trim()&&!entries.length)fail('Карточка пуста');
}
const json=(res,code,value)=>{
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(value));
};
async function body(req,limit=maxBytes){
  if(req.body!==undefined){
    if(Buffer.byteLength(JSON.stringify(req.body))>limit)fail('Слишком большой запрос',413);
    return req.body;
  }
  const chunks=[];let bytes=0,tooLarge=false;
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>limit){tooLarge=true;break;}
    chunks.push(chunk);
  }
  if(tooLarge)fail('Слишком большой запрос',413);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}

export async function handleApi(req,res){
  try{
    const url=new URL(req.url,'http://localhost');
    const route=url.searchParams.get('route');
    const pathname=route?`/api/${route}`:url.pathname;
    if(req.method==='GET'&&pathname==='/api/health'){
      const catalog=getCatalog(),demo=getDemo();
      return json(res,200,{status:'ok',schema_version:catalog.version,demo_cards:demo.length});
    }
    const isPreview=demoMode&&pathname==='/api/preview'&&req.method==='POST';
    const publicDemo=demoMode&&req.method==='GET'&&['/api/stats','/api/schema','/api/demo','/api/capabilities'].includes(pathname);
    if(!isPreview&&!publicDemo){
      if(!process.env.API_TOKEN)return json(res,503,{error:'API_TOKEN не настроен'});
      if(!authenticated(req))return json(res,401,{error:'Требуется токен API'});
    }
    if(req.method==='GET'&&pathname==='/api/capabilities')return json(res,200,{llm_available:llmAvailable(),llm_default:process.env.LLM_AUTO_REVIEW==='1'&&llmAvailable()});
    if(req.method==='GET'&&pathname==='/api/stats')return json(res,200,getStats());
    if(req.method==='GET'&&pathname==='/api/schema'){
      const catalog=getCatalog();
      const id=url.searchParams.get('category_id');
      if(id)return catalog.categories?.[id]?json(res,200,{version:catalog.version,id,...catalog.categories[id]}):json(res,404,{error:'Категория не найдена'});
      return json(res,200,{version:catalog.version,category_count:Object.keys(catalog.categories??{}).length,usage:'/api/schema?category_id=914'});
    }
    if(req.method==='GET'&&pathname==='/api/demo'){
      const demo=getDemo();
      const query=(url.searchParams.get('q')??'').toLocaleLowerCase().trim();
      if(query.length>200)return json(res,400,{error:'Слишком длинный поисковый запрос'});
      const found=query?demo.filter(c=>(`${c.title} ${c.category_name??''} ${c.id}`).toLocaleLowerCase().includes(query)):demo;
      return json(res,200,found.slice(0,150));
    }
    if(req.method==='POST'&&(pathname==='/api/extract'||isPreview)){
      if(isPreview&&!allowPreview(req))return json(res,429,{error:'Слишком много запросов к демо. Повторите через минуту.'});
      const request=await body(req,isPreview?100_000:maxBytes);
      if(!request||typeof request!=='object'||Array.isArray(request))return json(res,400,{error:'Ожидается JSON-объект'});
      if(request.use_llm!==undefined&&typeof request.use_llm!=='boolean')return json(res,400,{error:'use_llm должен быть булевым значением'});
      const input=request.card;
      validateCard(input);
      const card={id:input.id??input.sku_id??'preview',title:String(input.title??''),description:String(input.description??''),seller_attributes:input.seller_attributes??{},category_id:input.category_id??null,category_name:input.category_name??null,traffic_rows:input.traffic_rows??null};
      const catalog=getCatalog();
      if(card.category_id!==null&&!catalog.categories?.[String(card.category_id)])return json(res,400,{error:'Неизвестный ID категории',category_id:card.category_id});
      let result=extract(card);
      if((request.use_llm??(process.env.LLM_AUTO_REVIEW==='1'))===true){
        try{result=await suggestMissing(card,result,{beforeCall:()=>{if(!allowedLlmCall())fail('Лимит вызовов LLM исчерпан. Извлечение без LLM доступно.',429);}});}
        catch(error){
          if(error.status===429){
            result={...result,llm:{status:'quota_exceeded',suggestions:[],review_checks:[]}};
            return json(res,200,result);
          }
          log('warn','llm_unavailable',{reason:error.name??'Error'});
          result={...result,llm:{status:'unavailable',suggestions:[]}};
        }
      }
      return json(res,200,result);
    }
    return json(res,req.method==='GET'?404:405,{error:req.method==='GET'?'Не найдено':'Метод не поддерживается'});
  }catch(error){
    const status=error.status??(error instanceof SyntaxError?400:500);
    if(status===500)log('error','api_error',{reason:error.name??'Error'});
    return json(res,status,{error:status===500?'Внутренняя ошибка сервиса':error.message});
  }
}
