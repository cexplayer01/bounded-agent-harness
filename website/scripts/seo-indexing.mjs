import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSign } from 'node:crypto';

const GOOGLE = 'https://www.googleapis.com/webmasters/v3/sites';
const BING = 'https://ssl.bing.com/webmaster/api.svc/json/';
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const fail = code => { throw new Error(code); };
const check = (condition, code) => { if (!condition) fail(code); };
const escapeXml = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const decodeXml = s => s.replace(/&(amp|lt|gt|quot|apos);/g, (_,x)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[x]));
const normalized = u => new URL(u).href;

export function loadConfig(configPath) {
  const c = JSON.parse(readFileSync(configPath,'utf8'));
  const u = new URL(c.origin);
  check(u.protocol==='https:' && u.pathname==='/' && !u.search && !u.hash && !u.username && !u.password && !u.port, 'CONFIG_REQUIRES_HTTPS_ORIGIN');
  check(typeof c.outputDirectory==='string' && c.outputDirectory.length>0, 'OUTPUT_DIRECTORY_REQUIRED');
  if (c.indexNowKey) check(/^[a-zA-Z0-9-]{8,128}$/.test(c.indexNowKey),'INVALID_PUBLIC_INDEXNOW_KEY');
  return {...c, origin:u.origin, outputDirectory:resolve(dirname(configPath),c.outputDirectory)};
}

function pageUrl(value, origin) {
  const u=new URL(value,origin+'/');
  check(u.origin===origin && !u.username && !u.password && !u.search && !u.hash && u.href.length<2048, 'INVALID_SITEMAP_URL');
  return u.href;
}

function attrs(tag) {
  const values={};
  for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) values[m[1].toLowerCase()]=decodeXml(m[2]??m[3]??m[4]);
  return values;
}

export function pageMetadata(html) {
  const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  const metas=[...clean.matchAll(/<meta\b[^>]*>/gi)].map(m=>attrs(m[0]));
  const canonicals=[...clean.matchAll(/<link\b[^>]*>/gi)].map(m=>attrs(m[0])).filter(a=>(a.rel??'').toLowerCase().split(/\s+/).includes('canonical'));
  check(canonicals.length<=1,'MULTIPLE_CANONICALS');
  return { noindex:metas.some(a=>/^(robots|googlebot|bingbot)$/i.test(a.name??'') && /\b(noindex|none)\b/i.test(a.content??'')), redirect:metas.some(a=>(a['http-equiv']??'').toLowerCase()==='refresh'), canonical:canonicals[0]?.href };
}

