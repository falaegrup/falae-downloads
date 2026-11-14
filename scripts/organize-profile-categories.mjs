import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
const tree=new Map(execFileSync('git',['ls-tree','-r','-z','HEAD'],{encoding:'utf8'}).split('\0').flatMap(line=>{const match=line.match(/^100644 blob ([a-f0-9]{40})\t(.+)$/s);return match?[[match[2],match[1]]]:[];}));
const entries=new Map();let categoryCount=0;
for(const folder of ['icones','banners']){
 const {categories}=JSON.parse(await readFile('catalogo/'+folder+'/categorias.json','utf8'));
 for(const category of categories){
  const name=category.name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/g,'').trim();assert.ok(name&&name!=='.'&&name!=='..');categoryCount++;
  for(const original of category.paths){
   assert.match(original,new RegExp('^'+folder+'/[a-zA-Z0-9_-]+\\.(gif|png|webp|jpg|jpeg|avif)$'));
   const sha=tree.get('catalogo/'+original);assert.match(sha||'',/^[a-f0-9]{40}$/,'Original não encontrado: '+original);
   const target='catalogo/'+folder+'/'+name+'/'+path.basename(original);assert.ok(!entries.has(target));entries.set(target,sha);
  }
 }
}
// Reuse existing Git blobs. No originals are downloaded, changed or removed.
const input=[...entries].map(([name,sha])=>'100644 '+sha+'\t'+name+'\0').join('');
execFileSync('git',['update-index','-z','--index-info'],{input,encoding:'utf8'});
const staged=new Map(execFileSync('git',['ls-files','--stage','-z'],{encoding:'utf8'}).split('\0').flatMap(line=>{const match=line.match(/^100644 ([a-f0-9]{40}) 0\t(.+)$/s);return match?[[match[2],match[1]]]:[];}));
for(const [name,sha] of entries)assert.equal(staged.get(name),sha);
for(const [name,sha] of tree)if(/^catalogo\/(icones|banners)\/[^/]+\.(gif|png|webp|jpg|jpeg|avif)$/.test(name))assert.equal(staged.get(name),sha,'Um original foi alterado.');
console.log('Organização conferida: '+categoryCount+' categorias, '+entries.size+' vínculos e todos os originais preservados.');
