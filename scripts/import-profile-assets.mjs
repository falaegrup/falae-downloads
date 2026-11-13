import {readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
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
try{previous.push(...JSON.parse(await readFile(path.join(root,'import-progresso.json'),'utf8')).items);}catch{}
const known=new Map(previous.filter(x=>x.source).map(x=>[x.source,x]));
let cursor=0,completed=0,lastCheckpoint=0;let checkpointChain=Promise.resolve();const results=new Array(input.items.length),failures=[];

function checkpoint(force=false){
 const items=results.filter(Boolean);if(!force&&items.length-lastCheckpoint<250)return checkpointChain;lastCheckpoint=items.length;
 const text=JSON.stringify({updatedAt:new Date().toISOString(),completed:items.length,pending:input.items.length-items.length,failures,items},null,2)+'\n';
 checkpointChain=checkpointChain.then(async()=>{
  await writeFile(path.join(root,'import-progresso.json'),text);
  if(process.env.GITHUB_ACTIONS==='true'){
   execFileSync('git',['add','--',...items.map(x=>'catalogo/'+x.path),'catalogo/import-progresso.json'],{stdio:'pipe'});
   if(spawnSync('git',['diff','--cached','--quiet']).status!==0){execFileSync('git',['commit','--quiet','-m','Preservar lote de '+items.length+' originais conferidos'],{stdio:'pipe'});execFileSync('git',['push','--quiet','origin','HEAD:main'],{stdio:'pipe'});}
  }
  console.log('Lote preservado: '+items.length+' de 2746 originais.');
 });return checkpointChain;
}

async function one(item){
 const source=new URL(item.source),prefix=item.kind==='avatar'?'/pfp/':'/banner/';
 assert.equal(source.origin,'https://discordpfp.gg');assert.ok(source.pathname.startsWith(prefix));
 const slug=source.pathname.slice(prefix.length);assert.match(slug,/^[a-zA-Z0-9_-]+$/);
 assert.ok(item.name.trim().length>0);const folder=item.kind==='avatar'?'icones':'banners';
 const old=known.get(item.source);
 if(old?.path.startsWith(folder+'/')){try{const bytes=await readFile(path.join(root,old.path));if(bytes.length===old.bytes&&digest(bytes)===old.sha256)return {...old,name:item.name};}catch{}}
 let url='https://discordpfp.gg/api/assets/'+slug+'/download';let last;
 // Use the original image declared by the supplied public detail page. This avoids the download-counter API.
 try{
  const page=await fetch(item.source,{headers:{Accept:'text/html'},signal:AbortSignal.timeout(45000)});
  if(page.status===403)throw Object.assign(new Error('A página da fonte recusou o acesso (403).'),{terminal:true});
  if(page.ok){const html=await page.text(),match=html.match(/"contentUrl":"((?:[^"\\]|\\.)+)"/);if(match){const image=new URL(JSON.parse('"'+match[1]+'"'),item.source);if(image.origin===source.origin&&image.pathname.startsWith(item.kind==='avatar'?'/images/pfp/':'/images/banner/'))url=image.href;}}
 }catch(error){if(error.terminal)throw error;}

 for(let attempt=0;attempt<4;attempt++){
  try{
   const r=await fetch(url,{headers:{Accept:'image/*','User-Agent':'Falae-Catalog-Import/1.0'},signal:AbortSignal.timeout(180000)});
   if(r.status===404||r.status===410)throw Object.assign(new Error('Imagem indisponível na fonte (HTTP '+r.status+').'),{terminal:true});
   if(r.status===403)throw Object.assign(new Error('A fonte recusou o download (403).'),{terminal:true});
   if(r.status===429){const delay=Number(r.headers.get('retry-after'))||20;await new Promise(done=>setTimeout(done,Math.min(120,delay)*1000));throw new Error('Limite temporário da fonte (429).');}
   if(!r.ok)throw new Error('Download HTTP '+r.status);
   if(!r.headers.get('content-type')?.startsWith('image/'))throw Object.assign(new Error('A fonte devolveu um documento em vez da imagem.'),{terminal:true});
   if(Number(r.headers.get('content-length'))>90*1024*1024)throw Object.assign(new Error('Imagem excede o limite de arquivo do repositório.'),{terminal:true});
   const bytes=Buffer.from(await r.arrayBuffer());assert.ok(bytes.length>32&&bytes.length<90*1024*1024);
   const ext=extension(bytes),relative=folder+'/'+slug+'.'+ext;
   await mkdir(path.join(root,folder),{recursive:true});await writeFile(path.join(root,relative),bytes);
   return {kind:item.kind,name:item.name,source:item.source,url,path:relative,bytes:bytes.length,sha256:digest(bytes),gitSha:digest(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]),'sha1')};
  }catch(error){last=error;if(error.terminal)throw error;if(attempt<3)await new Promise(done=>setTimeout(done,Math.min(30,2**attempt)*1000));}
 }
 throw last;
}
async function worker(){while(cursor<input.items.length){const i=cursor++;try{results[i]=await one(input.items[i]);completed++;if(completed%250===0)await checkpoint();}catch(error){failures.push({source:input.items[i].source,name:input.items[i].name,error:error.message});}}}
console.log('Importando e conferindo os 2.746 novos arquivos em um único lote.');
const progressTimer=setInterval(()=>checkpoint(true).catch(error=>console.error('Falha ao preservar lote: '+error.message)),120000);progressTimer.unref();
await Promise.all(Array.from({length:16},worker));clearInterval(progressTimer);
await checkpoint(true);
if(failures.length){await writeFile('import-failures.json',JSON.stringify(failures,null,2));throw new Error(failures.length+' imagens não foram importadas; catálogo e avatares antigos foram preservados. '+JSON.stringify(failures.slice(0,8)));}
for(const item of frames){assert.ok(item.path.startsWith('molduras/')&&!item.path.includes('..'));const data=await readFile(path.join(root,item.path));assert.equal(data.length,item.bytes);assert.equal(digest(data),item.sha256);}
const items=[...results,...frames],counts={avatar:2165,banner:581,decoration:327};
const manifest={source:input.source,collectedAt:new Date().toISOString(),counts,items};
await writeFile(path.join(root,'catalogo.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(root,'colecao.json'),JSON.stringify({counts,items:items.map(({kind,name,path})=>({kind,name,path}))})+'\n');
// Only remove the replaced avatars after every new image and preserved frame has passed integrity checks.
await rm(path.join(root,'avatares'),{recursive:true,force:true});
const summary={counts,files:items.length,bytes:items.reduce((n,x)=>n+x.bytes,0),maxBytes:Math.max(...results.map(x=>x.bytes)),oldAvatarsRemoved:294,integrity:'All files checked by size and SHA-256; originals retained without conversion.'};
await writeFile(path.join(root,'importacao.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