export function robotsAllows(text,url,agent) {
  const groups=[];let group=null,hasRules=false;
  for(const raw of text.split(/\r?\n/)) {
    const line=raw.replace(/#.*/,'').trim(),colon=line.indexOf(':');
    if(colon<0)continue;
    const key=line.slice(0,colon).trim().toLowerCase(),value=line.slice(colon+1).trim();
    if(key==='user-agent') {
      if(!group||hasRules){group={agents:[],rules:[]};groups.push(group);hasRules=false;}
      group.agents.push(value.toLowerCase());
    } else if(group&&['allow','disallow'].includes(key)) {hasRules=true;if(value)group.rules.push({allow:key==='allow',path:value});}
  }
  const score=g=>Math.max(-1,...g.agents.map(a=>a==='*'?0:agent.toLowerCase().includes(a)?a.length:-1));
  const best=Math.max(-1,...groups.map(score));if(best<0)return true;
  const target=new URL(url).pathname+new URL(url).search;
  const matches=groups.filter(g=>score(g)===best).flatMap(g=>g.rules).filter(r=>{
    const end=r.path.endsWith('$'),path=end?r.path.slice(0,-1):r.path;
    const pattern=path.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
    return new RegExp('^'+pattern+(end?'$':'')).test(target);
  }).sort((a,b)=>b.path.replace(/[*$]/g,'').length-a.path.replace(/[*$]/g,'').length||Number(b.allow)-Number(a.allow));
  return matches[0]?.allow??true;
}

export function createSitemap(urls,origin) {
  check(urls.length>0 && urls.length<=50000,'SITEMAP_URL_LIMIT_OR_EMPTY');
  const sorted=[...new Set(urls.map(u=>pageUrl(u,origin)))].sort();
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${NS}">\n${sorted.map(u=>`  <url><loc>${escapeXml(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
  check(Buffer.byteLength(xml)<=50*1024*1024,'SITEMAP_SIZE_LIMIT');
  return xml;
}

// Validate the deliberately small generated XML grammar, including entity safety.
// No DTD, external entities or arbitrary imported XML are evaluated.
export function parseSitemap(xml,origin) {
  check(Buffer.byteLength(xml)<=50*1024*1024,'SITEMAP_SIZE_LIMIT');
  const body=xml.match(/^\s*<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">([\s\S]*)<\/urlset>\s*$/)?.[1];
  check(body!==undefined,'UNSUPPORTED_OR_INVALID_SITEMAP_XML');
  const urls=[];
  const remainder=body.replace(/<url>\s*<loc>([^<]*)<\/loc>\s*<\/url>/g,(_,value)=>{
    check(!/[\u0000-\u001f<>]/.test(value) && !/&(?!(?:amp|lt|gt|quot|apos);)/.test(value),'INVALID_XML_TEXT');
    urls.push(pageUrl(decodeXml(value),origin)); return '';
  });
  check(!remainder.trim() && urls.length>0 && urls.length<=50000 && new Set(urls).size===urls.length,'INVALID_OR_DUPLICATE_SITEMAP_ENTRIES');
  return urls;
}

export function generate(config) {
  const urls=[],excluded=[];
  function walk(dir,prefix='') {
    for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const name=prefix+e.name;
      if(e.isSymbolicLink()) fail('SYMLINK_IN_STATIC_EXPORT');
      if(e.isDirectory()) { if(!e.name.startsWith('.') && e.name!=='_next') walk(resolve(dir,e.name),name+'/'); continue; }
      if(!e.name.endsWith('.html')) continue;
      if(/(^|\/)(404|500|_not-found)(\/|\.html$)/.test(name)) {excluded.push(name);continue;}
      const meta=pageMetadata(readFileSync(resolve(dir,e.name),'utf8'));
      if(meta.noindex||meta.redirect){excluded.push(name);continue;}
      const route='/'+name.split('/').map(encodeURIComponent).join('/').replace(/(?:^|\/)index\.html$/,m=>m.startsWith('/')?'/':'').replace(/\.html$/,'');
      const u=new URL(meta.canonical??route,config.origin+'/');
      if(u.origin!==config.origin){excluded.push(name);continue;}
      urls.push(pageUrl(u.href,config.origin));
    }
  }
  walk(config.outputDirectory);
  const xml=createSitemap(urls,config.origin),validated=parseSitemap(xml,config.origin);
  const robotsPath=resolve(config.outputDirectory,'robots.txt');
  let robots=existsSync(robotsPath)?readFileSync(robotsPath,'utf8'):'User-agent: *\nAllow: /\n';
  check(validated.every(url=>['Googlebot','bingbot','YandexBot','SeznamBot'].every(agent=>robotsAllows(robots,url,agent))),'ROBOTS_BLOCKS_SITEMAP_PAGE');
  writeFileSync(resolve(config.outputDirectory,'sitemap.xml'),xml,'utf8');
  const sitemapUrl=config.origin+'/sitemap.xml';
  if(!robots.split(/\r?\n/).some(line=>line.trim()===`Sitemap: ${sitemapUrl}`)) robots=robots.trimEnd()+`\n\nSitemap: ${sitemapUrl}\n`;
  writeFileSync(robotsPath,robots,'utf8');
  if(config.indexNowKey) writeFileSync(resolve(config.outputDirectory,config.indexNowKey+'.txt'),config.indexNowKey+'\n','utf8');
  return {sitemapUrl,urlCount:validated.length,urls:validated,excluded,xmlValidated:true,indexNowKeyFile:config.indexNowKey?`/${config.indexNowKey}.txt`:null};
}

async function request(fetcher,url,options={}) {
  try {
    const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
    const text=await r.text();let json=null;try{json=JSON.parse(text);}catch{}
    return {status:r.status,ok:r.ok,text,json,headers:r.headers};
  } catch { return {status:null,ok:false,error:'NETWORK_OR_REDIRECT_ERROR'}; }
}

async function googleToken(env,fetcher) {
  if(env.GSC_ACCESS_TOKEN) return {token:env.GSC_ACCESS_TOKEN};
  let params;
  if(env.GSC_CLIENT_ID && env.GSC_CLIENT_SECRET && env.GSC_REFRESH_TOKEN) params={grant_type:'refresh_token',client_id:env.GSC_CLIENT_ID,client_secret:env.GSC_CLIENT_SECRET,refresh_token:env.GSC_REFRESH_TOKEN};
  else if(env.GOOGLE_APPLICATION_CREDENTIALS) {
    let c;try{c=JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));}catch{return {error:'GOOGLE_CREDENTIAL_FILE_UNREADABLE'};}
    if(c.type!=='service_account'||!c.client_email||!c.private_key) return {error:'GOOGLE_SERVICE_ACCOUNT_REQUIRED'};
    const now=Math.floor(Date.now()/1000),b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
    const data=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:c.client_email,scope:'https://www.googleapis.com/auth/webmasters',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    let signature;try{signature=createSign('RSA-SHA256').update(data).sign(c.private_key).toString('base64url');}catch{return {error:'GOOGLE_SIGNING_FAILED'};}
    params={grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:data+'.'+signature};
  } else return {error:'MISSING_GOOGLE_CREDENTIALS'};
  const r=await request(fetcher,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params).toString()});
  return r.ok&&r.json?.access_token?{token:r.json.access_token}:{error:'GOOGLE_AUTH_FAILED',authHttpStatus:r.status};
}

