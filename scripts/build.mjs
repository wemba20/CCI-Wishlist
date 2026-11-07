import {mkdir,copyFile,readFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);const out=new URL('dist/',root);
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
for(const name of ['index.html','style.css','app.js','live.js','_headers','_redirects'])await copyFile(new URL(name,root),new URL(name,out));
for(const dir of ['vision','admin']){await mkdir(new URL(dir+'/',out),{recursive:true});await copyFile(new URL(dir+'/index.html',root),new URL(dir+'/index.html',out))}
await mkdir(new URL('assets/',out),{recursive:true});
for(const name of JSON.parse(await readFile(new URL('public-assets.json',root),'utf8')))await copyFile(new URL('assets/'+name,root),new URL('assets/'+name,out));
console.log('Built public assets only. Server secrets and database scripts excluded.');
