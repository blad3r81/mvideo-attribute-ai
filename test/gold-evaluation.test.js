import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('gold-оценка считает метрики по атрибуту и прокси трафика отдельно',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attribute-gold-'));
  try{
    const gold=path.join(dir,'gold.json'),pred=path.join(dir,'pred.json');
    fs.writeFileSync(gold,JSON.stringify([
      {id:'1',category:'smartphone',seller_id:'A',traffic_rows:10,attributes:{color:'красный'}},
      {id:'2',category:'smartphone',seller_id:'B',traffic_rows:1,attributes:{color:'синий'}}
    ]));
    fs.writeFileSync(pred,JSON.stringify([
      {id:'1',attributes:{color:{status:'accepted',value:'красный',confidence:.9}}},
      {id:'2',attributes:{color:{status:'accepted',value:'зелёный',confidence:.9}}}
    ]));
    const run=spawnSync(process.execPath,['scripts/evaluate.js',gold,pred],{cwd:path.resolve(''),encoding:'utf8',timeout:10000});
    assert.equal(run.status,0,run.stderr);
    const result=JSON.parse(run.stdout),row=result.rows.find(x=>x.slice==='attribute:color');
    assert.equal(row.precision,.5);
    assert.equal(row.traffic_weighted_precision,10/11);
    assert.equal(result.macro_f1_attributes,.5);
    assert.equal(result.overall.precision,.5);
    assert.equal(result.category_summary[0].cards,2);
    assert.equal(result.category_summary[0].f1,.5);
    assert.equal(result.category_summary[0].small_sample,true);
    assert.ok(result.calibration.ece>0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('экспорт gold не принимает незавершённую или дублированную разметку',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attribute-gold-tasks-'));
  try{
    const input=path.join(dir,'tasks.json'),output=path.join(dir,'gold.json');
    const run=()=>spawnSync(process.execPath,['scripts/gold_to_eval.js',input,output],{cwd:path.resolve(''),encoding:'utf8',timeout:10000});
    fs.writeFileSync(input,JSON.stringify([{id:'1',attributes:{color:'__UNLABELED__'}}]));
    assert.notEqual(run().status,0);
    fs.writeFileSync(input,JSON.stringify([{id:'1',attributes:{color:'красный'}},{id:'1',attributes:{color:'синий'}}]));
    assert.notEqual(run().status,0);
    fs.writeFileSync(input,JSON.stringify([{id:'1',category:'smartphone',traffic_rows:5,attributes:{color:'красный',model:null}}]));
    assert.equal(run().status,0);
    assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8'))[0].attributes,{color:'красный',model:null});
    const manifest=path.join(dir,'manifest.json');
    fs.writeFileSync(manifest,JSON.stringify([{id:'1',category:'smartphone',attributes:{color:'__UNLABELED__',model:'__UNLABELED__'}}]));
    assert.equal(spawnSync(process.execPath,['scripts/gold_to_eval.js',input,output,manifest],{cwd:path.resolve(''),encoding:'utf8'}).status,0);
    fs.writeFileSync(input,JSON.stringify([{id:'1',category:'smartphone',attributes:{color:'красный'}}]));
    assert.notEqual(spawnSync(process.execPath,['scripts/gold_to_eval.js',input,output,manifest],{cwd:path.resolve(''),encoding:'utf8'}).status,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('оценка останавливается при ошибке пакетного предсказания',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attribute-gold-error-'));
  try{
    const gold=path.join(dir,'gold.json'),pred=path.join(dir,'pred.json');
    fs.writeFileSync(gold,JSON.stringify([{id:'1',attributes:{color:'синий'}}]));
    fs.writeFileSync(pred,JSON.stringify([{id:'1',status:'error',attributes:{}}]));
    const run=spawnSync(process.execPath,['scripts/evaluate.js',gold,pred],{cwd:path.resolve(''),encoding:'utf8',timeout:10000});
    assert.notEqual(run.status,0);
    assert.match(run.stderr,/Prediction failed for gold ID 1/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
