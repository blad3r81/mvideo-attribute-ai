"""Join archive text with seller fields by SKU, then run the same Node extractor as the API."""
import argparse
import gzip
import json
import sqlite3
import subprocess
import sys
import os
import threading
import time
from pathlib import Path

import pyarrow.parquet as pq

parser=argparse.ArgumentParser()
parser.add_argument('--dataset-dir',required=True,type=Path)
parser.add_argument('--output',default='data/predictions_full.jsonl.gz',type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
dataset=args.dataset_dir.resolve()
output=(root/args.output).resolve()
output.parent.mkdir(parents=True,exist_ok=True)
index=dataset/'offers_index.sqlite'
for required_file in ('offers_compact.jsonl.gz','sku_desc.parquet'):
    if not (dataset/required_file).is_file():
        raise FileNotFoundError(f'Missing dataset input: {dataset/required_file}')

if not index.exists():
    partial=index.with_suffix('.sqlite.partial')
    partial.unlink(missing_ok=True)
    try:
        with sqlite3.connect(partial) as building:
            building.execute('CREATE TABLE offers(sku_id TEXT PRIMARY KEY, data TEXT)')
            with gzip.open(dataset/'offers_compact.jsonl.gz','rt',encoding='utf-8') as stream:
                buffer=[]
                for line in stream:
                    rec=json.loads(line)
                    buffer.append((rec['sku_id'],line.strip()))
                    if len(buffer)==10000:
                        building.executemany('INSERT OR REPLACE INTO offers VALUES (?,?)',buffer)
                        building.commit();buffer=[]
                if buffer:building.executemany('INSERT OR REPLACE INTO offers VALUES (?,?)',buffer)
            building.commit()
        os.replace(partial,index)
    finally:
        partial.unlink(missing_ok=True)
db=sqlite3.connect(index,timeout=30)
db.row_factory=sqlite3.Row
schema_path=Path(os.environ.get('CATALOG_SCHEMA_PATH') or root/'data/catalog_schema.json')
schema=json.loads(schema_path.read_text(encoding='utf-8'))
if not isinstance(schema.get('categories'),dict):
    raise ValueError('Invalid catalog schema: categories must be an object')
temporary=output.with_name(output.name+'.partial')
temporary.unlink(missing_ok=True)
batch_summary=output.with_name(output.name+'.summary.partial.json')
batch_summary.unlink(missing_ok=True)
idle_timeout=int(os.environ.get('BATCH_IDLE_TIMEOUT_SEC','300'))
if idle_timeout<30 or idle_timeout>3600:
    raise ValueError('BATCH_IDLE_TIMEOUT_SEC must be between 30 and 3600')
process=subprocess.Popen(['node','scripts/predict_stream.js',str(temporary),str(batch_summary)],cwd=root,stdin=subprocess.PIPE,text=True,encoding='utf-8')
last_progress=[time.monotonic()]
watchdog_stop=threading.Event()
def stop_stalled_child():
    while not watchdog_stop.wait(5):
        if process.poll() is not None:
            return
        if time.monotonic()-last_progress[0]>idle_timeout:
            print('Node predictor stalled; stopping child process',file=sys.stderr,flush=True)
            process.kill()
            return
watchdog=threading.Thread(target=stop_stalled_child,daemon=True)
watchdog.start()
count=0;matched=0
try:
    parquet=pq.ParquetFile(dataset/'sku_desc.parquet')
    for batch in parquet.iter_batches(batch_size=8000,columns=['sku_id','title','description']):
        records=batch.to_pylist()
        ids=[str(x['sku_id']) for x in records]
        offers={}
        for start in range(0,len(ids),900):
            group=ids[start:start+900]
            placeholders=','.join('?'*len(group))
            offers.update({row['sku_id']:json.loads(row['data']) for row in db.execute(f'SELECT sku_id,data FROM offers WHERE sku_id IN ({placeholders})',group)})
        for record in records:
            sku_id=str(record['sku_id']); offer=offers.get(sku_id)
            seller={}
            category_id=None;category_name=None
            if offer:
                matched+=1
                category_id=offer['category_id']
                category_name=schema['categories'].get(category_id,{}).get('label')
                if offer.get('brand'):seller['Бренд']=str(offer['brand'])
                if offer.get('model'):seller['Модель']=str(offer['model'])
                for attr in offer['attributes']:
                    name=attr['name']
                    if name in ('Продавец','Потратить бонусы'):continue
                    value=str(attr['value'])+((' '+str(attr['unit'])) if attr.get('unit') else '')
                    if name in seller:
                        if isinstance(seller[name],list):seller[name].append(value)
                        else:seller[name]=[seller[name],value]
                    else:seller[name]=value
            card={'id':sku_id,'title':record['title'],'description':record['description'],
                  'seller_attributes':seller,'category_id':category_id,'category_name':category_name}
            # Escape U+2028/U+2029: Node readline treats them as line separators.
            if process.poll() is not None:
                raise RuntimeError(f'Node predictor exited early with code {process.returncode}')
            process.stdin.write(json.dumps(card,ensure_ascii=True,separators=(',',':'))+'\n')
            last_progress[0]=time.monotonic()
            count+=1
        process.stdin.flush()
        if count%80000<8000:print('JOINED',count,'MATCHED',matched,flush=True)
    process.stdin.close()
    try:
        code=process.wait(timeout=120)
    except subprocess.TimeoutExpired:
        process.kill();process.wait()
        raise RuntimeError('Node predictor did not finish after input closed')
    if code:
        raise RuntimeError(f'Node predictor exited {code}')
    summary=json.loads(batch_summary.read_text(encoding='utf-8'))
    if summary['cards']!=count or summary['predicted']+summary['failed']!=count:
        raise RuntimeError('Batch prediction count mismatch')
    os.replace(temporary,output)
except Exception:
    if process.poll() is None:
        process.kill()
    process.wait()
    temporary.unlink(missing_ok=True)
    raise
finally:
    watchdog_stop.set()
    watchdog.join(timeout=1)
    batch_summary.unlink(missing_ok=True)
    db.close()
print('DONE',count,'MATCHED',matched,'OUTPUT',output,flush=True)
run={'cards':count,'with_catalog_offer':matched,'without_catalog_offer':count-matched,
     'predicted':summary['predicted'],'failed':summary['failed'],
     'output':str(output.relative_to(root)) if output.is_relative_to(root) else str(output)}
(root/'reports/prediction_run.json').write_text(json.dumps(run,ensure_ascii=False,indent=2),encoding='utf-8')
stats_path=root/'data/dataset_stats.json'
stats=json.loads(stats_path.read_text(encoding='utf-8'))
stats['catalog_description_overlap']=matched
stats_path.write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
