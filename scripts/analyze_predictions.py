"""Technical coverage summary of the full JSONL prediction file (not a gold evaluation)."""
import argparse
import gzip
import json
from collections import Counter
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--input',default='data/predictions_full.jsonl.gz',type=Path)
parser.add_argument('--output',default='reports/prediction_summary.json',type=Path)
args=parser.parse_args()
cards=0;failed=0;with_accepted=0;with_review=0;with_missing_required=0
status=Counter();attribute_accepted=Counter();categories=Counter()
with gzip.open(args.input,'rt',encoding='utf-8') as stream:
    for line in stream:
        record=json.loads(line)
        cards+=1
        if record.get('status')=='error':
            failed+=1
            continue
        entries=record.get('attributes',{}).items()
        statuses=[item.get('status') for _,item in entries]
        if 'accepted' in statuses:with_accepted+=1
        if 'review' in statuses:with_review+=1
        if record.get('missing_required'):with_missing_required+=1
        categories[record.get('category',{}).get('label') or 'не определена']+=1
        for name,item in record.get('attributes',{}).items():
            status[item.get('status','unknown')]+=1
            if item.get('status')=='accepted':attribute_accepted[name]+=1
summary={'type':'technical coverage, not accuracy',
         'cards':cards,'failed_cards':failed,'cards_with_accepted_attribute':with_accepted,
         'cards_with_review':with_review,'cards_with_missing_required':with_missing_required,
         'attribute_status_counts':dict(status),
         'top_accepted_attributes':attribute_accepted.most_common(20),
         'top_categories':categories.most_common(15)}
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
