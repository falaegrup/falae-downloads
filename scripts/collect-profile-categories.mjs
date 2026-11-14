import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const source='https://icones-e-banners-hc.grandhill39.chatgpt.site';
const input=JSON.parse(await readFile('catalogo/importar.json','utf8'));
const ignored=new Set(JSON.parse(await readFile('catalogo/cancelados.json','utf8')).map(x=>x.source));
const existing=new Map(input.items.map(x=>[x.source,x]));
const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const plain=s=>decode(s.replace(/<[^>]*>/g,'')).trim();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,attempt=0){
 const r=await fetch(url,{headers:{Accept:'text/html,application/json;q=0.9,*/*;q=0.5','User-Agent':'Falae-Catalog-Categories/1.0'},signal:AbortSignal.timeout(45000)});
 if((r.status===429||r.status>=500)&&attempt<2){await pause(Math.min(30000,(Number(r.headers.get('retry-after'))||2**(attempt+1))*1000));return get(url,attempt+1);}
 if(!r.ok)throw Error('HTTP '+r.status);
 return r;
}
// Read only links on the supplied reference. Previously cancelled images stay skipped.
try{
 const html=await(await get(source)).text();
 const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(m=>new URL(decode(m[1]),source)).filter(u=>u.origin===source);
 let text=html;for(const url of scripts)text+='\n'+await(await get(url)).text();
 text=text.replace(/\\\//g,'/');
 const links=[...text.matchAll(/https:\/\/discordpfp\.gg\/(pfp|banner)\/([a-zA-Z0-9_-]+)/g)];
 for(const m of links){const url=m[0];if(!existing.has(url)&&!ignored.has(url))existing.set(url,{kind:m[1]==='pfp'?'avatar':'banner',name:m[2],source:url,isNew:true});}
 console.log('Links da referência:',links.length,'itens para conferir:',existing.size,'cancelados preservados:',ignored.size);
}catch(e){console.log('Referência indisponível; preservando os links anteriormente coletados:',e.message);}

let cursor=0;const items=[],failures=[],newFiles=[];const queue=[...existing.values()];
function ldImage(html){for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const j=JSON.parse(m[1]),nodes=j['@graph']||[j],image=nodes.find(n=>n['@type']==='ImageObject');if(image)return image;}catch{}}return null;}
function parse(html,item){
 const image=ldImage(html);if(!image)throw Error('Metadados do item não encontrados.');
 const heading=html.indexOf('<h1'),end=html.indexOf('Comments',heading),detail=html.slice(Math.max(0,heading-100),end>heading?end:heading+20000);
 const links=[...detail.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap(m=>{const h=m[1].match(/\bhref=["']([^"']+)/);if(!h)return[];const u=new URL(decode(h[1]),item.source),name=plain(m[2]);if(u.origin!=='https://discordpfp.gg'||!name)return[];return[{name,url:u.href,primary:/asset-detail-title-pill/.test(m[1]),canonical:/^\/pfps\/[^/]+$/.test(u.pathname)}];});
 const primary=links.filter(x=>x.primary),categories=[...new Set(links.filter(x=>x.primary||x.canonical).map(x=>x.name))];
 const tags=Array.isArray(image.keywords)?image.keywords:typeof image.keywords==='string'?image.keywords.split(',').map(x=>x.trim()).filter(Boolean):[];
 if(!primary.length&&!categories.length&&!tags.length)throw Error('Categorias não encontradas.');
 return {kind:item.kind,name:image.name||item.name,source:item.source,categories:categories.length?categories:tags,tags:[...new Set(tags)],primaryCategories:primary.map(x=>x.name),contentUrl:image.contentUrl,categoryLinks:links.filter(x=>x.primary||x.canonical),isNew:Boolean(item.isNew)};
}
function extension(bytes){if(bytes.subarray(0,6).toString().startsWith('GIF8'))return'gif';if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return'png';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return'webp';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'jpg';if(bytes.subarray(4,8).toString()==='ftyp'&&/avif|avis/.test(bytes.subarray(8,32).toString()))return'avif';throw Error('Formato de imagem não reconhecido.');}
async function download(item){
 const u=new URL(item.contentUrl),prefix=item.kind==='avatar'?'/images/pfp/':'/images/banner/';assert.equal(u.origin,'https://discordpfp.gg');assert.ok(u.pathname.startsWith(prefix));
 const r=await get(u);if(!r.headers.get('content-type')?.startsWith('image/'))throw Error('Resposta não contém imagem.');
 const bytes=Buffer.from(await r.arrayBuffer());assert.ok(bytes.length>32&&bytes.length<90*1024*1024);
 const slug=new URL(item.source).pathname.split('/').pop(),path=(item.kind==='avatar'?'icones/':'banners/')+slug+'.'+extension(bytes);
 await mkdir('catalogo/'+path.split('/')[0],{recursive:true});await writeFile('catalogo/'+path,bytes);
 return{kind:item.kind,name:item.name,source:item.source,url:u.href,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),gitSha:createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')};
}
async function worker(){while(cursor<queue.length){const i=cursor++,item=queue[i];try{const data=parse(await(await get(item.source)).text(),item);if(item.isNew){try{newFiles.push(await download(data));}catch(e){failures.push({source:item.source,name:item.name,error:'Novo arquivo: '+e.message});continue;}}items.push(data);}catch(e){failures.push({source:item.source,name:item.name,error:e.message});}if((i+1)%100===0)console.log('Conferidos:',i+1,'de',queue.length);}}
await Promise.all(Array.from({length:6},worker));
items.sort((a,b)=>a.source.localeCompare(b.source));
await writeFile('catalogo/categorias-perfis-fonte.json',JSON.stringify({source,collectedAt:new Date().toISOString(),items,newFiles,failures,previouslyCancelled:ignored.size},null,2)+'\n');
console.log(JSON.stringify({collected:items.length,avatars:items.filter(x=>x.kind==='avatar').length,banners:items.filter(x=>x.kind==='banner').length,categories:[...new Set(items.flatMap(x=>x.categories))].sort(),tagCount:new Set(items.flatMap(x=>x.tags)).size,newFiles:newFiles.length,failures:failures.length},null,2));
