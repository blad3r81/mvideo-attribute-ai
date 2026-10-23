import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validCatalog,getLexicon,getDecisionPolicy} from '../src/data-loader.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const failures=[];
const notes=[];
const file=name=>path.isAbsolute(name)?name:path.join(root,name);
function readJson(name,label){
  try{return JSON.parse(fs.readFileSync(file(name),'utf8'));}
  catch(error){failures.push(`${label}: ${error.message}`);return null;}
}
const major=Number(process.versions.node.split('.')[0]);
if(major<20)failures.push('Нужен Node.js 20 или новее');
const port=Number(process.env.PORT||4174);
if(!Number.isSafeInteger(port)||port<1||port>65535)failures.push('PORT должен быть целым числом от 1 до 65535');
const demo=process.env.DEMO_MODE==='1';
if(!process.env.API_TOKEN)notes.push('Закрытый /api/extract недоступен: задайте API_TOKEN');
const catalog=readJson(process.env.CATALOG_SCHEMA_PATH||'data/catalog_schema.json','Каталог');
const rules=readJson('config/schema.json','Правила');
if(catalog&&!validCatalog(catalog))failures.push('Каталог: неверная структура категорий, обязательных полей или справочника значений');
if(rules&&(!rules.attributes||!rules.categories||typeof rules.version!=='string'))failures.push('Правила: неверная структура config/schema.json');
try{getLexicon();}catch(error){failures.push(`Словари: ${error.message}`);}
try{getDecisionPolicy();}catch(error){failures.push(`Порог: ${error.message}`);}
const demoPath=process.env.DEMO_CARDS_PATH||'data/real_cards.json';
if(demo){
  const cards=readJson(demoPath,'Демо-карточки');
  if(cards&&(!Array.isArray(cards)||!cards.length))failures.push('Демо-карточки должны быть непустым массивом');
}
if(demo&&!process.env.API_TOKEN)notes.push('Публичен только ограниченный /api/preview; для /api/extract требуется API_TOKEN');
if(process.env.LLM_MODEL&&!((process.env.LLM_URL||process.env.OPENAI_BASE_URL)&&(process.env.LLM_API_KEY||process.env.OPENAI_API_KEY)))notes.push('LLM_MODEL задана без адреса или ключа: модель не будет вызвана');
if(failures.length){for(const message of failures)console.error(`ОШИБКА: ${message}`);process.exitCode=1;}
else console.log(`OK: Node ${process.versions.node}, каталог ${Object.keys(catalog.categories).length} категорий, порт ${port}, режим ${demo?'демо':'закрытый API'}`);
for(const message of notes)console.log(`ПРИМЕЧАНИЕ: ${message}`);
