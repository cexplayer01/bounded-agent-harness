import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generate,createSitemap,parseSitemap,submit,robotsAllows} from './seo-indexing.mjs';

const origin='https://example.test',key='public-test-key-123';
const config={origin,indexNowKey:key};
const response=(body,status=200,type='application/json')=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':type}});
function fake(overrides={}) {
  const calls=[];
  const fetcher=async(url,options={})=>{
    const u=String(url);calls.push({url:u,...options});
    if(overrides[u])return overrides[u](options);
    if(u===origin+'/sitemap.xml')return response(createSitemap([origin+'/'],origin),200,'application/xml');
    if(u===origin+'/robots.txt')return response('User-agent: *\nAllow: /\n',200,'text/plain');
    if(u===origin+'/')return response('<html><link rel="canonical" href="'+origin+'/"></html>',200,'text/html');
    if(u===origin+'/'+key+'.txt')return response(key,200,'text/plain');
    if(u==='https://api.indexnow.org/indexnow')return response('',200);
    if(u==='https://www.googleapis.com/webmasters/v3/sites')return response({siteEntry:[{siteUrl:'sc-domain:example.test',permissionLevel:'siteOwner'}]});
    if(u.includes('/sitemaps/'))return options.method==='PUT'?response(''):response({path:origin+'/sitemap.xml'});
    if(u.includes('/GetUserSites'))return response({d:[{Url:origin+'/',IsVerified:true}]});
    if(u.includes('/SubmitFeed'))return response({d:null});
    throw Error('Unexpected network request');
  };
  return {calls,fetcher};
}

test('static scan includes nested canonical pages and excludes noindex/error/redirect/off-site pages',()=>{
  const root=mkdtempSync(join(tmpdir(),'seo-scan-'));mkdirSync(join(root,'about'));
  for(const [name,html] of Object.entries({'index.html':'<h1>Home</h1>','about/index.html':'<h1>About</h1>','404.html':'Oops','private.html':'<meta name="robots" content="noindex">','old.html':'<meta http-equiv="refresh" content="0;url=/">','external.html':'<link rel="canonical" href="https://other.test/">'}))writeFileSync(join(root,name),html);
  const result=generate({...config,outputDirectory:root});
  assert.deepEqual(result.urls,[origin+'/',origin+'/about/']);assert.equal(result.excluded.length,4);
  assert.deepEqual(parseSitemap(readFileSync(join(root,'sitemap.xml'),'utf8'),origin),result.urls);
  assert.match(readFileSync(join(root,'robots.txt'),'utf8'),/Sitemap: https:\/\/example.test\/sitemap.xml/);
  assert.equal(readFileSync(join(root,key+'.txt'),'utf8').trim(),key);
});

test('sitemap rejects external URLs, DTDs, malformed entities, duplicates and empty inventory',()=>{
  assert.throws(()=>createSitemap([],origin));assert.throws(()=>createSitemap(['https://other.test/'],origin));
  const xml=createSitemap([origin+'/'],origin);
  assert.throws(()=>parseSitemap('<!DOCTYPE urlset>'+xml,origin));
  assert.throws(()=>parseSitemap(xml.replace('example.test/','example.test/&oops;'),origin));
  assert.throws(()=>parseSitemap(xml.replace('</urlset>','<url><loc>'+origin+'/</loc></url></urlset>'),origin));
});

