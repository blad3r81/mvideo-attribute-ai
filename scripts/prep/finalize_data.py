import json
import sys
from pathlib import Path

sys.path.insert(0, 'work/python_deps')
import duckdb

root = Path('data')
catalog_stats = json.loads(Path('work/catalog_stats.json').read_text(encoding='utf-8'))
schema = json.loads((root / 'catalog_schema.json').read_text(encoding='utf-8'))
for category_id, attrs in catalog_stats['category_attributes'].items():
    if category_id in schema['categories']:
        schema['categories'][category_id]['search_attributes'] = [
            {'name': name, 'count': count} for name, count in attrs
        ]
schema['version'] = 'archive-catalog-v1'
(root / 'catalog_schema.json').write_text(json.dumps(schema, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

stats = json.loads((root / 'dataset_stats.json').read_text(encoding='utf-8'))
stats.update({
    'catalog_offers': catalog_stats['offers'],
    'catalog_offers_with_params': catalog_stats['with_params'],
    'categories_with_offers': catalog_stats['categories_with_offers'],
    'search_attribute_names': len({name for attrs in catalog_stats['category_attributes'].values() for name, _ in attrs}),
    'top_categories': catalog_stats['top_categories'][:15],
    'top_attributes_search': catalog_stats['top_attributes_search'][:20],
    'top_sellers': catalog_stats['top_sellers'][:15],
})
(root / 'dataset_stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding='utf-8')

selected = json.loads(Path('work/selected_skus.json').read_text(encoding='utf-8'))
offers = json.loads(Path('work/selected_offers.json').read_text(encoding='utf-8'))
ids = [str(record['sku_id']) for record in selected]
db = duckdb.connect()
full_descriptions = dict(db.execute(
    "SELECT CAST(sku_id AS VARCHAR), description FROM read_parquet('work/dataset/sku_desc.parquet') WHERE CAST(sku_id AS VARCHAR) IN (SELECT UNNEST(?))",
    [ids],
).fetchall())

cards = []
for entry in selected:
    sku_id = str(entry['sku_id'])
    offer = offers.get(sku_id)
    if not offer:
        continue
    seller_attrs = {}
    if offer.get('brand'):
        seller_attrs['Бренд'] = str(offer['brand'])
    if offer.get('model'):
        seller_attrs['Модель'] = str(offer['model'])
    for attr in offer['attributes']:
        name = attr['name']
        if name in ('Продавец', 'Потратить бонусы'):
            continue
        value = str(attr['value']) + ((' ' + str(attr['unit'])) if attr.get('unit') else '')
        if name in seller_attrs:
            if isinstance(seller_attrs[name], list):
                seller_attrs[name].append(value)
            else:
                seller_attrs[name] = [seller_attrs[name], value]
        else:
            seller_attrs[name] = value
    category_id = offer.get('category_id')
    category = schema['categories'].get(category_id, {})
    cards.append({
        'id': sku_id,
        'title': entry['title'],
        'description': full_descriptions.get(sku_id, entry['description']),
        'seller_attributes': seller_attrs,
        'category_id': category_id,
        'category_name': category.get('label', ''),
        'traffic_rows': entry['click_rows'],
        'demo_group': entry['group_name'],
    })
(root / 'real_cards.json').write_text(json.dumps(cards, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('schema categories', len(schema['categories']), 'real demo cards', len(cards), 'of', len(selected))
