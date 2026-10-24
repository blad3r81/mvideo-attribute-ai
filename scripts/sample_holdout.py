"""Prepare unseen cards from the supplied archive for human gold annotation.

This script never copies catalog attribute values into gold labels. It only
reconstructs the text fields that the service receives at inference time.
"""
import argparse
import hashlib
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

import pyarrow.parquet as pq


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('work/holdout_cards.json'))
    parser.add_argument('--demo-cards', type=Path, default=Path('data/real_cards.json'))
    parser.add_argument('--exclude-cards', type=Path, action='append', default=[],
                        help='Previously reviewed card JSON; can be repeated')
    parser.add_argument('--categories', nargs='+', default=['761', '914', '987'])
    parser.add_argument('--per-category', type=int, default=10)
    args = parser.parse_args()
    if not 1 <= args.per_category <= 100:
        parser.error('--per-category must be 1..100')

    demo_ids = {str(card['id']) for card in json.loads(args.demo_cards.read_text(encoding='utf-8'))}
    excluded_ids = set(demo_ids)
    for source in args.exclude_cards:
        excluded_ids.update(str(card['id']) for card in json.loads(source.read_text(encoding='utf-8')))
    wanted = set(args.categories)
    offers = defaultdict(list)
    with sqlite3.connect(args.dataset_dir / 'offers_index.sqlite') as db:
        for sku_id, raw in db.execute('SELECT sku_id,data FROM offers'):
            if str(sku_id) in excluded_ids:
                continue
            offer = json.loads(raw)
            category = str(offer.get('category_id'))
            if category not in wanted:
                continue
            score = hashlib.sha256(f'holdout-v1:{sku_id}'.encode()).hexdigest()
            offers[category].append((score, str(sku_id), offer))
    for category in offers:
        offers[category].sort()
        # Many indexed offers have no matching text row. Keep a wider candidate
        # pool so a sparse category does not fail after just a few matches.
        offers[category] = offers[category][:args.per_category * 200]

    candidates = {sku_id: (category, offer) for category, items in offers.items()
                  for _, sku_id, offer in items}
    selected = defaultdict(list)
    source = pq.ParquetFile(args.dataset_dir / 'sku_desc.parquet')
    for batch in source.iter_batches(batch_size=8000, columns=['sku_id', 'title', 'description']):
        for item in batch.to_pylist():
            sku_id = str(item['sku_id'])
            if sku_id not in candidates or not item.get('title'):
                continue
            category, offer = candidates[sku_id]
            seller = {}
            if offer.get('brand'):
                seller['Бренд'] = str(offer['brand'])
            if offer.get('model'):
                seller['Модель'] = str(offer['model'])
            for field in offer.get('attributes', []):
                name = field.get('name')
                if not name or name in ('Продавец', 'Потратить бонусы'):
                    continue
                value = str(field.get('value') or '')
                if field.get('unit'):
                    value += ' ' + str(field['unit'])
                if value.strip():
                    if name not in seller:
                        seller[name] = value
                    elif isinstance(seller[name], list):
                        seller[name].append(value)
                    else:
                        seller[name] = [seller[name], value]
            selected[category].append({
                'id': sku_id, 'category_id': category,
                'title': item['title'], 'description': item.get('description') or '',
                'seller_attributes': seller,
            })

    cards = []
    for category in args.categories:
        by_id = {card['id']: card for card in selected[category]}
        ordered = [by_id[sku_id] for _, sku_id, _ in offers[category] if sku_id in by_id]
        cards.extend(ordered[:args.per_category])
        if len(ordered) < args.per_category:
            raise RuntimeError(f'Only {len(ordered)} source cards available in category {category}')
    assert not {card['id'] for card in cards} & excluded_ids
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(cards)} unseen cards in {args.output}; categories: {args.categories}')


if __name__ == '__main__':
    main()
