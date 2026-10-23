"""Silver-only ML comparison: learn color from titles, hold out SKU rows."""
import argparse
import gzip
import json
from collections import Counter
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_score
from sklearn.model_selection import train_test_split

parser=argparse.ArgumentParser()
parser.add_argument('--offers',required=True,type=Path)
parser.add_argument('--output',default='reports/silver_color_experiment.json',type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent

aliases={'черный':'чёрный','чёрный':'чёрный','black':'чёрный',
         'белый':'белый','white':'белый','красный':'красный','red':'красный',
         'синий':'синий','blue':'синий','серый':'серый','grey':'серый','gray':'серый',
         'зеленый':'зелёный','зелёный':'зелёный','green':'зелёный',
         'серебристый':'серебристый','silver':'серебристый'}
texts=[];labels=[]
with gzip.open(args.offers,'rt',encoding='utf-8') as stream:
    for line in stream:
        offer=json.loads(line)
        colors={aliases.get(str(a['value']).strip().lower()) for a in offer['attributes'] if a['name'] in ('Цвет_search','Цвет')}
        colors.discard(None)
        title=str(offer.get('name') or '').strip()
        if len(colors)!=1 or not title:continue
        texts.append(title)
        labels.append(next(iter(colors)))
        if len(texts)>=60000:break

train_x,test_x,train_y,test_y=train_test_split(texts,labels,test_size=0.25,random_state=42,stratify=labels)
vectorizer=TfidfVectorizer(analyzer='char',ngram_range=(2,4),min_df=3,max_features=100000)
train_v=vectorizer.fit_transform(train_x)
test_v=vectorizer.transform(test_x)
model=SGDClassifier(loss='log_loss',alpha=1e-5,random_state=42)
model.fit(train_v,train_y)
model_guess=model.predict(test_v)

def rule(title):
    words=set(title.lower().replace('ё','е').split())
    found={canonical for alias,canonical in aliases.items() if alias.replace('ё','е') in words}
    return next(iter(found)) if len(found)==1 else None

baseline=[rule(text) for text in test_x]
safe_model=[guess if rule(text)==guess else None for text,guess in zip(test_x,model_guess)]
def score(predictions):
    accepted=[(gold,pred) for gold,pred in zip(test_y,predictions) if pred is not None]
    correct=sum(gold==pred for gold,pred in accepted)
    return {'coverage':round(len(accepted)/len(test_y),4),
            'accepted_precision_proxy':round(correct/len(accepted),4) if accepted else None,
            'correct_rows':correct,'accepted_rows':len(accepted)}

result={'label_type':'silver catalog color; not a human gold set',
        'sample_rows':len(texts),'train_rows':len(train_x),'test_rows':len(test_x),
        'class_counts':dict(Counter(labels)),
        'rules':score(baseline),
        'ml_raw':{'accuracy_proxy':round(accuracy_score(test_y,model_guess),4),
                  'macro_f1_proxy':round(f1_score(test_y,model_guess,average='macro'),4)},
        'ml_evidence_gated':score(safe_model),
        'note':'The model is not deployed: raw predictions lack literal evidence; gated predictions are review candidates only.'}
output=root/args.output;output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
