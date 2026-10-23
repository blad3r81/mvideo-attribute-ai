// Export human-completed tasks only; never infer labels from model predictions.
import fs from 'node:fs';
import path from 'node:path';

const [tasksPath,outputPath,manifestPath]=process.argv.slice(2);
if(!tasksPath||!outputPath)throw Error('Usage: node scripts/gold_to_eval.js completed_tasks.json gold.json [original_unlabeled_tasks.json]');
const tasks=JSON.parse(fs.readFileSync(tasksPath,'utf8'));
if(!Array.isArray(tasks)||!tasks.length)throw Error('Completed tasks must be a nonempty array');
if(manifestPath){
  const original=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(!Array.isArray(original)||original.length!==tasks.length)throw Error('Completed task count does not match frozen manifest');
  const byId=new Map(original.map(row=>[String(row.id),row]));
  if(byId.size!==original.length)throw Error('Duplicate ID in frozen manifest');
  for(const task of tasks){
    const source=byId.get(String(task.id));
    if(!source||String(task.category)!==String(source.category)||
      JSON.stringify(Object.keys(task.attributes??{}).sort())!==JSON.stringify(Object.keys(source.attributes??{}).sort()))
      throw Error(`Card or field list changed from frozen manifest: ${task.id}`);
  }
}
const ids=new Set();
const gold=tasks.map(task=>{
  const id=String(task.id??'');
  if(!id||ids.has(id))throw Error(`Missing or duplicate ID ${id}`);
  ids.add(id);
  if(!task.attributes||!Object.keys(task.attributes).length||Object.values(task.attributes).some(value=>value==='__UNLABELED__'||(value!==null&&!['string','number'].includes(typeof value))))throw Error(`Card ${id} has incomplete or invalid labels`);
  return {id,category:task.category??'unknown',seller_id:task.seller_id??'unknown',traffic_rows:task.traffic_rows??null,attributes:task.attributes};
});
fs.mkdirSync(path.dirname(outputPath),{recursive:true});
fs.writeFileSync(outputPath,JSON.stringify(gold,null,2)+'\n');
console.log(`${gold.length} completed gold cards in ${outputPath}`);