function allowedProperty(value,origin) {
  if(value==='sc-domain:'+new URL(origin).hostname) return true;
  try {return normalized(value)===origin+'/';}catch{return false;}
}

export async function submit(config,{env=process.env,fetcher=fetch,only=['google','bing','indexnow'],save=()=>{}}={}) {
  check(only.length>0 && only.every(v=>['google','bing','indexnow'].includes(v)), 'INVALID_PROVIDER_SELECTION');
  const result={sitemapUrl:config.origin+'/sitemap.xml',startedAt:new Date().toISOString(),status:'RUNNING',providers:{}};
  save(result);
  const sitemap=await request(fetcher,result.sitemapUrl);
  check(sitemap.status===200 && /xml/i.test(sitemap.headers.get('content-type')??''),'LIVE_SITEMAP_NOT_XML_200');
  const urls=parseSitemap(sitemap.text,config.origin);
  const robots=await request(fetcher,config.origin+'/robots.txt');
  check(robots.status===200&&/text\/plain/i.test(robots.headers.get('content-type')??''),'LIVE_ROBOTS_NOT_TEXT_200');
  check(urls.every(url=>['Googlebot','bingbot','YandexBot','SeznamBot'].every(agent=>robotsAllows(robots.text,url,agent))),'ROBOTS_BLOCKS_SITEMAP_PAGE');
  // Validate actual canonical responses; never submit a login/error shell as a page.
  for(const url of urls) {
    const r=await request(fetcher,url);
    check(r.status===200 && /text\/html/i.test(r.headers.get('content-type')??''),'SITEMAP_PAGE_NOT_HTML_200');
    const meta=pageMetadata(r.text);
    check(!meta.noindex&&!meta.redirect&&!/\b(noindex|none)\b/i.test(r.headers.get('x-robots-tag')??''),'SITEMAP_PAGE_NOT_INDEXABLE');
    if(meta.canonical) check(normalized(new URL(meta.canonical,url))===url,'LIVE_CANONICAL_MISMATCH');
  }
  result.sitemapHttpStatus=sitemap.status;result.robotsHttpStatus=robots.status;result.urlCount=urls.length;save(result);
  for(const provider of ['google','bing','indexnow'].filter(v=>only.includes(v))) {
    const p=result.providers[provider]={status:'PREFLIGHT',httpStatus:null};save(result);
    if(provider==='google') {
      const auth=await googleToken(env,fetcher);
      if(!auth.token){Object.assign(p,{status:'BLOCKED',reason:auth.error,authHttpStatus:auth.authHttpStatus??null});save(result);continue;}
      const headers={Authorization:'Bearer '+auth.token};
      const sites=await request(fetcher,GOOGLE,{headers});p.preflightHttpStatus=sites.status;
      const entries=(Array.isArray(sites.json?.siteEntry)?sites.json.siteEntry:[]).filter(s=>['siteOwner','siteFullUser'].includes(s.permissionLevel) && allowedProperty(s.siteUrl,config.origin));
      const entry=config.googleSiteUrl?entries.find(s=>s.siteUrl===config.googleSiteUrl):entries.find(s=>s.siteUrl.startsWith('sc-domain:'))??entries[0];
      if(!sites.ok||!entry){Object.assign(p,{status:'BLOCKED',reason:'GOOGLE_VERIFIED_PROPERTY_ACCESS_REQUIRED'});save(result);continue;}
      p.siteUrl=entry.siteUrl;p.status='SUBMITTING';save(result);
      const endpoint=GOOGLE+'/'+encodeURIComponent(entry.siteUrl)+'/sitemaps/'+encodeURIComponent(result.sitemapUrl);
      const response=await request(fetcher,endpoint,{method:'PUT',headers});
      Object.assign(p,{httpStatus:response.status,status:response.status===null?'UNCERTAIN':response.ok?'ACCEPTED':'FAILED'});
      if(response.ok){const readback=await request(fetcher,endpoint,{headers});p.readbackHttpStatus=readback.status;p.recordVisible=readback.ok&&readback.json?.path===result.sitemapUrl;}
    } else if(provider==='bing') {
      if(!env.BING_WEBMASTER_API_KEY&&!env.BING_ACCESS_TOKEN){Object.assign(p,{status:'BLOCKED',reason:'MISSING_BING_CREDENTIALS'});save(result);continue;}
      const headers={'content-type':'application/json'};
      if(env.BING_ACCESS_TOKEN) headers.Authorization='Bearer '+env.BING_ACCESS_TOKEN;
      const url=name=>{const u=new URL(name,BING);if(!env.BING_ACCESS_TOKEN)u.searchParams.set('apikey',env.BING_WEBMASTER_API_KEY);return u.href;};
      const sites=await request(fetcher,url('GetUserSites'),{headers});p.preflightHttpStatus=sites.status;
      const entries=(Array.isArray(sites.json?.d)?sites.json.d:[]).filter(s=>s.IsVerified===true&&allowedProperty(s.Url,config.origin));
      const entry=config.bingSiteUrl?entries.find(s=>s.Url===config.bingSiteUrl):entries[0];
      if(!sites.ok||!entry){Object.assign(p,{status:'BLOCKED',reason:'BING_VERIFIED_SITE_ACCESS_REQUIRED'});save(result);continue;}
      p.siteUrl=entry.Url;p.status='SUBMITTING';save(result);
      const response=await request(fetcher,url('SubmitFeed'),{method:'POST',headers,body:JSON.stringify({siteUrl:entry.Url,feedUrl:result.sitemapUrl})});
      Object.assign(p,{httpStatus:response.status,status:response.status===null?'UNCERTAIN':response.status===200&&response.json?.d===null&&!response.json?.ErrorCode?'ACCEPTED':'FAILED'});
    } else {
      if(!config.indexNowKey){Object.assign(p,{status:'BLOCKED',reason:'MISSING_INDEXNOW_PUBLIC_KEY'});save(result);continue;}
      const keyLocation=config.origin+'/'+config.indexNowKey+'.txt';
      const key=await request(fetcher,keyLocation);p.keyHttpStatus=key.status;
      if(key.status!==200||key.text.trim()!==config.indexNowKey){Object.assign(p,{status:'BLOCKED',reason:'INDEXNOW_KEY_READBACK_FAILED'});save(result);continue;}
      p.batches=[];
      for(let offset=0;offset<urls.length;offset+=10000) {
        p.status='SUBMITTING';const batch={urlCount:Math.min(10000,urls.length-offset),httpStatus:null,status:'SUBMITTING'};p.batches.push(batch);save(result);
        const response=await request(fetcher,'https://api.indexnow.org/indexnow',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({host:new URL(config.origin).hostname,key:config.indexNowKey,keyLocation,urlList:urls.slice(offset,offset+10000)})});
        batch.httpStatus=response.status;batch.status=response.status===200?'ACCEPTED':response.status===202?'PENDING_KEY_VERIFICATION':response.status===null?'UNCERTAIN':'FAILED';
        p.httpStatus=response.status;p.status=batch.status;save(result);
        if(![200,202].includes(response.status)) break;
      }
      if(p.batches.some(b=>b.status==='PENDING_KEY_VERIFICATION')&&p.status==='ACCEPTED')p.status='PENDING_KEY_VERIFICATION';
    }
    save(result);
  }
  result.status=Object.values(result.providers).every(p=>p.status==='ACCEPTED')?'ACCEPTED_BY_ALL_REQUESTED_PROVIDERS':'PARTIAL_OR_BLOCKED';
  result.indexingConfirmed=false;result.finishedAt=new Date().toISOString();save(result);return result;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  let result,receipt,receiptCreated=false;
  try {
    const config=loadConfig(resolve(arg('--config')??'seo-indexing.config.json'));
    if(process.argv[2]==='generate') result=generate(config);
    else if(process.argv[2]==='submit') {
      check(arg('--receipt'),'RECEIPT_PATH_REQUIRED');receipt=resolve(arg('--receipt'));
      const rel=relative(config.outputDirectory,receipt);
      check(rel.startsWith('..'+sep)||rel==='..','RECEIPT_MUST_BE_OUTSIDE_DEPLOYABLE_OUTPUT');
      check(!existsSync(receipt),'RECEIPT_EXISTS_INSPECT_BEFORE_RETRY');mkdirSync(dirname(receipt),{recursive:true});
      result=await submit(config,{only:arg('--only')?.split(','),save:r=>{writeFileSync(receipt,JSON.stringify(r,null,2)+'\n','utf8');receiptCreated=true;}});
    } else fail('USE_GENERATE_OR_SUBMIT');
    console.log(JSON.stringify(result,null,2));
    if(result.status==='PARTIAL_OR_BLOCKED')process.exitCode=2;
  } catch(error) {
    const code=/^[A-Z0-9_]+$/.test(error.message)?error.message:'UNEXPECTED_ERROR';
    if(receiptCreated&&existsSync(receipt)){try{const prior=JSON.parse(readFileSync(receipt,'utf8'));prior.status='STOPPED';prior.error=code;writeFileSync(receipt,JSON.stringify(prior,null,2)+'\n');}catch{}}
    console.error(JSON.stringify({status:'STOPPED',error:code}));process.exitCode=1;
  }
}
