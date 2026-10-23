import readline from 'node:readline';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {finished} from 'node:stream/promises';
import {extract} from '../src/catalog-extractor.js';
import {log} from '../src/log.js';

const outputPath=process.argv[2];
const summaryPath=process.argv[3];
if(!outputPath)throw Error('Usage: node scripts/predict_stream.js predictions.jsonl.gz');
const output=fs.createWriteStream(outputPath);
const gzip=zlib.createGzip({level:1});
gzip.pipe(output);
gzip.on('error',error=>output.destroy(error));
const completion=finished(output);
completion.catch(()=>{});
let count=0,failed=0;
try{
  for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
    if(!line)continue;
    count++;
    let prediction,card;
    try{
      card=JSON.parse(line);
      prediction=extract(card);
    }catch(error){
      failed++;
      prediction={id:card?.id==null?null:String(card.id),input_row:count,status:'error',error:{code:'EXTRACTION_FAILED'},category:{},attributes:{},missing_required:[]};
      if(failed<=20)log('warn','batch_card_failed',{row:count,reason:error.name??'Error'});
    }
    if(!gzip.write(JSON.stringify(prediction)+'\n'))await new Promise((resolve,reject)=>{gzip.once('drain',resolve);gzip.once('error',reject);});
    if(count%100000===0)log('info','batch_progress',{cards:count,failed});
  }
  if(!count||failed===count)throw Error('No cards were extracted successfully');
  gzip.end();
  await completion;
  if(summaryPath)fs.writeFileSync(summaryPath,JSON.stringify({cards:count,predicted:count-failed,failed})+'\n');
  log('info','batch_completed',{cards:count,failed});
}catch(error){
  gzip.destroy();output.destroy();
  fs.rmSync(outputPath,{force:true});
  if(summaryPath)fs.rmSync(summaryPath,{force:true});
  log('error','batch_failed',{cards:count,failed,reason:error.name??'Error'});
  process.exitCode=1;
}
