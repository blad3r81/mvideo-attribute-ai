import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';

test('пакетный поток записывает полный gzip и удаляет неполный при ошибке',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attribute-batch-'));
  const output=path.join(dir,'predictions.jsonl.gz');
  const run=input=>spawnSync(process.execPath,['scripts/predict_stream.js',output],{cwd:path.resolve(''),input,encoding:'utf8',timeout:10000});
  try{
    const valid=run(JSON.stringify({id:'1',title:'Смартфон Samsung 256 GB black',description:'',seller_attributes:{}})+'\n');
    assert.equal(valid.status,0,valid.stderr);
    assert.equal(JSON.parse(zlib.gunzipSync(fs.readFileSync(output)).toString('utf8')).id,'1');
    const mixed=run(JSON.stringify({id:'1',title:'Смартфон Samsung',seller_attributes:{}})+'\n{bad json}\n'+JSON.stringify({id:'3',title:'Ноутбук Lenovo',seller_attributes:{}})+'\n');
    assert.equal(mixed.status,0,mixed.stderr);
    const rows=zlib.gunzipSync(fs.readFileSync(output)).toString('utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length,3);
    assert.equal(rows[1].status,'error');
    assert.equal(rows[2].id,'3');
    const invalid=run('{bad json}\n');
    assert.notEqual(invalid.status,0);
    assert.equal(fs.existsSync(output),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('одна повреждённая строка не останавливает тысячу карточек',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attribute-batch-stress-'));
  const output=path.join(dir,'predictions.jsonl.gz');
  const summary=path.join(dir,'summary.json');
  try{
    const lines=Array.from({length:1000},(_,index)=>JSON.stringify({id:String(index),title:'Смартфон Samsung 256 GB black',seller_attributes:{Цвет:'black'}}));
    lines.splice(500,0,'{broken');
    const run=spawnSync(process.execPath,['scripts/predict_stream.js',output,summary],{cwd:path.resolve(''),input:lines.join('\n')+'\n',encoding:'utf8',timeout:30000});
    assert.equal(run.status,0,run.stderr);
    const rows=zlib.gunzipSync(fs.readFileSync(output)).toString('utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length,1001);
    assert.equal(rows.filter(row=>row.status==='error').length,1);
    assert.deepEqual(JSON.parse(fs.readFileSync(summary,'utf8')),{cards:1001,predicted:1000,failed:1});
    assert.equal(rows.at(-1).id,'999');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
