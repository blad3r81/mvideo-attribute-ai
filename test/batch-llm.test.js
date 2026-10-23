import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';

test('пакетный путь вызывает LLM и соблюдает лимит без потери результатов правил',async()=>{
  let calls=0;
  const server=http.createServer((req,res)=>{
    calls++;
    req.resume();
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:'{"items":[],"review_items":[]}'}}],usage:{prompt_tokens:12,completion_tokens:5}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attribute-batch-llm-'));
  try{
    const input=path.join(dir,'cards.json'),output=path.join(dir,'predictions.json');
    fs.writeFileSync(input,JSON.stringify([
      {id:'a',title:'Смартфон Samsung',seller_attributes:{Бренд:'Samsung'}},
      {id:'b',title:'Смартфон Samsung',seller_attributes:{Бренд:'Samsung'}}
    ]));
    const child=spawn(process.execPath,['scripts/predict.js',input,output,'--llm','--llm-limit=1'],{
      cwd:path.resolve(''),
      env:{...process.env,LLM_URL:`http://127.0.0.1:${server.address().port}`,LLM_API_KEY:'test',LLM_MODEL:'demo',LLM_AUTO_REVIEW:'1'}
    });
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
    assert.equal(exit,0,stderr);
    const rows=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(calls,1);
    assert.deepEqual(rows.map(row=>row.llm?.status),['completed','quota_exceeded']);
    assert.equal(rows[0].attributes.brand.value,'Samsung');
    assert.deepEqual(rows[0].attributes,rows[1].attributes);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
