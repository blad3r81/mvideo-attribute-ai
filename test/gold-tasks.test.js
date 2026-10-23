import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('задачи ручной разметки обязательных полей берутся из схемы, без ответов сервиса',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-tasks-'));
  try{
    const output=path.join(dir,'tasks.json');
    const run=spawnSync(process.execPath,['scripts/gold_tasks.js','data/real_cards.json',output,'3','required'],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const tasks=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(tasks.length,9);
    assert.deepEqual([...new Set(tasks.map(task=>task.category))].sort(),['761','914','987']);
    assert.equal(tasks.reduce((count,task)=>count+Object.keys(task.attributes).length,0),57);
    assert.ok(tasks.every(task=>Object.values(task.attributes).every(value=>value==='__UNLABELED__')));
    assert.ok(tasks.every(task=>!('prediction' in task)&&!('confidence' in task)));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
