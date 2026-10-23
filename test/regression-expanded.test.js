import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extract} from '../src/catalog-extractor.js';

const cards=JSON.parse(fs.readFileSync(new URL('../data/real_cards.json',import.meta.url),'utf8'));
const card=(title,seller_attributes={},description='')=>({title,description,seller_attributes});

test('диапазон 128–256 GB в названии не становится точным объёмом',()=>{
  const result=extract(card('Смартфон Samsung 128–256 GB'));
  assert.equal(result.attributes.storage_gb.status,'missing');
});
test('диапазон 128 GB - 256 GB не становится точным объёмом',()=>{
  const result=extract(card('Смартфон Samsung 128 GB - 256 GB'));
  assert.equal(result.attributes.storage_gb.status,'missing');
});
test('диапазон памяти в поле продавца не принимается',()=>{
  const result=extract(card('Смартфон Samsung',{'Встроенная память':'128-256 ГБ'}));
  assert.notEqual(result.attributes.storage_gb.status,'accepted');
});
test('точный объём памяти на русском остаётся принятым',()=>{
  const result=extract(card('Смартфон Samsung 256 ГБ'));
  assert.equal(result.attributes.storage_gb.value,256);
  assert.equal(result.attributes.storage_gb.status,'accepted');
});
test('известный цвет из _search нормализуется',()=>{
  const result=extract(card('Смартфон Samsung',{'Цвет_search':'red'}));
  assert.equal(result.attributes.color.value,'красный');
  assert.equal(result.attributes.color.status,'accepted');
});
test('неизвестный цвет из _search требует проверки',()=>{
  const result=extract(card('Смартфон Samsung',{'Цвет_search':'lavanda'}));
  assert.equal(result.attributes.color.status,'review');
});
test('несуществующая категория не получает ложную уверенность',()=>{
  const result=extract({...card('Смартфон Samsung 256 GB'),category_id:'999999999'});
  assert.equal(result.category.method,'invalid_category_id');
  assert.equal(result.category.confidence,0);
});
test('недопустимое значение без справочника остаётся на проверке',()=>{
  const result=extract({...card('Футболка',{'Гарантия_search':'000'}),category_id:'57170'});
  assert.equal(result.attributes['Гарантия'].status,'review');
});
test('несогласованные ширина и толщина смартфона остаются на проверке',()=>{
  const result=extract(cards.find(x=>x.id==='30079343'));
  assert.equal(result.attributes['Ширина'].reason,'inconsistent_dimensions');
  assert.equal(result.attributes['Толщина'].reason,'inconsistent_dimensions');
});
test('размерные системы EU и US не объединяются в одно значение',()=>{
  const result=extract(card('Футболка размер EU 42',{'Размер':'US 38'}));
  assert.equal(result.attributes.size.status,'review');
});
test('разный регистр бренда не создаёт ложный конфликт',()=>{
  const result=extract(cards.find(x=>x.id==='30072074'));
  assert.equal(result.attributes.brand.status,'accepted');
  assert.equal(result.attributes.brand.value,'HUAWEI');
});
