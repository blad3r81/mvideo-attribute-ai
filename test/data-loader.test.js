import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('импорт API не читает каталог, ошибка возникает только при обращении к нему',()=>{
  const code=`await import('./src/api-handler.js'); console.log('IMPORTED'); const {getCatalog}=await import('./src/data-loader.js'); try{getCatalog();process.exit(4)}catch(error){if(!error.message.includes('Cannot load JSON'))throw error;console.log('MISSING REPORTED')}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{
    cwd:path.resolve(''),env:{...process.env,CATALOG_SCHEMA_PATH:path.join(path.resolve(''),'absent-catalog-for-test.json')},encoding:'utf8',timeout:10000
  });
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/IMPORTED/);
  assert.match(result.stdout,/MISSING REPORTED/);
});
