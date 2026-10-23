import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path('work/python_deps').resolve()))
import duckdb

root=Path('work/dataset').resolve()
(root/'duckdb_tmp').mkdir(exist_ok=True)
db=duckdb.connect()
db.execute("SET memory_limit='900MB'")
db.execute("SET threads=2")
db.execute(f"SET temp_directory='{(root/'duckdb_tmp').as_posix()}'")
click=(root/'query_clicks.parquet').as_posix()
desc=(root/'sku_desc.parquet').as_posix()
sql=f"""
WITH traffic AS (
  SELECT sku_id,count(*) click_rows FROM read_parquet('{click}') GROUP BY 1
), candidates AS (
  SELECT d.sku_id,d.title,substr(d.description,1,600) description,t.click_rows,
  CASE
    WHEN lower(d.title) LIKE '%смартфон%' THEN 'smartphone'
    WHEN lower(d.title) LIKE '%ноутбук%' THEN 'laptop'
    WHEN lower(d.title) LIKE '%стиральн%' THEN 'washing_machine'
    WHEN lower(d.title) LIKE '%холодильник%' THEN 'refrigerator'
    WHEN lower(d.title) LIKE '%телевизор%' THEN 'tv'
    WHEN lower(d.title) LIKE '%чайник%' THEN 'kettle'
    WHEN lower(d.title) LIKE '%футболк%' THEN 'clothing'
    ELSE 'other' END group_name
  FROM read_parquet('{desc}') d JOIN traffic t ON d.sku_id=t.sku_id
), ranked AS (
 SELECT *,row_number() OVER(PARTITION BY group_name ORDER BY click_rows DESC) rn FROM candidates
)
SELECT sku_id,title,description,click_rows,group_name FROM ranked WHERE rn<=15 ORDER BY group_name,click_rows DESC
"""
rows=db.execute(sql).fetchall()
records=[dict(zip(['sku_id','title','description','click_rows','group_name'],row)) for row in rows]
Path('work/selected_skus.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print('SELECTED',len(records))
for row in records[:30]: print(row['group_name'],row['sku_id'],row['click_rows'],row['title'])
