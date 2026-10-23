import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleApi} from './api-handler.js';
import {log} from './log.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicDir=path.join(root,'public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.pdf':'application/pdf'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/'))return handleApi(req,res);
    if(req.method!=='GET'){
      res.writeHead(405,{'content-type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({error:'Метод не поддерживается'}));
    }
    if(url.pathname==='/presentation'){
      const file=path.join(root,'presentation/index.html');
      if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
      const stream=fs.createReadStream(file);stream.on('error',error=>{log('error','static_file_error',{reason:error.code??error.name});res.destroy(error);});
      res.writeHead(200,{'content-type':types['.html']});return stream.pipe(res);
    }
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!['index.html','app.js','styles.css','product-brief-checkpoint.pdf'].includes(name)){
      res.writeHead(404,{'content-type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({error:'Не найдено'}));
    }
    const file=path.join(publicDir,name);
    if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
    const stream=fs.createReadStream(file);stream.on('error',error=>{log('error','static_file_error',{reason:error.code??error.name});res.destroy(error);});
    res.writeHead(200,{'content-type':types[path.extname(file)],'cache-control':'no-store'});
    stream.pipe(res);
  }catch(error){
    log('error','http_error',{reason:error.name??'Error'});
    res.writeHead(500,{'content-type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:'Внутренняя ошибка сервиса'}));
  }
});
server.requestTimeout=15_000;
server.headersTimeout=10_000;
server.keepAliveTimeout=5_000;
const port=Number(process.env.PORT||4174);
const host=process.env.HOST||'127.0.0.1';
if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('PORT must be an integer from 1 to 65535');
server.on('error',error=>{log('error','server_startup_error',{reason:error.code??error.name});process.exitCode=1;});
server.listen(port,host,()=>console.log(`http://${host}:${port}`));
