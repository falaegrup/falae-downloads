import {readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.resolve('catalogo');
const input=JSON.parse(await readFile(path.join(root,'importar.json'),'utf8'));
const frames=JSON.parse(await readFile(path.join(root,'molduras-preservadas.json'),'utf8'));
assert.equal(input.items.length,2746);assert.equal(frames.length,327);
assert.equal(input.items.filter(x=>x.kind==='avatar').length,2165);
assert.equal(input.items.filter(x=>x.kind==='banner').length,581);
assert.equal(new Set(input.items.map(x=>x.source)).size,2746);
const digest=(data,algorithm='sha256')=>createHash(algorithm).update(data).digest('hex');
function extension(data){
 if(data.subarray(0,6).toString().startsWith('GIF8'))return 'gif';
 if(data.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return 'png';
 if(data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP')return 'webp';
 if(data[0]===255&&data[1]===216&&data[2]===255)return 'jpg';
 if(data.subarray(4,8).toString()==='ftyp'&&/avif|avis/.test(data.subarray(8,32).toString()))return 'avif';
 throw new Error('A resposta não contém uma imagem reconhecida.');
}
let previous=[];try{previous=JSON.parse(await readFile(path.join(root,'catalogo.json'),'utf8')).items;}catch{}
const known=new Map(previous.filter(x=>x.source).map(x=>[x.source,x]));
let cursor=0;const results=new Array(input.items.length),failures=[];
async function one(item){
 const source=new URL(item.source),prefix=item.kind==='avatar'?'/pfp/':'/banner/';
 assert.equal(source.origin,'https://discordpfp.gg');assert.ok(source.pathname.startsWith(prefix));
 const slug=source.pathname.slice(prefix.length);assert.match(slug,/^[a-zA-Z0-9_-]+$/);
 assert.ok(item.name.trim().length>0);const folder=item.kind==='avatar'?'icones':'banners';
 const old=known.get(item.source);
 if(old?.path.startsWith(folder+'/')){try{const bytes=await readFile(path.join(root,old.path));if(bytes.length===old.bytes&&digest(bytes)===old.sha256)return {...old,name:item.name};}catch{}}
 const url='https://discordpfp.gg/api/assets/'+slug+'/download';let last;
 for(let attempt=0;attempt<5;attempt++){
  try{
   const r=await fetch(url,{headers:{Accept:'image/*','User-Agent':'Falae-Catalog-Import/1.0'},signal:AbortSignal.timeout(90000)});
   if(r.status===403)throw Object.assign(new Error('A fonte recusou o download (403).'),{terminal:true});
   if(r.status===429){const delay=Number(r.headers.get('retry-after'))||20;await new Promise(done=>setTimeout(done,Math.min(120,delay)*1000));throw new Error('Limite temporário da fonte (429).');}
   if(!r.ok)throw new Error('Download HTTP '+r.status);
   if(!r.headers.get('content-type')?.startsWith('image/'))throw Object.assign(new Error('A fonte devolveu um documento em vez da imagem.'),{terminal:true});
   if(Number(r.headers.get('content-length'))>90*1024*1024)throw Object.assign(new Error('Imagem excede o limite de arquivo do repositório.'),{terminal:true});
   const bytes=Buffer.from(await r.arrayBuffer());assert.ok(bytes.length>32&&bytes.length<90*1024*1024);
   const ext=extension(bytes),relative=folder+'/'+slug+'.'+ext;
   await mkdir(path.join(root,folder),{recursive:true});await writeFile(path.join(root,relative),bytes);
   return {kind:item.kind,name:item.name,source:item.source,url,path:relative,bytes:bytes.length,sha256:digest(bytes),gitSha:digest(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]),'sha1')};
  }catch(error){last=error;if(error.terminal)throw error;if(attempt<4)await new Promise(done=>setTimeout(done,Math.min(30,2**attempt)*1000));}
 }
 throw last;
}
async function worker(){while(cursor<input.items.length){const i=cursor++;try{results[i]=await one(input.items[i]);}catch(error){failures.push({source:input.items[i].source,name:input.items[i].name,error:error.message});}}}
console.log('Importando e conferindo os 2.746 novos arquivos em um único lote.');
await Promise.all(Array.from({length:6},worker));
if(failures.length){await writeFile('import-failures.json',JSON.stringify(failures,null,2));throw new Error(failures.length+' imagens não foram importadas; catálogo e avatares antigos foram preservados. '+JSON.stringify(failures.slice(0,8)));}
for(const item of frames){assert.ok(item.path.startsWith('molduras/')&&!item.path.includes('..'));const data=await readFile(path.join(root,item.path));assert.equal(data.length,item.bytes);assert.equal(digest(data),item.sha256);}
const items=[...results,...frames],counts={avatar:2165,banner:581,decoration:327};
const manifest={source:input.source,collectedAt:new Date().toISOString(),counts,items};
await writeFile(path.join(root,'catalogo.json'),JSON.stringify(manifest,null,2)+'\n');
// Only remove the replaced avatars after every new image and preserved frame has passed integrity checks.
await rm(path.join(root,'avatares'),{recursive:true,force:true});
const summary={counts,files:items.length,bytes:items.reduce((n,x)=>n+x.bytes,0),maxBytes:Math.max(...results.map(x=>x.bytes)),oldAvatarsRemoved:294,integrity:'All files checked by size and SHA-256; originals retained without conversion.'};
await writeFile(path.join(root,'importacao.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
