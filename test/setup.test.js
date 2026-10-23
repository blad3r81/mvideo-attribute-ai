import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('проверка запуска обнаруживает отсутствие схемы до запуска сервера',()=>{
  const result=spawnSync(process.execPath,['scripts/check_setup.js'],{
    encoding:'utf8',env:{...process.env,CATALOG_SCHEMA_PATH:'does-not-exist.json',DEMO_MODE:'1'}
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Каталог:/);
});

test('проверка запуска принимает рабочую конфигурацию демо',()=>{
  const result=spawnSync(process.execPath,['scripts/check_setup.js'],{
    encoding:'utf8',env:{...process.env,CATALOG_SCHEMA_PATH:'data/catalog_schema.json',DEMO_MODE:'1'}
  });
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/\d+ категорий/);
});
