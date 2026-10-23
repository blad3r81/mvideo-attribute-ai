import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cache=new Map();

export function validCatalog(value){
  if(!value||typeof value.version!=='string'||!value.categories||typeof value.categories!=='object'||Array.isArray(value.categories))return false;
  return Object.entries(value.categories).every(([id,category])=>{
    if(!id||!category||typeof category.label!=='string'||!Array.isArray(category.search_attributes))return false;
    if(category.search_attributes.some(item=>typeof item!=='string'&&!(item&&typeof item.name==='string')))return false;
    if(category.required!==undefined&&(!Array.isArray(category.required)||category.required.some(item=>typeof item!=='string'||!item.trim())))return false;
    if(category.allowed_values===undefined)return true;
    if(!category.allowed_values||typeof category.allowed_values!=='object'||Array.isArray(category.allowed_values))return false;
    return Object.entries(category.allowed_values).every(([name,options])=>name&&Array.isArray(options)&&options.every(option=>
      typeof option==='string'||(option&&typeof option.value==='string'&&
        (option.aliases===undefined||(Array.isArray(option.aliases)&&option.aliases.every(alias=>typeof alias==='string'))))));
  });
}

export function loadJson(name,{fallback,validate}={}){
  const file=path.isAbsolute(name)?name:path.join(root,name);
  if(cache.has(file))return cache.get(file);
  let value;
  try{
    value=JSON.parse(fs.readFileSync(file,'utf8'));
  }catch(error){
    if(error.code==='ENOENT'&&fallback!==undefined)value=fallback;
    else throw new Error(`Cannot load JSON ${file}: ${error.message}`,{cause:error});
  }
  if(validate&&!validate(value))throw new Error(`Invalid JSON structure: ${file}`);
  cache.set(file,value);
  return value;
}

export const getCatalog=()=>loadJson(process.env.CATALOG_SCHEMA_PATH||'data/catalog_schema.json',{
  validate:validCatalog
});
export const getRuleSchema=()=>loadJson('config/schema.json',{
  validate:value=>value&&typeof value.version==='string'&&value.attributes&&value.categories
});
export const getDemo=()=>loadJson(process.env.DEMO_CARDS_PATH||'data/real_cards.json',{
  fallback:[],validate:Array.isArray
});
export const getStats=()=>loadJson(process.env.DATASET_STATS_PATH||'data/dataset_stats.json',{
  fallback:{},validate:value=>value&&typeof value==='object'&&!Array.isArray(value)
});
export const getDecisionPolicy=()=>loadJson(process.env.DECISION_POLICY_PATH||'config/decision_policy.json',{
  validate:value=>value&&typeof value.confidence_type==='string'&&Number.isFinite(value.acceptance_threshold)&&value.acceptance_threshold>0&&value.acceptance_threshold<=1
});
export const getLexicon=()=>loadJson(process.env.LEXICON_PATH||'config/lexicon.json',{
  validate:value=>value&&Array.isArray(value.brands)&&value.brands.every(x=>typeof x==='string')&&
    ['colors','materials','color_aliases','attribute_names'].every(key=>value[key]&&typeof value[key]==='object'&&!Array.isArray(value[key])&&Object.values(value[key]).every(x=>typeof x==='string'))&&
    Array.isArray(value.ignored_seller_fields)&&Array.isArray(value.validated_attributes)
});
