// Structured operational events. Never pass card text, authorization headers or API keys.
export function log(level,event,fields={}){
  const entry={time:new Date().toISOString(),level,event,...fields};
  (level==='error'?console.error:level==='warn'?console.warn:console.log)(JSON.stringify(entry));
}
