#!/usr/bin/env node
/**
 * Dependency-free, read-only MCP client for Agent Bounty Feed.
 * Does not fund wallets, request x402 content, sign transactions, or submit claims.
 */
const ENDPOINT = 'https://agent-bounty-feed.dailydollar.workers.dev/mcp';
const ALLOWED = new Set(['initialize','tools/list','tools/call']);
const TOOLS = new Set(['list_bounties','get_new_bounties','get_bounty','get_feed_stats']);
const BLOCK_REQUIREMENTS = new Set(['kyc','stake','bond','purchase','human_only']);
const TIMEOUT_MS = 12500;
const MAX_REPLY_BYTES = 1_500_000;

export function verifyUrl(url) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://agent-bounty-feed.dailydollar.workers.dev' || parsed.pathname !== '/mcp' || parsed.search || parsed.hash) {
    throw new Error('Denied: MCP endpoint must be the exact free /mcp URL');
  }
  return parsed.toString();
}
export function parseSse(raw) {
  const frames = raw.replace(/\r\n/g,'\n').split(/\n\n/);
  for(const frame of frames){
    const lines=frame.split('\n');
    const data=lines.filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');
    if(data){try{const v=JSON.parse(data);if(v.jsonrpc==='2.0' || v.result || v.error)return v;}catch{}}
  }
  throw new Error('MCP response contained no JSON-RPC event');
}
export function decodeMcp(contentType,body){
  if(Buffer.byteLength(body,'utf8')>MAX_REPLY_BYTES)throw new Error('Denied: oversized MCP response');
  if((contentType||'').includes('application/json'))return JSON.parse(body);
  if((contentType||'').includes('text/event-stream'))return parseSse(body);
  throw new Error('Denied: unsupported MCP response type');
}
export async function readLimited(response, limit=MAX_REPLY_BYTES){
  if(!Number.isSafeInteger(limit)||limit<1)throw new Error('Invalid response limit');
  if(!response.body||!response.body.getReader)throw new Error('MCP response has no stream body');
  const reader=response.body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let received=0,body='';
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      received+=value.byteLength;
      if(received>limit)throw new Error('Denied: streamed MCP response oversized');
      body+=decoder.decode(value,{stream:true});
    }
    return body+decoder.decode();
  }finally{
    reader.releaseLock();
    if(received>limit)await reader.cancel().catch(()=>{});
  }
}
export function validateMethod(method,params) {
  if(!ALLOWED.has(method))throw new Error(`Denied: non-read-only MCP method ${method}`);
  if(method==='tools/call' && (!TOOLS.has(params?.name) || !params?.arguments || typeof params.arguments!=='object' || Array.isArray(params.arguments)))throw new Error('Denied: unknown MCP tool or invalid arguments');
}
export async function rpc(method,params={},opts={}){
  validateMethod(method,params);
  const url=verifyUrl(opts.endpoint??ENDPOINT);
  const ctl=new AbortController();
  const timeout=setTimeout(()=>ctl.abort(),TIMEOUT_MS);
  try{
    const res=await (opts.fetch??fetch)(url,{
      method:'POST',redirect:'manual',signal:ctl.signal,
      headers:{'content-type':'application/json','accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},
      body:JSON.stringify({jsonrpc:'2.0',id:opts.id??1,method,params})
    });
    if(!res.ok)throw new Error(`MCP HTTP ${res.status}`);
    const n=Number(res.headers.get('content-length')??'0');
    if(n>MAX_REPLY_BYTES)throw new Error('Denied: oversized response header');
    const text=await readLimited(res,MAX_REPLY_BYTES);
    const packet=decodeMcp(res.headers.get('content-type'),text);
    if(packet.error)throw new Error(`MCP JSON-RPC error ${packet.error.code}: ${packet.error.message}`);
    if(packet.jsonrpc!=='2.0'||!('result' in packet))throw new Error('Invalid MCP JSON-RPC envelope');
    return packet.result;
  }finally{clearTimeout(timeout);}
}
export function unwrapItems(result){
  if(Array.isArray(result?.items))return result.items;
  for(const item of result?.content??[]){if(item.type==='text'){try{const obj=JSON.parse(item.text);if(Array.isArray(obj.items))return obj.items;if(Array.isArray(obj.bounties))return obj.bounties;}catch{}}}
  return [];
}
export function assess(items){
  return items.map(item=>{
    const requirements=(item.requires??[]).map(x=>String(x).toLowerCase());
    const blocked=requirements.filter(x=>BLOCK_REQUIREMENTS.has(x));
    const knownCash=typeof item.est_usd==='number'&&Number.isFinite(item.est_usd)&&item.est_usd>0;
    const hasUrl=typeof item.url==='string'&&item.url.startsWith('https://');
    const status=blocked.length?'DENY_COST_OR_RESTRICTION':!knownCash?'HOLD_PAYOUT_UNVERIFIED':!hasUrl?'HOLD_ORIGINAL_URL':'VERIFY_ORIGINAL_BOUNTY';
    return {id:item.id,title:item.title,est_usd:item.est_usd,source:item.source,url:item.url,requires:requirements,status,blocked};
  });
}
export function safeArgs(argv){
  const [cmd='list',...a]=argv;
  if(!new Set(['list','stats','new','get','methods']).has(cmd))throw new Error('Usage: list | stats | new <since ISO> | get <id> | methods');
  if(cmd==='new'&&(!a[0]||Number.isNaN(Date.parse(a[0]))))throw new Error('Provide valid since date');
  if(cmd==='get'&&(!a[0]||a[0].length>256))throw new Error('Provide valid bounty id');
  return {cmd,args:a};
}
export async function main(args=process.argv.slice(2),opts={}){
  const {cmd,args:a}=safeArgs(args);
  const send=opts.rpc??rpc;
  const init=await send('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ceralynx-readonly-client',version:'1.0.0'}});
  if(init.protocolVersion!=='2025-06-18')throw new Error('Unexpected MCP protocol version');
  let result;
  if(cmd==='methods')result=await send('tools/list',{});
  else {
    const name=cmd==='stats'?'get_feed_stats':cmd==='new'?'get_new_bounties':cmd==='get'?'get_bounty':'list_bounties';
    const argumentsObj=cmd==='new'?{since:a[0],limit:50,exclude_requires:'kyc,stake,bond,purchase,human_only'}:cmd==='get'?{id:a[0]}:cmd==='list'?{min_usd:0.01,limit:100,exclude_requires:'kyc,stake,bond,purchase,human_only'}:{};
    result=await send('tools/call',{name,arguments:argumentsObj});
  }
  const data=cmd==='list'||cmd==='new'?{method:cmd,checked_at:new Date().toISOString(),items:assess(unwrapItems(result))}:result;
  if(!opts.silent)process.stdout.write(JSON.stringify(data,null,2)+'\n');
  return data;
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(e.message);process.exitCode=1;});
