import {extract as extractRules} from './extractor.js';
import {getCatalog,getLexicon,getDecisionPolicy} from './data-loader.js';
const normalizeSpace=value=>String(value??'').replace(/\s+/g,' ').trim();
const labels={brand:'Бренд',model:'Модель',processor:'Процессор',color:'Цвет',storage_gb:'Объём памяти',ram_gb:'Оперативная память',battery_mah:'Ёмкость аккумулятора',screen_inches:'Диагональ экрана',material:'Материал',size:'Размер'};
const canonicalKey=name=>getLexicon().attribute_names[normalizeSpace(name).replace(/_search$/i,'').toLocaleLowerCase()]??normalizeSpace(name).replace(/_search$/i,'');
const displayName=key=>labels[key]??key;
const evidenceText=value=>value&&typeof value==='object'?normalizeSpace(value.value)+(value.unit?' '+normalizeSpace(value.unit):''):normalizeSpace(value);
const normNumber=text=>Number(String(text).replace(',','.'));
const isRange=value=>/(?:и\s+(?:более|менее)|от\s+\d|до\s+\d)|\d[\d\s.,]*\s*[-–—]\s*\d|\d\s*\+/iu.test(value);
function dictionary(cat,key){
  const entry=Object.entries(cat?.allowed_values??{}).find(([name])=>canonicalKey(name)===key);
  return Array.isArray(entry?.[1])?entry[1]:null;
}
function catalogCanonical(cat,key,value){
  const options=dictionary(cat,key);
  if(!options)return null;
  const normalized=normalizeSpace(value).toLocaleLowerCase();
  for(const option of options){
    const canonical=typeof option==='string'?option:option?.value;
    const aliases=typeof option==='string'?[]:option?.aliases??[];
    if(typeof canonical==='string'&&[canonical,...aliases].some(alias=>normalizeSpace(alias).toLocaleLowerCase()===normalized))return canonical;
  }
  return null;
}
function validCanonical(key,value,raw,cat){
  if(['storage_gb','ram_gb','battery_mah','screen_inches'].includes(key)&&isRange(String(raw)))return false;
  if(dictionary(cat,key))return catalogCanonical(cat,key,value)!==null;
  if(!getLexicon().validated_attributes.includes(key))return false; // The archive has attribute names, not allowed value dictionaries.
  if(key==='color')return Object.values(getLexicon().color_aliases).includes(value);
  if(key==='storage_gb'||key==='ram_gb')return typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=8192;
  if(key==='battery_mah')return typeof value==='number'&&Number.isFinite(value)&&value>=100&&value<=100000;
  if(key==='screen_inches')return typeof value==='number'&&Number.isFinite(value)&&value>=4&&value<=120;
  if(key==='size')return !!value&&typeof value==='object'&&value.system!=='не указана';
  if(key==='processor')return /(?:Intel|AMD|Apple|Qualcomm|Snapdragon|MediaTek|Ryzen|Core)/iu.test(String(value));
  return typeof value==='string'&&value.trim().length>0;
}
function normalizeValue(key,raw){
  const value=normalizeSpace(raw);
  if(key==='color'||key==='Цвет производителя') return getLexicon().color_aliases[value.toLocaleLowerCase()]??value.toLocaleLowerCase();
  if(key==='material')return value.toLocaleLowerCase();
  if(key==='size'||/^Размер (одежды|обуви|головного убора|перчаток)/iu.test(key)){
    const system=value.match(/\b(EU|US|RU|UK)\s*(\d{2,3})\b/i);
    if(system) return {system:system[1].toUpperCase(),value:system[2]};
    const intl=value.match(/\b(XXS|XS|S|M|L|XL|XXL|XXXL)\b/i);
    if(intl) return {system:'INT',value:intl[1].toUpperCase()};
    return {system:'не указана',value};
  }
  if(['storage_gb','ram_gb'].includes(key)){
    if(isRange(value))return null;
    const match=value.match(/(\d+(?:[.,]\d+)?)\s*(ТБ|TB|ГБ|GB)/i);
    if(match) return normNumber(match[1])*(/ТБ|TB/i.test(match[2])?1024:1);
  }
  if(key==='processor'&&/^(?:Intel\s+Core|Core\s+i[3579]|AMD\s+Ryzen)/iu.test(value))
    return value.replace(/\s+\d+(?:[.,]\d+)?\s*(?:ГГц|GHz)\s*$/iu,'');
  if(key==='screen_inches'){
    if(isRange(value))return null;
    const inch=value.match(/^(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:["″]|дюйм(?:а|ов)?|inch(?:es)?|in)?(?:\s*\(\s*\d{1,3}(?:[.,]\d{1,2})?\s*см\s*\))?$/iu);
    if(inch)return normNumber(inch[1]);
    const cm=value.match(/^(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:см|cm)$/iu);
    if(cm)return Math.round(normNumber(cm[1])/2.54*100)/100;
    return value;
  }
  if(key==='battery_mah'){
    if(isRange(value))return null;
    const match=value.match(/^(\d{3,5})\s*(?:мА\s*[·*]?\s*ч|mAh)?$/iu);
    if(match)return Number(match[1]);
    return value;
  }
  if(/^Количество /iu.test(key)){
    const match=value.match(/^(\d+)\s*(?:шт\.?)?$/iu);
    if(match)return Number(match[1]);
  }
  return value;
}
function normalizeForCategory(cat,key,raw){
  const normalized=normalizeValue(key,raw);
  return catalogCanonical(cat,key,normalized)??catalogCanonical(cat,key,raw)??normalized;
}
function sellerFields(card){
  const seller=card.seller_attributes??{};
  if(!seller||typeof seller!=='object'||Array.isArray(seller)) return [];
  return Object.entries(seller).flatMap(([name,raw])=>{
    if(getLexicon().ignored_seller_fields.includes(name.replace(/_search$/i,''))) return [];
    return (Array.isArray(raw)?raw:[raw]).flatMap(item=>{
      const value=evidenceText(item);
      return value?[{name,raw:value,source:`seller_attributes.${name}`}]:[];
    });
  });
}
function add(candidates,key,value,raw,source,method,confidence){
  if(value===null||value===undefined||value==='')return;
  (candidates[key]??=[]).push({attribute:key,value,raw,source,method,confidence,evidence:{field:source,text:raw}});
}
function choose(key,items,cat){
  if(!items?.length) return {attribute:key,status:'missing',reason:'not_found_in_text'};
  const comparable=value=>typeof value==='string'?value.toLocaleLowerCase():JSON.stringify(value);
  const values=[...new Set(items.map(x=>comparable(x.value)))];
  if(values.length>1){
    const search=items.filter(x=>x.source.endsWith('_search'));
    const searchValues=[...new Set(search.map(x=>JSON.stringify(x.value)))];
    if(searchValues.length===1&&search.length){
      const canonical=search[0];
      const compatible=items.every(x=>x===canonical||
        x.source.endsWith('_search')||
        normalizeSpace(x.raw).toLocaleLowerCase().includes(normalizeSpace(canonical.raw).toLocaleLowerCase()));
      if(compatible&&canonical.confidence>=getDecisionPolicy().acceptance_threshold&&validCanonical(key,canonical.value,canonical.raw,cat))return {...canonical,status:'accepted',reason:'catalog_search_value_confirmed'};
    }
    return {attribute:key,status:'review',reason:'conflicting_values',candidates:items};
  }
  const best=[...items].sort((a,b)=>b.confidence-a.confidence)[0];
  const validated=validCanonical(key,best.value,best.raw,cat);
  const accepted=best.confidence>=getDecisionPolicy().acceptance_threshold&&validated;
  return {...best,status:accepted?'accepted':'review',reason:accepted?(dictionary(cat,key)?'verified_with_dictionary':'validated_format'):!validated?'requires_value_validation':'below_threshold'};
}
function family(label){
  if(/смартфон/i.test(label))return 'smartphone';
  if(/ноутбук/i.test(label))return 'laptop';
  if(/футболк|одежд/i.test(label))return 'clothing';
  return null;
}
function categoryFamily(cat,catalog){
  let current=cat;
  for(let depth=0;current&&depth<8;depth++){
    const kind=family(current.label??'');
    if(kind)return kind;
    current=current.parent_id?catalog.categories?.[String(current.parent_id)]:null;
  }
  return null;
}
export function requiredForCategory(cat,catalog,kind=categoryFamily(cat,catalog)){
  if(Array.isArray(cat?.required))return cat.required.map(canonicalKey);
  return kind==='smartphone'?['brand','model','storage_gb','screen_inches','battery_mah','color']:
    kind==='laptop'?['brand','model','processor','ram_gb','storage_gb','screen_inches','color']:[];
}
function explicitDescription(card,cat,items){
  const desc=String(card.description??'');
  const names=[...(cat?.search_attributes??[]).slice(0,150).map(x=>typeof x==='string'?x:x.name),...(cat?.required??[]).map(canonicalKey).map(displayName)];
  for(const name of names){
    if(!name||name.length>80)continue;
    const safe=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp(`(?:^|[\\n]|<br\\s*\\/?>|[•])\\s*${safe}\\s*[:：—-]\\s*([^<\\n;]{1,100})`,'iu');
    const match=desc.match(re);
    if(!match)continue;
    const key=canonicalKey(name),raw=match[1].trim();
    if(raw)add(items,key,normalizeForCategory(cat,key,raw),raw,'description','explicit_key_value',.84);
  }
}
export function extract(card,{catalog=getCatalog(),ruleExtractor=extractRules}={}){
  const id=String(card.id??card.sku_id??'preview');
  const categoryId=card.category_id!==null&&card.category_id!==undefined&&card.category_id!==''?String(card.category_id):null;
  const cat=categoryId?catalog.categories?.[categoryId]:null;
  const ruleInput={id,title:String(card.title??''),description:String(card.description??''),seller_attributes:{}};
  const kindFromCategory=categoryFamily(cat,catalog);
  const base=(kindFromCategory||!categoryId||!cat)?ruleExtractor(ruleInput):{category:{value:null,method:'abstain',confidence:0},attributes:{}};
  const kind=kindFromCategory??base.category.value;
  const category=categoryId&&cat?{value:categoryId,label:cat.label,method:'provided_category_id',confidence:1}:categoryId?
    {value:null,label:null,method:'invalid_category_id',confidence:0,provided_id:categoryId}:
    {...base.category,label:kind?({smartphone:'Смартфон',laptop:'Ноутбук',clothing:'Одежда'}[kind]):null};
  const items={};
  const required=requiredForCategory(cat,catalog,kind);
  const allowed=new Set([...(cat?.search_attributes??[]).map(x=>canonicalKey(typeof x==='string'?x:x.name)),...required]);
  for(const field of sellerFields(card)){
    const key=canonicalKey(field.name);
    if(cat && !allowed.has(key) && !['brand','model'].includes(key))continue;
    const unknownColor=key==='color'&&!field.name.endsWith('_search')&&!getLexicon().color_aliases[field.raw.toLocaleLowerCase()]&&!catalogCanonical(cat,key,field.raw);
    add(items,key,normalizeForCategory(cat,key,field.raw),field.raw,field.source,'seller_field',unknownColor ? .72 : .95);
  }
  if(cat)explicitDescription(card,cat,items);
  for(const [key,item] of Object.entries(base.attributes)){
    if(item.status!=='accepted')continue;
    if(!kind && !allowed.has(key))continue;
    add(items,key,item.value,item.raw,item.source,item.method,item.confidence);
  }
  const keys=[...new Set([...required,...Object.keys(items)])];
  const attributes=Object.fromEntries(keys.map(key=>[key,choose(key,items[key],cat)]));
  if(kind==='smartphone'){
    const width=attributes['Ширина'],thickness=attributes['Толщина'];
    const numberMm=item=>item&&item.reason!=='conflicting_values'&&/мм/iu.test(String(item.raw))?Number(String(item.raw).match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',','.')):NaN;
    const w=numberMm(width),t=numberMm(thickness);
    if(Number.isFinite(w)&&Number.isFinite(t)&&t>=w){
      for(const key of ['Ширина','Толщина']){
        const item=attributes[key];
        attributes[key]={attribute:key,status:'review',reason:'inconsistent_dimensions',candidates:[{attribute:key,value:item.value,raw:item.raw,source:item.source,method:item.method,confidence:item.confidence,evidence:item.evidence}]};
      }
    }
  }
  const missing_required=required.filter(key=>attributes[key]?.status!=='accepted');
  return {id,category,attributes,missing_required,schema_version:catalog.version,traffic_rows:card.traffic_rows??null,decision_policy:{confidence_type:getDecisionPolicy().confidence_type,acceptance_threshold:getDecisionPolicy().acceptance_threshold}};
}
export {getCatalog,displayName,canonicalKey};
