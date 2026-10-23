import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validCatalog} from '../src/data-loader.js';
import {extract} from '../src/catalog-extractor.js';

test('битый справочник отклоняется до извлечения',()=>{
  const category={label:'Товар',search_attributes:['Цвет'],allowed_values:{Цвет:[{value:'красный',aliases:{one:'red'}}]}};
  assert.equal(validCatalog({version:'test',categories:{'999':category}}),false);
  category.allowed_values.Цвет[0].aliases=['red'];
  assert.equal(validCatalog({version:'test',categories:{'999':category}}),true);
});

test('каталог можно передать извлекателю без замены глобальных файлов',()=>{
  const catalog={version:'injected',categories:{'0':{label:'Товар',required:['Страна'],search_attributes:['Страна'],allowed_values:{Страна:['Россия']}}}};
  const result=extract({title:'Товар',category_id:0,seller_attributes:{Страна:'Россия'}},{catalog});
  assert.equal(result.category.value,'0');
  assert.equal(result.attributes['Страна'].status,'accepted');
});

test('новая категория использует обязательные поля и допустимые значения из схемы',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attribute-schema-'));
  try{
    const schema=path.join(dir,'catalog.json');
    fs.writeFileSync(schema,JSON.stringify({version:'test',categories:{'999':{label:'Тестовая категория',required:['Страна'],search_attributes:['Страна'],allowed_values:{'Страна':[{value:'Бангладеш',aliases:['Bangladesh']}]}}}}));
    const code=`import {extract} from './src/catalog-extractor.js'; const card={title:'Товар',category_id:'999',seller_attributes:{Страна:'Bangladesh'}}; console.log(JSON.stringify([extract(card),extract({...card,seller_attributes:{Страна:'Unknown'}})]));`;
    const run=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:path.resolve(''),env:{...process.env,CATALOG_SCHEMA_PATH:schema},encoding:'utf8',timeout:10000});
    assert.equal(run.status,0,run.stderr);
    const [known,unknown]=JSON.parse(run.stdout);
    assert.equal(known.attributes['Страна'].value,'Бангладеш');
    assert.equal(known.attributes['Страна'].status,'accepted');
    assert.equal(unknown.attributes['Страна'].status,'review');
    assert.deepEqual(unknown.missing_required,['Страна']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('LLM для новой категории предлагает только значение из её справочника',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attribute-schema-llm-'));
  try{
    const schema=path.join(dir,'catalog.json');
    fs.writeFileSync(schema,JSON.stringify({version:'test',categories:{'999':{label:'Тестовая категория',required:['Страна'],search_attributes:['Страна'],allowed_values:{'Страна':[{value:'Бангладеш',aliases:['Bangladesh']}]}}}}));
    const code=`import {extract} from './src/catalog-extractor.js'; import {suggestMissing} from './src/llm.js';
      globalThis.fetch=async()=>({ok:true,headers:{get:()=>null},body:null,json:async()=>({choices:[{message:{content:JSON.stringify({items:[{attribute:'Страна',value:'Bangladesh',field:'title',quote:'Bangladesh'}]})}}]})});
      const card={title:'Товар Bangladesh',category_id:'999',seller_attributes:{}};
      console.log(JSON.stringify(await suggestMissing(card,extract(card))));`;
    const run=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:path.resolve(''),env:{...process.env,CATALOG_SCHEMA_PATH:schema,LLM_URL:'http://example.invalid',LLM_API_KEY:'test',LLM_MODEL:'test'},encoding:'utf8',timeout:10000});
    assert.equal(run.status,0,run.stderr);
    const result=JSON.parse(run.stdout);
    assert.equal(result.llm.status,'completed');
    assert.equal(result.llm.suggestions[0].value,'Бангладеш');
    assert.equal(result.llm.suggestions[0].status,'review');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
