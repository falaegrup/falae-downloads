import {execFileSync,spawnSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const origin='https://falae.pages.dev',audience=origin+'/catalog-publisher';
const git=(args,options={})=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024,...options}).trim();
async function identity(){const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience',audience);const r=await fetch(url,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});if(!r.ok)throw Error('Não foi possível autenticar o publicador.');return(await r.json()).value;}
async function api(path,body){const token=await identity();const r=await fetch(origin+'/api/catalog-publisher/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Publicação HTTP '+r.status+': '+(await r.text()).slice(0,150));return r;}
console.log('Verificação da conexão:',JSON.stringify(await(await api('connection')).json()));
const {items}=await(await api('pending')).json();if(!items.length){console.log('Nenhum arquivo aguardando publicação.');process.exit(0);}
let manifest=[];try{manifest=JSON.parse(git(['show','HEAD:catalogo/uploads/manifest.json'],{stdio:['ignore','pipe','ignore']}));}catch{}
const records=new Map(manifest.map(x=>[x.path,x])),staged=[],ready=[];
for(const item of items){try{
 assert.match(item.path,/^(icones|banners|molduras)\/u_[a-f0-9]{64}\.(png|jpg|webp|gif)$/);assert.match(item.sha256,/^[a-f0-9]{64}$/);assert.ok(item.bytes>0&&item.bytes<=8*1024*1024);
 const bytes=Buffer.from(await(await api('file?'+new URLSearchParams({path:item.path}))).arrayBuffer());assert.equal(bytes.length,item.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
 const sha=git(['hash-object','-w','--stdin'],{input:bytes});assert.equal(sha,item.gitSha);staged.push('100644 '+sha+'\tcatalogo/'+item.path+'\0');
 const folder=item.path.split('/')[0],file=item.path.split('/')[1];for(const name of item.categoryNames){const safe=name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/g,'').trim();assert.ok(safe&&safe!=='.'&&safe!=='..');staged.push('100644 '+sha+'\tcatalogo/'+folder+'/'+safe+'/'+file+'\0');}
 records.set(item.path,{path:item.path,kind:item.kind,name:item.name,categories:item.categories,categoryNames:item.categoryNames,sha256:item.sha256,bytes:item.bytes});ready.push(item);
}catch(e){console.error('Falha ao preparar '+item.path+': '+e.message);await api('fail',{path:item.path}).catch(()=>{});}}
if(!ready.length)process.exit(1);
execFileSync('git',['update-index','-z','--index-info'],{input:staged.join(''),maxBuffer:64*1024*1024});
await mkdir('catalogo/uploads',{recursive:true});await writeFile('catalogo/uploads/manifest.json',JSON.stringify([...records.values()],null,2)+'\n');git(['add','--sparse','--','catalogo/uploads/manifest.json']);
if(spawnSync('git',['diff','--cached','--quiet']).status!==0){git(['config','user.name','github-actions[bot]']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);git(['commit','--quiet','-m','Publicar '+ready.length+' arquivo(s) enviados pelo painel Falaê']);}
let pushed=false;for(let attempt=0;attempt<3&&!pushed;attempt++){const result=spawnSync('git',['push','--quiet','origin','HEAD:main'],{encoding:'utf8'});if(result.status===0)pushed=true;else{git(['fetch','origin','main']);git(['rebase','origin/main']);}}
if(!pushed)throw Error('O GitHub não confirmou a atualização da branch.');const commit=git(['rev-parse','HEAD']);let failed=0;
for(const item of ready){try{for(let attempt=0;;attempt++){try{await api('complete',{path:item.path,commit});break;}catch(e){if(attempt>=4)throw e;await new Promise(r=>setTimeout(r,3000*(attempt+1)));}}console.log('Publicado: '+item.name);}catch(e){failed++;console.error('A confirmação será repetida: '+item.path+' — '+e.message);await api('fail',{path:item.path}).catch(()=>{});}}
if(failed)process.exitCode=1;
