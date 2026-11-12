import { createHash } from "node:crypto";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, resolve } from "node:path";

const [version,...pairs]=process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version||"") ||
    pairs.length===0 || pairs.length%2!==0) {
  throw new Error("Uso: node scripts/prepare-release.mjs 2.0.0 android staging/Falae-2.0.0.apk [plataforma arquivo ...]");
}
const formats = {android:[".apk"],windows:[".exe",".msi"],macos:[".dmg"],linux:[".AppImage",".deb",".rpm"]};
const files=[], names=new Set();
for(let i=0;i<pairs.length;i+=2) {
  const platform=pairs[i], path=resolve(pairs[i+1]), name=basename(path);
  if(!formats[platform]?.some(extension=>name.endsWith(extension)) ||
     !/^Falae-[0-9A-Za-z._-]+$/.test(name) ||
     !(name.startsWith("Falae-"+version+".") || name.startsWith("Falae-"+version+"-")) || names.has(name)) {
    throw new Error("Plataforma, nome ou extensão inválida: "+name);
  }
  const info=await stat(path);
  if(!info.isFile() || !info.size || info.size>=2*1024**3) throw new Error("Instalador vazio ou grande demais: "+name);
  const hash=createHash("sha256");
  for await(const chunk of createReadStream(path)) hash.update(chunk);
  const sha256=hash.digest("hex");
  files.push({platform,name,size:info.size,sha256,
    url:"https://github.com/falaegrup/falae-downloads/releases/download/v"+version+"/"+name});
  names.add(name);
}
await mkdir("staging",{recursive:true});
await writeFile("staging/SHA256SUMS",files.map(f=>f.sha256+"  "+f.name).join("\n")+"\n");
await writeFile("staging/release.json",JSON.stringify({schemaVersion:1,version,tag:"v"+version,files},null,2)+"\n");
console.log("Metadados preparados em staging/. Nada foi publicado.");

