
const fs=require("fs"),path=require("path");
function e(v){return v==null?"":String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
function arr(v){if(Array.isArray(v))return v;if(v==null||v==="")return[];return[v]}
function uniq(v){return[...new Set(v.filter(x=>x!=null&&String(x).trim()).map(x=>String(x).trim()))]}
function pageUrl(p){return p?.url||p?.pageUrl||p?.URL||""}
function pageName(p){return p?.pageName||p?.page_name||""}
function hits(p){return Array.isArray(p?.adobeHits)?p.adobeHits:[]}
function evars(h){return h?.eVars&&typeof h.eVars==="object"?h.eVars:{}}
function props(h){return h?.props&&typeof h.props==="object"?h.props:{}}
function events(h){if(h?.events==null)return[];if(Array.isArray(h.events))return h.events;if(typeof h.events==="object")return Object.keys(h.events);return String(h.events).split(",").map(x=>x.trim()).filter(Boolean)}
function ctaHit(h){return String(h?.pe||"").toLowerCase()==="lnk_o"||String(h?.pev2||"").toLowerCase().includes("cta click")}
function allPageHits(p,r){const ph=hits(p),url=pageUrl(p),pn=pageName(p),gh=Array.isArray(r?.adobeHits)?r.adobeHits:[];const extra=gh.filter(h=>!ph.includes(h)&&((url&&h.url===url)||(pn&&h.pageName===pn)));return[...ph,...extra]}
function pageLoadHits(p,r){return allPageHits(p,r).filter(h=>!ctaHit(h))}
function valuesFor(hs,key,type){const out=[];hs.forEach(h=>Object.entries(type==="eVar"?evars(h):props(h)).forEach(([k,v])=>{if(k===key)out.push(...arr(v))}));return uniq(out)}
function keysFor(hs,type){const s=new Set;hs.forEach(h=>Object.keys(type==="eVar"?evars(h):props(h)).forEach(k=>s.add(k)));return[...s].sort((a,b)=>{const na=Number(a.replace(/[a-z]/i,"")),nb=Number(b.replace(/[a-z]/i,""));return na-nb||a.localeCompare(b)})}
function eventList(hs){return uniq(hs.flatMap(events))}
function badge(v){const s=String(v).toUpperCase();if(s==="PASS"||s==="YES")return'<span class="b pass">✓ PASS</span>';if(s==="FAIL"||s==="NO")return'<span class="b fail">✕ FAIL</span>';if(s==="NOT VALIDATED")return'<span class="b warn">! NOT VALIDATED</span>';return'<span class="b neutral">'+e(v)+"</span>"}
function value(v){return v?'<span class="val">'+e(v)+'</span>':'<span class="muted">Not populated</span>'}
function hitType(h){return ctaHit(h)?"CTA / Link Tracking":"Page Load"}
function ctaRecords(p){return Array.isArray(p?.ctaValidations)?p.ctaValidations:[]}
function ctaDetails(item){
const ah=Array.isArray(item?.ctaAdobeHits)?item.ctaAdobeHits:[];
const event6=item?.event6===true||String(item?.event6).toLowerCase()==="yes"||ah.some(h=>events(h).some(x=>String(x).toLowerCase()==="event6"));
const ev24=ah.map(h=>evars(h).v24||evars(h).V24||"").find(Boolean)||item?.eVar24||item?.v24||"";
const link=ah.map(h=>h?.link||h?.pev2||"").find(x=>x)||"";
const pe=ah.map(h=>h?.pe||"").find(x=>x)||"";
const pev2=ah.map(h=>h?.pev2||"").find(x=>x)||"";
const passed=event6&&String(ev24).trim()!=="";
const raw=String(item?.status||item?.validation||"").toUpperCase();
const status=raw==="NOT_VALIDATED"?"NOT VALIDATED":passed?"PASS":"FAIL";
return{event6,ev24,link,pe,pev2,status,hits:ah}
}
function buildPageData(p,r){
const hs=pageLoadHits(p,r),evs=eventList(hs),ek=keysFor(hs,"eVar"),pk=keysFor(hs,"prop");
return{p,hs,evs,ek,pk}
}
function buildSummary(pages,results,cta){
const pageLoad=pages.filter(p=>pageLoadHits(p,results).length).length;
const adobe=pages.filter(p=>hits(p).length||(Array.isArray(results?.adobeHits)&&results.adobeHits.some(h=>h.url===pageUrl(p)||h.pageName===pageName(p)))).length;
const ctas=cta.flatMap(x=>x.records.map(r=>ctaDetails(r)));
const ctaPass=ctas.filter(x=>x.status==="PASS").length,ctaFail=ctas.filter(x=>x.status==="FAIL").length;
const errors=Array.isArray(results?.errors)?results.errors.length:0;
return{pageLoad,adobe,cta:ctas.length,ctaPass,ctaFail,errors,totalHits:Array.isArray(results?.adobeHits)?results.adobeHits.length:pages.reduce((n,p)=>n+hits(p).length,0)}
}
function buildHTML(results){
const pages=Array.isArray(results?.pages)?results.pages:[],errors=Array.isArray(results?.errors)?results.errors:[];
const data=pages.map(p=>buildPageData(p,results));
const cta=data.map(d=>({p:d.p,records:ctaRecords(d.p)}));
const s=buildSummary(pages,results,cta);
let html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Adobe Website Analytics Validation Report</title><style>*{box-sizing:border-box}body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0;background:#f5f7fa;color:#1f2937;line-height:1.5}.header{background:#111827;color:#fff;padding:30px 38px}.header h1{margin:0;font-size:28px}.header p{margin:6px 0 0;color:#d1d5db;font-size:12px}.container{max-width:1550px;margin:auto;padding:26px 28px 45px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin-bottom:24px}.card,.section{background:#fff;border:1px solid #e5e7eb;border-radius:11px;box-shadow:0 2px 7px rgba(15,23,42,.04)}.card{padding:16px}.label{font-size:10px;text-transform:uppercase;color:#6b7280;font-weight:700;letter-spacing:.5px}.num{font-size:25px;font-weight:700;margin-top:4px}.sub{font-size:10px;color:#9ca3af}.section{margin-bottom:20px;overflow:hidden}.head{padding:17px 20px;border-bottom:1px solid #e5e7eb;background:#fafbfc}.head h2{margin:0;font-size:17px}.head p{margin:4px 0 0;font-size:11px;color:#6b7280}.body{padding:0 20px 20px}.page{margin:18px 0;border:1px solid #e5e7eb;border-radius:9px;overflow:hidden}.pagehead{padding:14px 16px;background:#f8fafc}.pagehead strong{display:block;font-size:14px}.pagehead span{font-size:11px;color:#6b7280;word-break:break-all}.subhead{padding:11px 16px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700}.table{overflow:auto}table{width:100%;border-collapse:collapse}th{background:#374151;color:#fff;text-align:left;padding:10px;font-size:10px;text-transform:uppercase;white-space:nowrap}td{padding:10px;border-bottom:1px solid #edf0f3;font-size:11px;vertical-align:top}tr:last-child td{border-bottom:0}.key{font-weight:700;white-space:nowrap}.val{display:inline-block;background:#f3f4f6;border-radius:5px;padding:3px 6px;word-break:break-word}.muted{color:#9ca3af}.b{display:inline-block;border-radius:999px;padding:3px 8px;font-size:9px;font-weight:700;white-space:nowrap}.pass{background:#dcfce7;color:#166534}.fail{background:#fee2e2;color:#991b1b}.warn{background:#fef3c7;color:#92400e}.neutral{background:#e5e7eb;color:#374151}.info{padding:11px 13px;background:#eff6ff;border:1px solid #dbeafe;color:#1e40af;border-radius:7px;font-size:11px;margin:16px 0}.tech{font-size:10px;color:#6b7280;word-break:break-all}.footer{text-align:center;color:#9ca3af;font-size:10px;padding:0 0 25px}.empty{padding:22px;text-align:center;color:#9ca3af;font-size:12px}.cta-title{font-weight:700}.small{font-size:10px;color:#6b7280}@media(max-width:800px){.container{padding:15px 10px}.header{padding:24px 18px}}</style></head><body><div class="header"><h1>Adobe Website Analytics Validation Report</h1><p>Generated: '+e(new Date().toLocaleString())+'</p></div><div class="container"><div class="cards">';
html+='<div class="card"><div class="label">Pages Scanned</div><div class="num">'+pages.length+'</div><div class="sub">Selected/crawled pages</div></div><div class="card"><div class="label">Adobe Pages</div><div class="num">'+s.adobe+'</div><div class="sub">Pages with Adobe tracking</div></div><div class="card"><div class="label">Page Load Hits</div><div class="num">'+s.pageLoad+'</div><div class="sub">Pages with page-load hit</div></div><div class="card"><div class="label">Adobe Hits</div><div class="num">'+s.totalHits+'</div><div class="sub">Captured /b/ss hits</div></div><div class="card"><div class="label">CTA Checks</div><div class="num">'+s.cta+'</div><div class="sub">'+s.ctaPass+' PASS / '+s.ctaFail+' FAIL</div></div><div class="card"><div class="label">Crawler Errors</div><div class="num">'+s.errors+'</div><div class="sub">Execution/crawl errors</div></div></div>';
html+='<div class="section"><div class="head"><h2>Validation Summary</h2><p>Client-facing overview. Page-load data and CTA interaction data are validated separately.</p></div><div class="body"><div class="info"><strong>Interpretation:</strong> A variable is reported against the hit where it is expected to occur. CTA-specific values such as <strong>event6</strong> and <strong>eVar24</strong> are not treated as page-load failures when they are absent from the initial page-load hit.</div><div class="table"><table><thead><tr><th>#</th><th>Page URL</th><th>Page Name</th><th>Page Load</th><th>eVars</th><th>Props</th><th>Events</th><th>CTA</th></tr></thead><tbody>';
data.forEach((d,i)=>{const p=d.p,ctas=d.p.ctaValidations||[],cd=ctas.map(ctaDetails),pageStatus=d.hs.length?"PASS":"FAIL",ctaStatus=!ctas.length?"-":cd.every(x=>x.status==="PASS")?"PASS":cd.some(x=>x.status==="FAIL")?"FAIL":"NOT VALIDATED";html+='<tr><td>'+(i+1)+'</td><td>'+e(pageUrl(p))+'</td><td>'+e(pageName(p)||"-")+'</td><td>'+badge(pageStatus)+'</td><td>'+badge(d.ek.length?"PASS":"-")+'</td><td>'+badge(d.pk.length?"PASS":"-")+'</td><td>'+badge(d.evs.length?"PASS":"-")+'</td><td>'+badge(ctaStatus)+'</td></tr>'});
html+='</tbody></table></div></div></div>';
data.forEach((d,i)=>{const p=d.p;html+='<div class="section"><div class="head"><h2>Page '+(i+1)+': '+e(pageName(p)||pageUrl(p)||"Unnamed Page")+'</h2><p>'+e(pageUrl(p))+'</p></div><div class="body">';
html+='<div class="subhead">Page Load Validation</div>';
if(d.hs.length){html+='<div class="table"><table><thead><tr><th>Variable</th><th>Type</th><th>Value</th><th>Hit</th><th>Status</th></tr></thead><tbody>';
const technical=d.hs.flatMap(h=>[["pageName","Adobe",h.pageName,hitType(h)],["g","Page URL",h.g||h.url||"",hitType(h)],["ch","Channel",h.ch||"",hitType(h)],["server","Server",h.server||"",hitType(h)]]);
technical.forEach(x=>html+='<tr><td class="key">'+e(x[0])+'</td><td>'+e(x[1])+'</td><td>'+value(x[2])+'</td><td>'+e(x[3])+'</td><td>'+badge(x[2]?"PASS":"FAIL")+'</td></tr>');
d.ek.forEach(k=>{const v=valuesFor(d.hs,k,"eVar");html+='<tr><td class="key">'+e(k)+'</td><td>eVar</td><td>'+value(v.join(", "))+'</td><td>Page Load</td><td>'+badge(v.length?"PASS":"FAIL")+'</td></tr>'});
d.pk.forEach(k=>{const v=valuesFor(d.hs,k,"prop");html+='<tr><td class="key">'+e(k)+'</td><td>Prop</td><td>'+value(v.join(", "))+'</td><td>Page Load</td><td>'+badge(v.length?"PASS":"FAIL")+'</td></tr>'});
d.evs.forEach(k=>html+='<tr><td class="key">'+e(k)+'</td><td>Event</td><td>'+value(k)+'</td><td>Page Load</td><td>'+badge("PASS")+'</td></tr>');
html+='</tbody></table></div>'}else html+='<div class="empty">No page-load Adobe hit was captured.</div>';
if(d.hs.length){html+='<div class="subhead">Page Load Hit Details</div><div class="table"><table><thead><tr><th>Hit</th><th>Report Suite</th><th>Page Name</th><th>Products</th><th>Events</th><th>eVars</th><th>Props</th></tr></thead><tbody>';
d.hs.forEach((h,n)=>html+='<tr><td>#'+(n+1)+'</td><td>'+e(h.reportSuite||"-")+'</td><td>'+e(h.pageName||"-")+'</td><td>'+value(h.products||"")+'</td><td>'+value(events(h).join(", "))+'</td><td class="tech">'+e(Object.entries(evars(h)).map(([k,v])=>k+"="+arr(v).join(",")).join(" | ")||"-")+'</td><td class="tech">'+e(Object.entries(props(h)).map(([k,v])=>k+"="+arr(v).join(",")).join(" | ")||"-")+'</td></tr>');
html+='</tbody></table></div>'}
const ctas=ctaRecords(p);
html+='<div class="subhead">CTA Validation</div>';
if(ctas.length){html+='<div class="table"><table><thead><tr><th>CTA</th><th>Adobe Hit</th><th>event6</th><th>eVar24</th><th>Link</th><th>pe</th><th>pev2</th><th>Result</th></tr></thead><tbody>';
ctas.forEach(item=>{const c=ctaDetails(item);html+='<tr><td class="cta-title">'+e(item.ctaName||item.label||item.name||"-")+'</td><td>'+e(c.hits.length?"Captured":"Not captured")+'</td><td>'+badge(c.event6?"PASS":"FAIL")+'</td><td>'+value(c.ev24)+'</td><td>'+value(c.link)+'</td><td>'+value(c.pe)+'</td><td>'+value(c.pev2)+'</td><td>'+badge(c.status)+'</td></tr>'});
html+='</tbody></table></div>'}else html+='<div class="empty">No CTA validation was requested or no CTA data was captured for this page.</div>';
html+='<div class="subhead">Technical Adobe Hit Details</div><div class="table"><table><thead><tr><th>Hit</th><th>Type</th><th>Request</th><th>Page Name</th><th>pe</th><th>pev2</th><th>Technical Parameters</th></tr></thead><tbody>';
allPageHits(p,results).forEach((h,n)=>{const tech=Object.entries(h||{}).filter(([k])=>!["url","requestId","reportSuite","pageName","products","events","eVars","props","pe","pev2","link","timestamp"].includes(k)).map(([k,v])=>k+"="+(typeof v==="object"?JSON.stringify(v):v)).join(" | ");html+='<tr><td>#'+(n+1)+'</td><td>'+e(hitType(h))+'</td><td class="tech">'+e(h.url||"-")+'</td><td>'+e(h.pageName||"-")+'</td><td>'+value(h.pe||"")+'</td><td>'+value(h.pev2||"")+'</td><td class="tech">'+e(tech||"-")+'</td></tr>'});
html+='</tbody></table></div></div></div>'});
html+='<div class="section"><div class="head"><h2>Third-Party Marketing Pixels</h2><p>Detected marketing/analytics vendors across scanned pages.</p></div><div class="body">';
const pixels=[];pages.forEach(p=>(Array.isArray(p.marketingPixels)?p.marketingPixels:[]).forEach(x=>{const n=x?.name||x?.vendor;if(n&&!pixels.some(y=>y.name.toLowerCase()===String(n).toLowerCase()))pixels.push({name:n,use:x.use||"Engagement",pages:[]});const y=pixels.find(y=>y.name.toLowerCase()===String(n||"").toLowerCase());if(y&&!y.pages.includes(pageUrl(p)))y.pages.push(pageUrl(p))}));
if(pixels.length){html+='<div class="table"><table><thead><tr><th>#</th><th>Vendor</th><th>Use</th><th>Pages</th></tr></thead><tbody>';pixels.forEach((x,i)=>html+='<tr><td>'+(i+1)+'</td><td class="key">'+e(x.name)+'</td><td>'+e(x.use)+'</td><td>'+e(x.pages.join(", "))+'</td></tr>');html+='</tbody></table></div>'}else html+='<div class="empty">No third-party marketing pixels detected.</div>';
html+='</div></div>';
if(errors.length){html+='<div class="section"><div class="head"><h2>Validation / Crawler Errors</h2><p>Errors captured during execution.</p></div><div class="body"><div class="table"><table><thead><tr><th>#</th><th>Error</th></tr></thead><tbody>';errors.forEach((x,i)=>html+='<tr><td>'+(i+1)+'</td><td>'+e(x?.error||x?.message||JSON.stringify(x))+'</td></tr>');html+='</tbody></table></div></div></div>'}
html+='</div><div class="footer">Adobe Website Analytics Validator</div></body></html>';return html
}
async function generateHTML(results,outputDirectory){if(!results)throw new Error("Scan results are required to generate the report.");outputDirectory=outputDirectory||path.join(__dirname,"output");fs.mkdirSync(outputDirectory,{recursive:true});const outputPath=path.join(outputDirectory,"adobeScanReport.html");fs.writeFileSync(outputPath,buildHTML(results),"utf8");return outputPath}
async function generate(results,outputDirectory){return generateHTML(results,outputDirectory)}
module.exports={generateHTML,generate};
