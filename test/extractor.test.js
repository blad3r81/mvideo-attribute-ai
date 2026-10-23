import test from 'node:test';
import assert from 'node:assert/strict';
import {extract} from '../src/extractor.js';

test('русский и английский формат памяти нормализуются одинаково',()=>{
  const a=extract({title:'Смартфон Samsung Galaxy A55 256 GB',description:''});
  const b=extract({title:'Смартфон Samsung Galaxy A55 256 ГБ',description:''});
  assert.equal(a.attributes.storage_gb.value,256);
  assert.equal(b.attributes.storage_gb.value,256);
});
test('Redmi не превращается в красный цвет',()=>{
  const x=extract({title:'Смартфон Xiaomi Redmi Note 13',description:'blue'});
  assert.equal(x.attributes.color.value,'синий');
});
test('RAM и SSD остаются разными атрибутами',()=>{
  const x=extract({title:'Ноутбук Lenovo IdeaPad',description:'16 ГБ ОЗУ, SSD 512 GB'});
  assert.equal(x.attributes.ram_gb.value,16);
  assert.equal(x.attributes.storage_gb.value,512);
});
test('неизвестные характеристики не придумываются',()=>{
  const x=extract({title:'Смартфон Samsung Galaxy A55',description:''});
  assert.equal(x.attributes.battery_mah.status,'missing');
  assert.equal(x.attributes.color.status,'missing');
});
test('конфликтующие цвета уходят на проверку',()=>{
  const x=extract({title:'Смартфон Samsung Galaxy A55 черный',description:'Цвет: white'});
  assert.equal(x.attributes.color.status,'review');
});
test('система размера сохраняется без произвольной конверсии',()=>{
  const x=extract({title:'Футболка размер EU 42',description:''});
  assert.deepEqual(x.attributes.size.value,{system:'EU',value:'42'});
});
