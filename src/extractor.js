import {getRuleSchema,getLexicon,getDecisionPolicy} from './data-loader.js';

function sourceTexts(card) {
  const arr=[['title',String(card.title??'')],['description',String(card.description??'')]];
  const seller=card.seller_attributes??{};
  if(seller && typeof seller==='object' && !Array.isArray(seller))
    for(const [key,value] of Object.entries(seller)) if(value!==null && value!==undefined) arr.push([`seller_attributes.${key}`,String(value)]);
  return arr;
}
function candidate(key,value,raw,source,method,confidence){return {attribute:key,value,raw,source,method,confidence};}
function regexCandidates(card,key,regex,normalize,method='rule_regex',confidence=0.91,sourceFilter=()=>true){
  const out=[];
  for(const [source,text] of sourceTexts(card)) if(sourceFilter(source)) {
    const re=new RegExp(regex.source,regex.flags.includes('g')?regex.flags:regex.flags+'g');
    for(const match of text.matchAll(re)) {
      const raw=match.groups?.value??match[0], value=normalize(raw,match);
      if(value!==null && value!==undefined) out.push(candidate(key,value,raw,source,method,source==='title'?confidence:Math.max(.5,confidence-.04)));
    }
  }
  return out;
}
const number=x=>Number(String(x).replace(',','.'));
function sellerMatches(card,aliases) {
  return sourceTexts(card).filter(([s])=>s.startsWith('seller_attributes.') && aliases.test(s.split('.').slice(1).join('.')));
}
function keyValues(card,key,aliases,parse,confidence=.96){
  return sellerMatches(card,aliases).flatMap(([source,text])=>{
    const value=parse(text); return value===null?[]:[candidate(key,value,text,source,'seller_field',confidence)];
  });
}
function dictionary(card,key,dict,aliases){
  const out=[];
  for(const [source,text] of sourceTexts(card)) {
    if(source.startsWith('seller_attributes.') && !aliases.test(source.split('.').slice(1).join('.'))) continue;
    for(const [needle,value] of Object.entries(dict)) {
      const re=new RegExp(needle==='ал'?'(?<![\\p{L}])ал(?:ый|ая|ое|ые)(?![\\p{L}])':`(?<![\\p{L}])${needle}${/^[a-z]+$/i.test(needle)?'':'[\\p{L}]*'}(?![\\p{L}])`,'giu');
      for(const m of text.matchAll(re)) {
        // A color stem such as "сер" must not turn "сердце" into "серый".
        if(key==='color'&&!/^(?:ч[её]рн|бел|красн|син|зел[её]н|серебрист|сер)(?:ый|ий|ая|ое|ые|ого|его|ой|ую|ым|ом|их|ыми)$/iu.test(m[0])
          && !Object.hasOwn(getLexicon().color_aliases,m[0].toLocaleLowerCase()))continue;
        out.push(candidate(key,value,m[0],source,'dictionary',source.startsWith('seller_')?.93:.86));
      }
    }
  }
  return out;
}
function detectCategory(card){
  const text=String(card.title??'')+' '+String(card.description??'');
  const found=[];
  if(/смартфон|smartphone|mobile phone|телефон/i.test(text)) found.push('smartphone');
  if(/ноутбук|laptop|notebook/i.test(text)) found.push('laptop');
  if(/футболк|t-shirt|shirt|одежд/i.test(text)) found.push('clothing');
  return found.length===1?{value:found[0],method:'keyword',confidence:.94}:{value:null,method:'abstain',confidence:0};
}
function normalizeSize(text){
  const m=String(text).match(/\b(EU|US|RU|UK)\s*([0-9]{2,3})\b/i);
  if(m) return {system:m[1].toUpperCase(),value:m[2]};
  const a=String(text).match(/\b(XXS|XS|S|M|L|XL|XXL|XXXL)\b/i);
  return a?{system:'INT',value:a[1].toUpperCase()}:null;
}
function uniqueValues(cands){return [...new Set(cands.map(x=>JSON.stringify(x.value)))];}
function choose(key,cands){
  const values=uniqueValues(cands);
  if(values.length>1) return {attribute:key,status:'review',reason:'conflicting_values',candidates:cands};
  if(!values.length) return {attribute:key,status:'missing',reason:'not_found_in_text'};
  const best=[...cands].sort((a,b)=>b.confidence-a.confidence)[0];
  return {...best,status:best.confidence>=getDecisionPolicy().acceptance_threshold?'accepted':'review',evidence:{field:best.source,text:best.raw}};
}
export function extract(card){
  const schema=getRuleSchema();
  const {colors,materials,brands}=getLexicon();
  const attrs=schema.attributes;
  const category=detectCategory(card); const found={};
  const add=(key,items)=>{found[key]??=[];found[key].push(...items);};
  add('brand',keyValues(card,'brand',/бренд|brand/i,t=>brands.find(b=>b.toLowerCase()===t.trim().toLowerCase())??null));
  for(const brand of brands){
    const escaped=brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    add('brand',regexCandidates(card,'brand',new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`,'iu'),()=>brand,'dictionary',.91,s=>s==='title'||s==='description'));
  }
  const brand=choose('brand',found.brand??[]);
  if(brand.status==='accepted'){
    const b=brand.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const m=String(card.title??'').match(new RegExp(`(?:^|\\s)${b}\\s+([\\p{L}][\\p{L}\\d-]*(?:\\s+[\\p{L}\\d-]+){0,3})`,'iu'));
    if(m){
      let raw=m[1].replace(/\s+(?:\d+(?:[.,]\d+)?\s*(?:GB|ГБ|TB|ТБ)|(?:black|white|red|blue|gray|grey|silver|черн\w*|бел\w*|красн\w*|сер\w*))\b.*$/iu,'').trim();
      if(raw && !/^(?:смартфон|ноутбук)$/iu.test(raw)) add('model',[candidate('model',raw,raw,'title','brand_context_rule',.82)]);
    }
    const description=String(card.description??'').slice(0,200);
    const inDescription=description.match(new RegExp(`(?:смартфон|телефон|ноутбук|smartphone|laptop)\\s+${b}\\s+([\\p{L}][\\p{L}\\d-]*(?:\\s+[\\p{L}][\\p{L}\\d-]*)?\\s+[\\p{L}\\d-]*\\d[\\p{L}\\d-]*(?:\\s+(?:Pro|Max|Ultra|Plus|SE))?)`,'iu'));
    if(inDescription){
      const raw=inDescription[1].trim();
      if(/[\p{L}]/u.test(raw)&&/\d/u.test(raw)&&!/^\d+\s*(?:GB|ГБ|TB|ТБ)$/iu.test(raw))
        add('model',[candidate('model',raw,raw,'description','brand_context_rule',.82)]);
    }
  }
  add('model',keyValues(card,'model',/модель|model/i,t=>t.trim()||null,.93));
  add('color',dictionary(card,'color',colors,/цвет|color/i));
  add('material',dictionary(card,'material',materials,/материал|material|состав/i));
  add('processor',regexCandidates(card,'processor',/(?<value>(?:Intel\s+Core\s+i[3579]|AMD\s+Ryzen\s+[3579])[-\s]?\d{4,5}[A-Z]{0,2})/iu,t=>t.replace(/\s+/g,' ').trim(),'rule_regex',.91));
  add('ram_gb',regexCandidates(card,'ram_gb',/(?<value>\d{1,3})\s*(?:GB|ГБ)\s*(?:RAM|ОЗУ)|(?:RAM|ОЗУ|оперативн\w*\s+памят\w*)\s*(?<after>\d{1,3})\s*(?:GB|ГБ)/iu,(t,m)=>number(m.groups.after??m.groups.value),'rule_regex',.92));
  add('ram_gb',keyValues(card,'ram_gb',/озу|ram|оператив/i,t=>{const m=t.match(/\d{1,3}/);return m?number(m[0]):null;}));
  add('screen_inches',regexCandidates(card,'screen_inches',/(?<value>\d{1,2}[.,]\d{1,2}|\d{2})\s*(?:дюйм\w*|inch(?:es)?|["″])/iu,t=>{const n=number(t);return n>=4&&n<=30?n:null;},'rule_regex',.93));
  add('screen_inches',keyValues(card,'screen_inches',/диагонал|screen|экран/i,t=>{const n=number(t.match(/\d{1,2}(?:[.,]\d{1,2})?/)?.[0]??'');return n>=4&&n<=30?n:null;}));
  add('battery_mah',regexCandidates(card,'battery_mah',/(?<value>\d{3,5})\s*(?:мА\s*[·*]?\s*ч|mAh)/iu,t=>{const n=number(t);return n>=500&&n<=30000?n:null;},'rule_regex',.94));
  add('battery_mah',keyValues(card,'battery_mah',/батаре|аккумулятор|battery/i,t=>{const n=number(t.match(/\d{3,5}/)?.[0]??'');return n>=500&&n<=30000?n:null;}));
  const storageRe=/(?<value>\d{1,4})\s*(?<unit>GB|ГБ|TB|ТБ)(?![\p{L}])/iu;
  for(const [source,text] of sourceTexts(card)) {
    if(source.startsWith('seller_attributes.') && !/памят|накопител|storage|ssd|rom/i.test(source)) continue;
    const re=new RegExp(storageRe.source,'giu');
    for(const m of text.matchAll(re)) {
      const before=text.slice(Math.max(0,m.index-5),m.index),after=text.slice(m.index+m[0].length,m.index+m[0].length+5);
      if(/(?:RAM|ОЗУ)\s*$/i.test(before)||/^\s*(?:RAM|ОЗУ)/i.test(after)) continue;
      // A range or a list of capacities is not one exact storage value.
      const left=text.slice(Math.max(0,m.index-24),m.index);
      const right=text.slice(m.index+m[0].length,m.index+m[0].length+24);
      if(/(?:\d\s*[-–—]\s*|(?:ГБ|GB|ТБ|TB)\s*[-–—]\s*|(?:от|до)\s*)$/iu.test(left)
        || /^\s*(?:[-–—]|(?:до|от)\b)/iu.test(right)
        || /(?:ГБ|GB|ТБ|TB)\s*\/\s*$/iu.test(left)
        || /^\s*\/\s*\d+\s*(?:ГБ|GB|ТБ|TB)/iu.test(right)) continue;
      const n=number(m.groups.value)*( /TB|ТБ/i.test(m.groups.unit)?1024:1);
      if(n>=16&&n<=8192) add('storage_gb',[candidate('storage_gb',n,m[0],source,'unit_rule',source.startsWith('seller_')?.95:.9)]);
    }
  }
  for(const [source,text] of sourceTexts(card)) {
    if(source.startsWith('seller_attributes.') && !/размер|size/i.test(source)) continue;
    const re=/(?:(?:размер|size)\s*)?(?:EU|US|RU|UK)\s*\d{2,3}\b|(?:размер|size)\s*(?:XXS|XS|S|M|L|XL|XXL|XXXL)\b/giu;
    for(const m of text.matchAll(re)) {
      const value=normalizeSize(m[0]); if(value) add('size',[candidate('size',value,m[0],source,'size_rule',.9)]);
    }
  }
  const required=category.value?schema.categories[category.value]?.required??[]:[];
  const keys=[...new Set([...required,...Object.keys(found).filter(k=>found[k].length)])];
  const attributes=Object.fromEntries(keys.map(k=>[k,choose(k,found[k]??[])]));
  for(const [key,item] of Object.entries(attributes)) {
    if(item.status==='accepted' && attrs[key]?.type==='enum' && !attrs[key].values.includes(item.value)) attributes[key]={attribute:key,status:'review',reason:'not_in_dictionary',candidate:item};
  }
  return {id:String(card.id??''),category,attributes,missing_required:required.filter(k=>attributes[k]?.status!=='accepted'),schema_version:schema.version};
}
