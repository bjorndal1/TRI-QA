import http from 'node:http';

const PORT = Number(process.env.PORT || 10000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://tri-qa.onrender.com';
const MAX_BODY = 16_384;
const requests = new Map();

function respond(res, status, data, origin = '') {
  const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
  if (origin === ALLOWED_ORIGIN) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}
function outputText(response) {
  return (response.output || []).flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text').map(part => part.text || '').join('\n');
}
function citations(response) {
  const links = new Map();
  for (const item of response.output || []) for (const part of item.content || [])
    for (const ann of part.annotations || []) {
      if (ann.type === 'url_citation' && ann.url && /^https:\/\//i.test(ann.url))
        links.set(ann.url, {url:ann.url, title:ann.title || ann.url});
    }
  return [...links.values()];
}
const instructions = `You are TRI-Q&A | Triathlon – Rules Intelligence, by bjorndalMovement.
Answer in the requested language (Danish or English). Only use authoritative primary sources: official World Triathlon competition rules and accessible official educational manuals. For World Triathlon questions, use only official World Triathlon sources. For IRONMAN questions, use only official IRONMAN competition rules and relevant event-specific official guidance. Never use a World Triathlon rule to substantiate an IRONMAN answer or vice versa. State which rulebook applies. Use web search to retrieve and cross-check current official documents.
Tolerate spelling errors and informal language. If a factual ambiguity would change the ruling, ask ONE concise follow-up question rather than guessing; maintain the conversation context.
For any substantive rule answer, specify document title, edition, exact rule/section, VERIFIED page number if available, and direct official document URL. Distinguish verbatim rule text from interpretation. Never invent sections, page numbers, edition dates, citations or sanctions. If the exact page or source cannot be verified, explicitly say so; do not claim verification. Education materials may be inaccessible; acknowledge that.
You are an unofficial support tool, not a race official making binding decisions. Do not request personal data.`;
const server = http.createServer(async (req,res) => {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') {
    if (origin !== ALLOWED_ORIGIN) return respond(res,403,{error:'Origin not allowed'},origin);
    res.writeHead(204,{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type','vary':'Origin'}); return res.end();
  }
  if (req.url === '/health' && req.method === 'GET') return respond(res,200,{status:'ok',configured:!!process.env.OPENAI_API_KEY},origin);
  if (req.url !== '/api/ask' || req.method !== 'POST') return respond(res,404,{error:'Not found'},origin);
  if (origin !== ALLOWED_ORIGIN) return respond(res,403,{error:'Origin not allowed'},origin);
  const ip = req.socket.remoteAddress || 'unknown', now=Date.now();
  const record=requests.get(ip)||{start:now,count:0};
  if (now-record.start > 60000) {record.start=now;record.count=0;}
  record.count++;requests.set(ip,record);
  if (record.count > 12) return respond(res,429,{error:'Too many requests; try again shortly'},origin);
  if (!process.env.OPENAI_API_KEY) return respond(res,503,{error:'AI is not configured yet'},origin);
  try {
    let raw='';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return respond(res,413,{error:'Question too long'},origin);
    }
    const input=JSON.parse(raw);
    const question=String(input.question||'').trim();
    if (!question || question.length > 2500) return respond(res,400,{error:'Question must be 1–2500 characters'},origin);
    const language=input.language === 'en'?'English':'Danish';
    const module=input.module === 'education'?'Education Reference':'Rules Reference';
    const ruleset=input.module === 'education' ? 'world-triathlon' : input.ruleset === 'ironman' ? 'ironman' : 'world-triathlon';
    const level=['1','2','3A','3B'].includes(input.level)?input.level:'unspecified';
    const history=Array.isArray(input.history)?input.history.slice(-6).filter(x=>x && ['user','assistant'].includes(x.role) && typeof x.content==='string').map(x=>({role:x.role,content:x.content.slice(0,2000)})):[];
    const payload={model:MODEL,instructions,tools:[{type:'web_search'}],input:[...history,{role:'user',content:`Language: ${language}; Module: ${module}; Applicable rulebook: ${ruleset}; Level: ${level}. Question: ${question}`}],max_output_tokens:1300};
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),45000);
    let response;
    try {
      response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
    } finally {clearTimeout(timeout);}
    const result=await response.json();
    if (!response.ok) return respond(res,502,{error:'AI provider request failed',detail:result.error?.message||'Unknown error'},origin);
    const answer=outputText(result), sources=citations(result);
    if (!answer) return respond(res,502,{error:'No answer was returned'},origin);
    respond(res,200,{answer,sources,verified:sources.length>0,notice:sources.length?'Citations link to retrieved sources; verify edition, section and page in original document.':'No machine-readable source citations returned. Do not treat this as a verified ruling.'},origin);
  } catch(e) {respond(res,500,{error:e.name==='AbortError'?'AI request timed out':'Could not process question'},origin);}
});
server.listen(PORT,'0.0.0.0',()=>console.log('TRI-Q&A API listening on '+PORT));
