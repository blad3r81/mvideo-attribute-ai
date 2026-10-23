const $=id=>document.getElementById(id);
const number=new Intl.NumberFormat('ru-RU');
const labels={brand:'Бренд',model:'Модель',processor:'Процессор',storage_gb:'Объём памяти',ram_gb:'Оперативная память',screen_inches:'Диагональ экрана',battery_mah:'Ёмкость аккумулятора',color:'Цвет',size:'Размер',material:'Материал'};
const methods={seller_field:'Поле продавца',dictionary:'Словарь',rule_regex:'Правило',unit_rule:'Правило единиц',brand_context_rule:'Контекст бренда',size_rule:'Правило размера',explicit_key_value:'Ключ в описании',learned_alias:'Обученный словарь',llm_suggestion:'LLM',llm_review:'Проверка LLM'};
const reasons={conflicting_values:'значения противоречат друг другу',requires_value_validation:'нужна проверка по справочнику значений',inconsistent_dimensions:'размеры не согласуются',below_threshold:'балл ниже порога принятия',not_found_in_text:'не найдено в тексте',verified_with_dictionary:'значение совпало со справочником категории',validated_format:'значение прошло проверку формата',catalog_search_value_confirmed:'значение подтверждено полем поиска каталога'};
const units={storage_gb:'ГБ',ram_gb:'ГБ',screen_inches:'дюйма',battery_mah:'мА·ч'};
const plural=(n,one,few,many)=>n%10===1&&n%100!==11?one:[2,3,4].includes(n%10)&&![12,13,14].includes(n%100)?few:many;
const sourceLabel=source=>source==='title'?'Название':source==='description'?'Описание':source?.startsWith('seller_attributes.')?`Поле продавца «${source.slice('seller_attributes.'.length)}»`:source??'Источник не указан';
let demos=[],activeCard=null,lastResult=null,reviewDecisions={};
const format=(key,value)=>value&&typeof value==='object'?`${value.system} ${value.value}`:`${value}${units[key]?' '+units[key]:''}`;
function clearResult(){
  lastResult=null;reviewDecisions={};$('review-export').hidden=true;$('result').hidden=true;$('empty').hidden=false;$('category').textContent='Нет карточки';
  $('attr-filter').value='';$('json').textContent='{}';
}
function reviewControls(name,candidates,cell){
  if(!candidates.length)return;
  const box=document.createElement('div'),select=document.createElement('select'),accept=document.createElement('button'),reject=document.createElement('button'),state=document.createElement('span');
  box.className='review-controls';select.setAttribute('aria-label',`Кандидат для ${labels[name]??name}`);
  candidates.forEach((candidate,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=String(candidate.value??candidate.raw??'—');select.append(option);});
  accept.type=reject.type='button';accept.textContent='Подтвердить';reject.textContent='Отклонить';state.className='decision';
  const decide=decision=>{
    const candidate=candidates[Number(select.value)];
    reviewDecisions[name]={attribute:name,decision,candidate_value:candidate.value??null,source:candidate.source??null,evidence:candidate.evidence??null};
    state.textContent=decision==='confirmed'?'Отмечено: подтвердить':'Отмечено: отклонить';
    $('review-export').hidden=false;
  };
  accept.addEventListener('click',()=>decide('confirmed'));reject.addEventListener('click',()=>decide('rejected'));
  const previous=reviewDecisions[name];
  if(previous){
    const index=candidates.findIndex(candidate=>candidate.source===previous.source&&JSON.stringify(candidate.value??null)===JSON.stringify(previous.candidate_value));
    if(index>=0)select.value=String(index);
    state.textContent=previous.decision==='confirmed'?'Отмечено: подтвердить':'Отмечено: отклонить';
  }
  box.append(select,accept,reject,state);cell.append(box);
}
function correctionControls(name,item,cell){
  const box=document.createElement('div'),input=document.createElement('input'),button=document.createElement('button'),state=document.createElement('span');
  box.className='review-controls';input.type='text';input.maxLength=200;input.placeholder='Уточнённое значение';input.setAttribute('aria-label',`Уточнить ${labels[name]??name}`);
  button.type='button';button.textContent=item.status==='missing'?'Предложить значение':'Пометить ошибку';state.className='decision';
  const previous=reviewDecisions[name];if(previous?.decision==='proposed')input.value=String(previous.candidate_value??'');
  if(previous)state.textContent=previous.decision==='proposed'?'Отмечено: предложено значение':'Отмечено: ошибка';
  button.addEventListener('click',()=>{
    if(item.status==='missing'&&!input.value.trim()){input.focus();state.textContent='Введите значение для проверки';return;}
    reviewDecisions[name]={attribute:name,decision:item.status==='missing'?'proposed':'rejected',candidate_value:item.status==='missing'?input.value.trim():item.value,source:item.source??'manual',evidence:item.evidence??null};
    state.textContent=item.status==='missing'?'Отмечено: предложено значение':'Отмечено: ошибка';$('review-export').hidden=false;
  });
  if(item.status==='missing')box.append(input);
  box.append(button,state);cell.append(box);
}
function renderExamples(query=''){
  const list=$('demo-list');list.replaceChildren();
  const q=query.toLocaleLowerCase().trim();
  const matches=demos.filter(c=>!q||(`${c.title} ${c.category_name??''} ${c.id}`).toLocaleLowerCase().includes(q)).slice(0,100);
  if(!matches.length){const empty=document.createElement('div');empty.className='sku-empty';empty.textContent='Товары не найдены';list.append(empty);return;}
  for(const card of matches){
    const option=document.createElement('button'),id=document.createElement('span'),title=document.createElement('span');
    option.type='button';option.className='sku-option';option.setAttribute('role','option');option.setAttribute('aria-selected',String(activeCard?.id===card.id));option.tabIndex=-1;
    id.className='sku-id';id.textContent=`SKU ${card.id}`;title.className='sku-title';title.textContent=card.title;
    option.append(id,title);option.addEventListener('click',()=>chooseDemo(card));list.append(option);
  }
}
function openPicker(){
  $('demo-list').hidden=false;$('demo-trigger').setAttribute('aria-expanded','true');$('demo-search').setAttribute('aria-expanded','true');
  $('demo-list').querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});
}
function closePicker(){
  $('demo-list').hidden=true;$('demo-trigger').setAttribute('aria-expanded','false');$('demo-search').setAttribute('aria-expanded','false');
}
function chooseDemo(card,focus=true){
  fill(card);$('demo-selected').textContent=`${card.id} · ${card.title}`;$('demo-search').value='';renderExamples();closePicker();if(focus)$('demo-trigger').focus();
}
function fill(card){
  clearResult();
  activeCard=card;$('title').value=card.title??'';$('description').value=card.description??'';$('seller').value=JSON.stringify(card.seller_attributes??{},null,2);$('category-id').value=card.category_id??'';
  $('sku-chip').textContent=`SKU: ${card.id}`;$('traffic-chip').textContent=`Строк запрос–SKU: ${card.traffic_rows===null||card.traffic_rows===undefined?'нет данных':number.format(card.traffic_rows)}`;$('form-error').textContent='';
}
function renderRows(){
  const body=$('rows');body.replaceChildren();if(!lastResult)return;
  const reviewChecks=new Map((lastResult.llm?.review_checks??[]).map(item=>[item.attribute,item]));
  const query=$('attr-filter').value.toLocaleLowerCase().trim();
  for(const [name,item] of Object.entries(lastResult.attributes??{})){
    if(query&&!(`${labels[name]??name} ${item.value??''}`).toLocaleLowerCase().includes(query))continue;
    const row=document.createElement('tr');
    const nameCell=document.createElement('td'),strong=document.createElement('strong');strong.textContent=labels[name]??name;nameCell.append(strong);
    const valueCell=document.createElement('td');valueCell.textContent=item.status==='accepted'?format(name,item.value):item.status==='review'?'Требует проверки':'—';
    const statusCell=document.createElement('td'),pill=document.createElement('span');pill.className=`pill ${item.status==='accepted'?'accepted':item.status==='review'?'review-status':'missing'}`;pill.textContent=item.status==='accepted'?`${Number(item.confidence).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} · принято`:item.status==='review'?'Проверить':'Нет';pill.title='Эвристический балл, не вероятность правильности';statusCell.append(pill);
    const evidenceCell=document.createElement('td');
    if(item.status==='accepted'){
      const text=document.createElement('div');text.textContent=`«${item.evidence?.text??item.raw}»`;
      const small=document.createElement('small');small.textContent=`${sourceLabel(item.source)} · ${methods[item.method]??item.method} · ${reasons[item.reason]??'значение проверено'} · балл ${Number(item.confidence).toLocaleString('ru-RU')} ≥ ${Number(lastResult.decision_policy?.acceptance_threshold??0.8).toLocaleString('ru-RU')}`;evidenceCell.append(text,small);correctionControls(name,item,evidenceCell);
    }else if(item.status==='review'){
      evidenceCell.textContent=item.candidates?.length?
        `${item.candidates.map(x=>`${x.raw} (${methods[x.method]??x.method}; балл ${Number(x.confidence).toLocaleString('ru-RU')})`).join(' / ')} · ${reasons[item.reason]??'требует проверки'}`:
        `${item.evidence?.text??item.raw??'—'} · ${reasons[item.reason]??'требует проверки'}`;
      const check=reviewChecks.get(name);
      if(check){
        const detail=document.createElement('small');
        detail.textContent=check.verdict==='supported'?`LLM подтвердила цитату «${check.evidence.text}»; значение ещё требует проверки по справочнику`:check.verdict==='unsupported'?'LLM указала на возможное несоответствие; нужна проверка человеком':'LLM не смогла подтвердить значение; нужна проверка человеком';
        evidenceCell.append(detail);
      }
      reviewControls(name,item.candidates?.length?item.candidates:[item],evidenceCell);
    }else{evidenceCell.textContent=reasons[item.reason]??'—';correctionControls(name,item,evidenceCell);}
    row.append(nameCell,valueCell,statusCell,evidenceCell);body.append(row);
  }
  for(const item of lastResult.llm?.suggestions??[]){
    const name=labels[item.attribute]??item.attribute;
    if(query&&!(`${name} ${item.value??''}`).toLocaleLowerCase().includes(query))continue;
    const row=document.createElement('tr');row.className='llm-row';
    const nameCell=document.createElement('td'),strong=document.createElement('strong');strong.textContent=name;nameCell.append(strong);
    const valueCell=document.createElement('td');valueCell.textContent=format(item.attribute,item.value);
    const statusCell=document.createElement('td'),pill=document.createElement('span');pill.className='pill review-status';pill.textContent='LLM · проверить';statusCell.append(pill);
    const evidenceCell=document.createElement('td'),quote=document.createElement('div'),source=document.createElement('small');
    quote.textContent=`«${item.evidence?.text??'—'}»`;source.textContent=`${sourceLabel(item.source)} · ${methods[item.method]??item.method}`;evidenceCell.append(quote,source);
    reviewControls(item.attribute,[item],evidenceCell);
    row.append(nameCell,valueCell,statusCell,evidenceCell);body.append(row);
  }
}
function render(data){
  lastResult=data;reviewDecisions={};$('review-export').hidden=true;$('empty').hidden=true;$('result').hidden=false;$('category').textContent=data.category?.label??'Категория не определена';
  const items=Object.values(data.attributes??{}),accepted=items.filter(x=>x.status==='accepted').length,review=items.filter(x=>x.status==='review').length;
  const summary=$('summary');summary.replaceChildren();
  const suggestions=data.llm?.suggestions?.length??0,checks=data.llm?.review_checks?.length??0;
  for(const [value,label] of [[accepted,'принято'],[data.missing_required?.length??0,'обязательных пропущено'],[review,'на проверку'],...(suggestions?[[suggestions,'предложено LLM']]:[]),...(checks?[[checks,'проверено LLM']]:[])] ){const span=document.createElement('span'),b=document.createElement('b');b.textContent=value;span.append(b,` ${label}`);summary.append(span);}
  $('attr-filter').value='';renderRows();
  const notes=[];
  if(data.missing_required?.length)notes.push(`Не найдены обязательные поля: ${data.missing_required.map(x=>labels[x]??x).join(', ')}.`);
  if(review)notes.push(`${review} ${plural(review,'поле требует','поля требуют','полей требуют')} проверки.`);
  if(data.llm?.status==='not_configured')notes.push('LLM на этом стенде не подключена. Для проверки с моделью откройте демо на командной VM.');
  if(data.llm?.status==='unavailable')notes.push('LLM временно недоступна. Результат правил сохранён, пропуски остались без догадки.');
  if(data.llm?.status==='quota_exceeded')notes.push('Дневной лимит LLM исчерпан. Результат правил сохранён; спорные поля требуют проверки.');
  if(data.llm?.status==='skipped_no_evidence')notes.push('LLM не вызывалась: в тексте нет явного основания для отсутствующей характеристики.');
  if(data.llm?.status==='truncated'||data.llm?.status==='invalid_response')notes.push('LLM не вернула полный JSON. Результат правил сохранён, сомнительное значение не добавлено.');
  if(data.llm?.suggestions?.length)notes.push(`LLM предложила ${data.llm.suggestions.length} значений; они остаются на проверке.`);
  if(checks)notes.push(`LLM проверила цитаты для ${checks} ${plural(checks,'поля','полей','полей')}; без справочника допустимых значений они не публикуются автоматически.`);
  if(data.llm?.review_remaining)notes.push(`Проверка LLM ограничена 20 полями за один запрос; ещё ${data.llm.review_remaining} остались без проверки моделью.`);
  $('review').hidden=!notes.length;$('review').textContent=notes.join(' ');
  $('json').textContent=JSON.stringify(data,null,2);
}
$('demo-search').addEventListener('input',e=>{renderExamples(e.target.value);openPicker();});
$('demo-search').addEventListener('focus',()=>{renderExamples($('demo-search').value);openPicker();});
$('demo-search').addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'){e.preventDefault();openPicker();$('demo-list').querySelector('[role="option"]')?.focus();}
  if(e.key==='Escape')closePicker();
});
$('demo-trigger').addEventListener('click',()=>{
  if($('demo-list').hidden){renderExamples($('demo-search').value);openPicker();}else closePicker();
});
$('demo-trigger').addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'){e.preventDefault();openPicker();$('demo-list').querySelector('[role="option"]')?.focus();}
  if(e.key==='Escape')closePicker();
});
$('demo-list').addEventListener('keydown',e=>{
  const options=[...$('demo-list').querySelectorAll('[role="option"]')],index=options.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();options[(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();}
  if(e.key==='Home'){e.preventDefault();options[0]?.focus();}
  if(e.key==='End'){e.preventDefault();options.at(-1)?.focus();}
  if(e.key==='Escape'){e.preventDefault();closePicker();$('demo-trigger').focus();}
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.example-controls'))closePicker();});
$('attr-filter').addEventListener('input',renderRows);
$('card-form').addEventListener('input',e=>{
  if(!['title','description','seller','category-id'].includes(e.target.id)||!activeCard)return;
  clearResult();
  activeCard=null;
  $('demo-selected').textContent='Изменённая карточка';
  $('sku-chip').textContent='SKU: собственная карточка';
  $('traffic-chip').textContent='Строк запрос–SKU: нет данных';
});
$('card-form').addEventListener('submit',async e=>{
  e.preventDefault();$('form-error').textContent='';clearResult();let seller;
  try{seller=JSON.parse($('seller').value||'{}');if(!seller||Array.isArray(seller)||typeof seller!=='object')throw Error();}
  catch{$('form-error').textContent='Атрибуты продавца должны быть JSON-объектом.';return;}
  if(!$('title').value.trim()&&!$('description').value.trim()&&!Object.keys(seller).length){$('form-error').textContent='Введите название, описание или хотя бы один атрибут продавца.';$('title').focus();return;}
  if(Object.keys(seller).length>300){$('form-error').textContent='В атрибутах продавца допускается не более 300 полей.';$('seller').focus();return;}
  const entries=Object.entries(seller);
  if(entries.reduce((count,[,value])=>count+(Array.isArray(value)?value.length:1),0)>1000){$('form-error').textContent='В карточке допускается не более 1000 значений продавца.';$('seller').focus();return;}
  const validValue=value=>typeof value==='string'||typeof value==='number'||(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.value==='string'&&(value.unit===undefined||typeof value.unit==='string'));
  if(entries.some(([key,value])=>!key||key.length>150||(Array.isArray(value)?value.length>100||value.some(item=>!validValue(item)||JSON.stringify(item).length>1000):!validValue(value)||JSON.stringify(value).length>1000))){$('form-error').textContent='Проверьте имена и значения атрибутов: строка, число или объект с value и unit; не более 100 элементов в массиве и 1000 знаков в значении.';$('seller').focus();return;}
  const categoryId=$('category-id').value.trim();
  if($('title').value.length>500||$('description').value.length>100000||categoryId.length>200){$('form-error').textContent='Превышена длина названия (500), описания (100 000) или ID категории (200).';return;}
  const button=$('run');button.disabled=true;button.textContent='Извлекаем…';
  try{
    const card={id:activeCard?.id??'preview',title:$('title').value,description:$('description').value,seller_attributes:seller,category_id:categoryId||null,category_name:activeCard?.category_name??null,traffic_rows:activeCard?.traffic_rows??null};
    const payload=JSON.stringify({card,use_llm:$('use-llm').checked});
    if(new TextEncoder().encode(payload).length>100000)throw Error('Демо принимает до 100 КБ текста карточки. Сократите описание или поля продавца.');
    const response=await fetch('/api/preview',{method:'POST',signal:AbortSignal.timeout($('use-llm').checked?45000:15000),headers:{'content-type':'application/json'},body:payload});
    const type=response.headers.get('content-type')??'';
    if(!type.includes('application/json'))throw Error(`Сервис временно недоступен (HTTP ${response.status}). Повторите запрос.`);
    const data=await response.json();if(!response.ok)throw Error(data.error??`Сервис вернул ошибку ${response.status}`);render(data);
  }catch(error){$('form-error').textContent=error.name==='TimeoutError'?'Превышено время ожидания. Повторите запрос или выключите LLM.':error.name==='TypeError'?'Нет связи с сервисом. Проверьте соединение и повторите запрос.':error.name==='SyntaxError'?'Сервис вернул неполный ответ. Повторите запрос.':error.message;}
  finally{button.disabled=false;button.innerHTML='Извлечь атрибуты <span aria-hidden="true">→</span>';}
});
$('json-open').addEventListener('click',()=>$('json-dialog').showModal());
$('json-close').addEventListener('click',()=>$('json-dialog').close());
$('json-dialog').addEventListener('click',e=>{if(e.target===$('json-dialog'))$('json-dialog').close();});
$('json-dialog').addEventListener('close',()=>$('json-open').focus());
$('copy').addEventListener('click',async()=>{
  if(!lastResult)return;
  try{await navigator.clipboard.writeText(JSON.stringify(lastResult,null,2));$('copy').textContent='Скопировано';}
  catch{$('copy').textContent='Не удалось скопировать';}
  setTimeout(()=>$('copy').textContent='Копировать JSON',1600);
});
$('review-export').addEventListener('click',()=>{
  if(!lastResult||!Object.keys(reviewDecisions).length)return;
  const payload={sku_id:lastResult.id,schema_version:lastResult.schema_version,decisions:Object.values(reviewDecisions)};
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  link.href=url;link.download=`review-${String(lastResult.id).replace(/[^a-z0-9_-]/gi,'_')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
try{
  const [cardResponse,statResponse,capResponse]=await Promise.all([fetch('/api/demo'),fetch('/api/stats'),fetch('/api/capabilities')]);
  if(!cardResponse.ok||!statResponse.ok)throw Error('сервис не вернул данные каталога');
  demos=await cardResponse.json();const stats=await statResponse.json();renderExamples();if(demos.length)chooseDemo(demos[0],false);
  if(capResponse.ok){
    const capabilities=await capResponse.json();
    $('use-llm').checked=capabilities.llm_default===true;
    $('use-llm').disabled=capabilities.llm_available!==true;
  }
  const values={cards:stats.sku_desc_rows,clicks:stats.query_click_rows,categories:stats.taxonomy_categories,overlap:stats.clicked_skus_with_description};
  for(const [key,value] of Object.entries(values))if(Number.isFinite(value))$(`stat-${key}`).textContent=number.format(value);
}catch(error){$('form-error').textContent='Не удалось загрузить данные: '+error.message;}