test('robots honors specific agents, longest paths, allow ties and wildcard rules',()=>{
  const text='User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\nUser-agent: Googlebot\nDisallow: /\nAllow: /news\n';
  assert.equal(robotsAllows(text,origin+'/','Googlebot'),false);
  assert.equal(robotsAllows(text,origin+'/news','Googlebot'),true);
  assert.equal(robotsAllows(text,origin+'/private','bingbot'),false);
  assert.equal(robotsAllows(text,origin+'/private/public','bingbot'),true);
  assert.equal(robotsAllows(text,origin+'/file.pdf','bingbot'),false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /',origin+'/','bingbot'),true);
});

test('missing account credentials still allow IndexNow; receipt has real response and no indexing claim',async()=>{
  const f=fake();const r=await submit(config,{...f,env:{}});
  assert.equal(r.providers.google.reason,'MISSING_GOOGLE_CREDENTIALS');
  assert.equal(r.providers.bing.reason,'MISSING_BING_CREDENTIALS');
  assert.equal(r.providers.indexnow.httpStatus,200);assert.equal(r.indexingConfirmed,false);
  const post=f.calls.find(c=>c.method==='POST');assert.deepEqual(JSON.parse(post.body).urlList,[origin+'/']);
});

test('authorized API requests use exact sitemap endpoints and keep credentials out of receipts',async()=>{
  const f=fake(),receipts=[];const r=await submit(config,{...f,env:{GSC_ACCESS_TOKEN:'secret-google',BING_WEBMASTER_API_KEY:'secret-bing'},save:r=>receipts.push(JSON.stringify(r))});
  assert.equal(r.status,'ACCEPTED_BY_ALL_REQUESTED_PROVIDERS');
  assert.equal(r.providers.google.recordVisible,true);
  assert.equal(f.calls.find(c=>c.method==='PUT').url,'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.test/sitemaps/https%3A%2F%2Fexample.test%2Fsitemap.xml');
  assert.deepEqual(JSON.parse(f.calls.find(c=>c.url.includes('SubmitFeed')).body),{siteUrl:origin+'/',feedUrl:origin+'/sitemap.xml'});
  assert.ok(receipts.every(s=>!s.includes('secret-')));
});

test('unverified properties never receive sitemap writes',async()=>{
  const f=fake({'https://www.googleapis.com/webmasters/v3/sites':()=>response({siteEntry:[{siteUrl:'sc-domain:other.test',permissionLevel:'siteOwner'}]}),'https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=test':()=>response({d:[{Url:origin+'/',IsVerified:false}]})});
  const r=await submit(config,{...f,env:{GSC_ACCESS_TOKEN:'test',BING_WEBMASTER_API_KEY:'test'},only:['google','bing']});
  assert.equal(r.providers.google.status,'BLOCKED');assert.equal(r.providers.bing.status,'BLOCKED');
  assert.ok(f.calls.every(c=>!['POST','PUT'].includes(c.method)));
});

test('API errors, pending IndexNow verification, and ambiguous writes are not called success or retried',async()=>{
  for(const [status,expected] of [[202,'PENDING_KEY_VERIFICATION'],[429,'FAILED'],[null,'UNCERTAIN']]) {
    const f=fake({'https://api.indexnow.org/indexnow':()=>{if(status===null)throw Error('network');return response('',status);}});
    const r=await submit(config,{...f,env:{},only:['indexnow']});assert.equal(r.providers.indexnow.status,expected);
    assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  }
  const f=fake({'https://ssl.bing.com/webmaster/api.svc/json/SubmitFeed?apikey=test':()=>response({ErrorCode:9})});
  const r=await submit(config,{...f,env:{BING_WEBMASTER_API_KEY:'test'},only:['bing']});assert.equal(r.providers.bing.status,'FAILED');
});

test('blocked robots or noindex stops all provider calls',async()=>{
  for(const overrides of [{'https://example.test/robots.txt':()=>response('User-agent: *\nDisallow: /',200,'text/plain')},{'https://example.test/':()=>response('<meta name="robots" content="noindex">',200,'text/html')}]) {
    const f=fake(overrides);await assert.rejects(submit(config,{...f,env:{}}));assert.ok(f.calls.every(c=>!c.url.includes('indexnow.org')));
  }
});

test('existing receipt is never overwritten when CLI refuses a repeat',()=>{
  const root=mkdtempSync(join(tmpdir(),'seo-receipt-')),cfg=join(root,'config.json'),receipt=join(root,'receipt.json');
  writeFileSync(cfg,JSON.stringify({...config,outputDirectory:'out'}));const before='{"status":"UNCERTAIN"}\n';writeFileSync(receipt,before);
  assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(new URL('./seo-indexing.mjs',import.meta.url)),'submit','--config',cfg,'--receipt',receipt],{stdio:'pipe'}));
  assert.equal(readFileSync(receipt,'utf8'),before);
});
