"""Stream plain-data pickle opcodes into compact catalog records and schema stats."""
import gzip
import json
import pickletools
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

MARK = object()
root = Path('work')
source = root / 'dataset/skus.pkl'
refs = (root / 'dataset/memo_refs.bin').read_bytes()
selected = {str(item['sku_id']) for item in json.loads((root/'selected_skus.json').read_text(encoding='utf-8'))}
selected_offers = {}
category_counts = Counter()
attribute_counts = Counter()
category_attributes = defaultdict(Counter)
seller_counts = Counter()
has_params = 0
start = time.time()
categories = []

def referenced(index):
    byte = index >> 3
    return byte < len(refs) and bool(refs[byte] & (1 << (index & 7)))

class OfferSink:
    def __init__(self, output):
        self.output = output
        self.count = 0
    def extend(self, offers):
        global has_params
        for offer in offers:
            if not isinstance(offer, dict): continue
            sku_id = str(offer.get('@id',''))
            cat = offer.get('categories') or {}
            cat_id = str(cat.get('categoryId','')) if isinstance(cat,dict) else ''
            params = offer.get('param') or []
            if isinstance(params,dict): params = [params]
            if params: has_params += 1
            attributes = []
            seller = None
            seen = set()
            for param in params:
                if not isinstance(param,dict): continue
                name = str(param.get('@name','')).strip()
                value = param.get('#text')
                if not name or value is None: continue
                unit = param.get('@unit')
                attributes.append({'name':name,'value':str(value),'unit':str(unit) if unit is not None else None})
                base = name.removesuffix('_search')
                if name == 'Продавец': seller = str(value)
                if name.endswith('_search') and base not in seen:
                    attribute_counts[base] += 1
                    category_attributes[cat_id][base] += 1
                    seen.add(base)
            rec = {'sku_id':sku_id,'category_id':cat_id,'brand':offer.get('vendor'),
                   'model':offer.get('model'),'name':offer.get('name'),
                   'seller':seller,'attributes':attributes}
            self.output.write(json.dumps(rec,ensure_ascii=False,separators=(',',':'),default=str)+'\n')
            if sku_id in selected: selected_offers[sku_id] = rec
            category_counts[cat_id] += 1
            seller_counts[seller or 'не указан'] += 1
            self.count += 1
            if self.count % 100_000 == 0:
                print(f'OFFERS {self.count:,} elapsed {time.time()-start:.0f}s',flush=True)

stack=[]; memo={}; memo_next=0; sink=None
with gzip.open(root/'dataset/offers_compact.jsonl.gz','wt',encoding='utf-8',compresslevel=1) as output:
    with source.open('rb') as stream:
        for op,arg,pos in pickletools.genops(stream):
            code=op.name
            if code in ('PROTO','FRAME'): continue
            if code=='MARK': stack.append(MARK)
            elif code=='EMPTY_DICT': stack.append({})
            elif code=='EMPTY_LIST':
                if stack and stack[-1]=='offer' and sink is None:
                    group=next((v for v in reversed(stack) if isinstance(v,dict) and 'category' in v),None)
                    categories=group['category'] if group else []
                    print('CATEGORIES',len(categories),flush=True)
                    sink=OfferSink(output); stack.append(sink)
                else: stack.append([])
            elif code in ('SHORT_BINUNICODE','BINUNICODE','BINUNICODE8','UNICODE','BININT1','BININT2','BININT','LONG1','LONG4','NEWTRUE','NEWFALSE','NONE'):
                stack.append({'NEWTRUE':True,'NEWFALSE':False,'NONE':None}.get(code,arg))
            elif code=='MEMOIZE':
                if referenced(memo_next): memo[memo_next]=stack[-1]
                memo_next+=1
            elif code in ('BINGET','LONG_BINGET','GET'): stack.append(memo[int(arg)])
            elif code in ('BINPUT','LONG_BINPUT','PUT'):
                if referenced(int(arg)): memo[int(arg)]=stack[-1]
            elif code=='SETITEM':
                value=stack.pop(); key=stack.pop(); stack[-1][key]=value
            elif code=='APPEND':
                value=stack.pop(); stack[-1].append(value)
            elif code in ('SETITEMS','APPENDS'):
                mark=len(stack)-1
                while stack[mark] is not MARK: mark-=1
                values=stack[mark+1:];del stack[mark:]
                target=stack[-1]
                if code=='SETITEMS': target.update(zip(values[0::2],values[1::2]))
                else: target.extend(values)
            elif code=='STOP': break
            else: raise RuntimeError(f'Unsupported opcode {code} at {pos}')

(root/'catalog_categories.json').write_text(json.dumps(categories,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'selected_offers.json').write_text(json.dumps(selected_offers,ensure_ascii=False,indent=2),encoding='utf-8')
stats={'offers':sink.count if sink else 0,'with_params':has_params,
       'categories':len(categories),'categories_with_offers':len(category_counts),
       'selected_offers':len(selected_offers),
       'top_categories':category_counts.most_common(50),
       'top_attributes_search':attribute_counts.most_common(100),
       'top_sellers':seller_counts.most_common(50),
       'category_counts':category_counts,
       'category_attributes':{k:v.most_common() for k,v in category_attributes.items()}}
(root/'catalog_stats.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
print('DONE',stats['offers'],'offers',stats['selected_offers'],'selected','seconds',round(time.time()-start),flush=True)
