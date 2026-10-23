import json
from pathlib import Path

root=Path('data')
root.mkdir(parents=True,exist_ok=True)
categories=json.loads(Path('work/catalog_categories.json').read_text(encoding='utf-8'))
by_id={str(row['@id']):{'label':row.get('#text',''),'parent_id':row.get('@parentId'),'search_attributes':[]} for row in categories}
schema={'version':'catalog-2026-05-13','source':'skus.pkl','categories':by_id}
(root/'catalog_schema.json').write_text(json.dumps(schema,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
eda=json.loads(Path('work/parquet_eda.json').read_text(encoding='utf-8'))
desc=eda['desc_summary'][0];click=eda['click_summary'][0];overlap=eda['description_click_overlap'][0]
stats={'sku_desc_rows':desc[0],'sku_desc_unique':desc[1],'sku_title_missing':desc[2],
       'sku_description_missing':desc[3],'title_length_median':desc[5],
       'description_length_median':desc[9],
       'query_click_rows':click[0],'query_blank_rows':click[3],
       'click_sku_name_blank_rows':click[4],'click_brand_blank_rows':click[5],
       'clicked_unique_skus':overlap[0],'clicked_skus_with_description':overlap[1],
       'taxonomy_categories':len(categories),'top_queries':eda['top_queries']}
(root/'dataset_stats.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
print('SCHEMA',len(by_id),'STATS',stats['sku_desc_rows'],stats['query_click_rows'])
