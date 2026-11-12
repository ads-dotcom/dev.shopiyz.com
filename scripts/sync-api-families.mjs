import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const app=process.env.SHOPIYZ_APP_REPO,control=process.env.SHOPIYZ_CONTROL_REPO;
assert(app&&control,'Set the reviewed application and Control source checkouts.');
const files=[
 ['account-v2',path.join(app,'docs/api/storefront-account-v2-openapi.yaml'),'shopiyz-account-v2.json'],
 ['studio',path.join(control,'docs/api/studio-openapi.json'),'shopiyz-studio-api.json'],
];
const counts={};
for(const[name,source,target]of files){
 const bytes=await readFile(source,'utf8'),spec=JSON.parse(bytes);assert.equal(spec.openapi,'3.1.0');
 counts[name]=Object.values(spec.paths).flatMap(item=>Object.keys(item).filter(key=>['get','post','put','patch','delete'].includes(key))).length;
 for(const prefix of ['', 'public/']){
  await mkdir(path.join(root,prefix,'openapi'),{recursive:true});await writeFile(path.join(root,prefix,'openapi',target),bytes);
 }
}
for(const name of ['storefront-account-v2.md','customer-segments-native.md','catalog-publication-metadata.md']){
 const source=path.join(app,'docs/api',name);
 const bytes=await readFile(source,'utf8').catch(()=>null);if(bytes===null)continue;
 for(const prefix of ['', 'public/']){
  await mkdir(path.join(root,prefix,'guides'),{recursive:true});await writeFile(path.join(root,prefix,'guides',name),bytes);
 }
}
for(const[source,target]of[
 [path.join(app,'docs/api/Shopiyz-Admin-Storefront.postman_collection.json'),'postman/shopiyz-api.postman_collection.json'],
 [path.join(app,'docs/api/storefront-account-v2-openapi.yaml'),'guides/storefront-account-v2-openapi.yaml'],
 [path.join(app,'docs/api/customer-segments-native-schemas.json'),'guides/customer-segments-native-schemas.json'],
]){
 const bytes=await readFile(source);
 for(const prefix of ['', 'public/']){
  const destination=path.join(root,prefix,target);
  await mkdir(path.dirname(destination),{recursive:true});
  await writeFile(destination,bytes);
  assert.deepEqual(await readFile(destination),bytes,'Published API artifact must match reviewed source bytes.');
 }
}
const compatibilityGuide=await readFile(path.join(root,'guides/postman-compatibility-aliases.md'));
await mkdir(path.join(root,'public/guides'),{recursive:true});
await writeFile(path.join(root,'public/guides/postman-compatibility-aliases.md'),compatibilityGuide);
console.log(JSON.stringify({relatedApiContracts:counts,source:'reviewed Native application and Control contracts; each store runtime contract remains authoritative'}));
