import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path('work/python_deps').resolve()))
import duckdb

root = Path('work/dataset').resolve()
(root/'duckdb_tmp').mkdir(exist_ok=True)
db = duckdb.connect()
db.execute("SET memory_limit='1200MB'")
db.execute("SET threads=2")
db.execute(f"SET temp_directory='{(root/'duckdb_tmp').as_posix()}'")
desc = (root/'sku_desc.parquet').as_posix()
click = (root/'query_clicks.parquet').as_posix()
result = {}

def run(label, query):
    started=time.time()
    rows=db.execute(query).fetchall()
    result[label]=rows
    print(label, 'rows', len(rows), 'seconds', round(time.time()-started,1), flush=True)

run('desc_summary',f"""
SELECT count(*), count(DISTINCT sku_id),
sum(CASE WHEN title IS NULL OR trim(title)='' THEN 1 ELSE 0 END),
sum(CASE WHEN description IS NULL OR trim(description)='' THEN 1 ELSE 0 END),
min(length(title)), approx_quantile(length(title),0.5), approx_quantile(length(title),0.9), max(length(title)),
min(length(description)), approx_quantile(length(description),0.5), approx_quantile(length(description),0.9), max(length(description))
FROM read_parquet('{desc}')""")
run('click_summary',f"""
SELECT count(*), approx_count_distinct(sku_id), approx_count_distinct("toValidUTF8(query_text)"),
sum(CASE WHEN "toValidUTF8(query_text)" IS NULL OR trim("toValidUTF8(query_text)")='' THEN 1 ELSE 0 END),
sum(CASE WHEN "toValidUTF8(sku_name)" IS NULL OR trim("toValidUTF8(sku_name)")='' THEN 1 ELSE 0 END),
sum(CASE WHEN "toValidUTF8(sku_brand_name)" IS NULL OR trim("toValidUTF8(sku_brand_name)")='' THEN 1 ELSE 0 END),
sum(CASE WHEN sku_price IS NULL THEN 1 ELSE 0 END),
min(sku_position),approx_quantile(sku_position,0.5),max(sku_position)
FROM read_parquet('{click}')""")
run('top_queries',f"""SELECT "toValidUTF8(query_text)" q,count(*) n FROM read_parquet('{click}') GROUP BY 1 ORDER BY n DESC LIMIT 20""")
run('top_subjects',f"""SELECT sku_subject_id,count(*) n FROM read_parquet('{click}') GROUP BY 1 ORDER BY n DESC LIMIT 20""")
run('top_skus',f"""SELECT sku_id,count(*) n FROM read_parquet('{click}') GROUP BY 1 ORDER BY n DESC LIMIT 20""")
run('description_click_overlap',f"""
WITH clicked AS (SELECT DISTINCT sku_id FROM read_parquet('{click}'))
SELECT count(*),sum(CASE WHEN d.sku_id IS NOT NULL THEN 1 ELSE 0 END)
FROM clicked c LEFT JOIN read_parquet('{desc}') d ON c.sku_id=d.sku_id""")
run('desc_duplicates',f"""SELECT count(*) FROM (SELECT sku_id FROM read_parquet('{desc}') GROUP BY 1 HAVING count(*)>1)""")
Path('work/parquet_eda.json').write_text(json.dumps(result,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
print('WROTE work/parquet_eda.json',flush=True)
