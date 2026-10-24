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

test('слово «сердце» в описании не превращается в серый цвет',()=>{
  const result=extract(card('Смартфон Google Pixel 10 Pro',{'Цвет':'черный','Цвет_search':'черный'},'Сердце устройства — процессор'));
  assert.equal(result.attributes.color.status,'accepted');
  assert.equal(result.attributes.color.value,'чёрный');
});

test('укороченная Модель_search не стирает суффикс Pro',()=>{
  const result=extract(card('Смартфон Google Pixel 10 Pro',{'Бренд':'Google','Модель':'Pixel 10 Pro','Модель_search':'Pixel 10'}));
  assert.equal(result.attributes.model.status,'accepted');
  assert.equal(result.attributes.model.value,'Pixel 10 Pro');
});

test('коммерческое название с памятью не подменяет модель телефона',()=>{
  const result=extract(card('Смартфон Apple iPhone 16 Pro 512GB черный',{'Бренд':'Apple','Модель':'iPhone 16 Pro 512GB черный'}));
  assert.equal(result.attributes.model.status,'accepted');
  assert.equal(result.attributes.model.value,'iPhone 16 Pro');
  assert.equal(result.attributes.model.evidence.text,'iPhone 16 Pro 512GB черный');
});

test('длинная строка с процессором не становится названием модели ноутбука',()=>{
  const title='Ноутбук Lenovo V15 G4 ABP AMD Ryzen 7 7730U, 16 ГБ, 512 ГБ';
  const result=extract(card(title,{'Бренд':'Lenovo','Модель':'V15 G4 ABP AMD Ryzen 7 7730U, 16 ГБ, 512 ГБ'}));
  assert.notEqual(result.attributes.model.status,'accepted');
});

test('частота не входит в каноническое имя процессора',()=>{
  const result=extract(card('Ноутбук Apple MacBook Air M4',{'Процессор_search':'Apple M4 4.41 ГГц'}));
  assert.equal(result.attributes.processor.value,'Apple M4');
  assert.equal(result.attributes.processor.status,'accepted');
});

test('повтор семейства Ryzen удаляется из модели процессора',()=>{
  const result=extract(card('Ноутбук ASUS',{'Процессор_search':'AMD Ryzen 5 Ryzen 5 150 3.3 ГГц'}));
  assert.equal(result.attributes.processor.value,'AMD Ryzen 5 150');
});

test('память в ГБ отсекается от названия модели',()=>{
  const result=extract(card('Ноутбук Apple MacBook Air 13 М4 16/512ГБ',{'Бренд':'Apple','Модель':'MacBook Air 13 М4 16/512ГБ'}));
  assert.equal(result.attributes.model.value,'MacBook Air 13 М4');
});
