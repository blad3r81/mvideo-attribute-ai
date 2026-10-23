import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extract} from '../src/catalog-extractor.js';

test('для одежды без официальной схемы обязательные поля не придумываются',()=>{
  const result=extract({id:'clothing-preview',title:'Футболка',description:'',seller_attributes:{}});
  assert.deepEqual(result.missing_required,[]);
});

test('модель из описания принимается только при явном фрагменте рядом с брендом',()=>{
  const card={title:'',description:'Смартфон Samsung Galaxy A55 в черном цвете',seller_attributes:{}};
  const found=extract(card).attributes.model;
  assert.equal(found.value,'Galaxy A55');
  assert.equal(found.status,'accepted');
  assert.equal(found.evidence.text,'Galaxy A55');
  assert.equal(extract({...card,description:'Смартфон Samsung 256 GB'}).attributes.model.status,'missing');
});

const cards=JSON.parse(fs.readFileSync(new URL('../data/real_cards.json',import.meta.url),'utf8'));

test('смартфон: диапазоны продавца не заменяют точные обязательные значения',()=>{
  const result=extract(cards.find(card=>card.id==='30079343'));
  assert.deepEqual(result.attributes.screen_inches.value,6.9);
  assert.deepEqual(result.attributes.battery_mah.value,5000);
  assert.equal(result.attributes.screen_inches.status,'accepted');
  assert.equal(result.attributes.battery_mah.status,'accepted');
  assert.equal(result.attributes.model.status,'review');
});

test('ноутбук: процессор с частотой и без неё совпадает по модели',()=>{
  const result=extract(cards.find(card=>card.id==='30070141'));
  assert.equal(result.attributes.processor.value,'Intel Core i5 12450H');
  assert.equal(result.attributes.processor.status,'accepted');
  assert.equal(result.attributes.screen_inches.value,17.3);
  assert.equal(result.attributes.screen_inches.status,'accepted');
});

test('ноутбук: подтверждённый объём SSD заполняет обязательный накопитель',()=>{
  const card=cards.find(item=>item.id==='30070420');
  const result=extract(card);
  assert.equal(result.attributes.storage_gb.status,'accepted');
  assert.equal(result.attributes.storage_gb.value,512);
  assert.equal(result.attributes.storage_gb.evidence.field,'seller_attributes.Объём SSD');
  assert.equal(result.attributes.storage_gb.evidence.text,'512 ГБ');
  assert.ok(!result.missing_required.includes('storage_gb'));
});

test('единицы диагонали и батареи не подменяются похожими числами',()=>{
  const attr=(name,value,key)=>extract({title:'Смартфон Samsung',seller_attributes:{[name]:value}}).attributes[key];
  assert.equal(attr('Диагональ экрана','1920x1080','screen_inches').status,'review');
  assert.equal(attr('Ёмкость аккумулятора','5000 Вт','battery_mah').status,'review');
  assert.equal(attr('Диагональ экрана','59.82 см','screen_inches').value,23.55);
  assert.equal(attr('Диагональ экрана','15.6"(39.6 см)','screen_inches').value,15.6);
  assert.equal(attr('Ёмкость аккумулятора','5000 мАч','battery_mah').value,5000);
});
