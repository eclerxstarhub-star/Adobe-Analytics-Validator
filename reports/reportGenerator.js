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
function ctaHit(h){return String(h?.pe||"").toLowerCase()==="lnk_o"&&String(h?.pev2||"").toLowerCase().includes("cta click")}
function allHits(p,r){const ph=hits(p),url=pageUrl(p),pn=pageName(p),gh=Array.isArray(r?.adobeHits)?r.adobeHits:[];const extra=gh.filter(h=>!ph.includes(h)&&((url&&h.url===url)||(pn&&h.pageName===pn)));return[...ph,...extra]}
function pageLoadHits(p,r){return allHits(p,r).filter(h=>!ctaHit(h))}
function ctaRecords(p){return Array.isArray(p?.ctaValidations)?p.ctaValidations:[]}
function ctaDetails(item){const ah=Array.isArray(item?.ctaAdobeHits)?item.ctaAdobeHits:[],matching=ah.find(h=>ctaHit(h)),event6=!!(matching&&events(matching).some(x=>String(x).toLowerCase()==="event6")),ev24=matching?(evars(matching).v24||evars(matching).V24||""):"";return{captured:!!matching,event6,ev24,link:matching?.link||"",pe:matching?.pe||"",pev2:matching?.pev2||"",status:matching&&event6&&String(ev24).trim()?"PASS":"FAIL"}}
function badge(v){const s=String(v).toUpperCase();if(s==="PASS"||s==="YES"||s==="TRUE")return'<span class="b pass">✓</span>';if(s==="FAIL"||s==="NO"||s==="FALSE")return'<span class="b fail">✗</span>';return'<span class="b neutral">'+e(v)+'</span>'}
function val(v){return v==null||String(v)===""?'<span class="muted">-</span>':e(v)}
function variableRows(p,r,type){
const rows=[],ph=pageLoadHits(p,r);
const add=(key,value)=>{if(value==null||String(value).trim()==="")return;const id=type+"|"+key+"|"+String(value);if(rows.some(x=>x.id===id))return;rows.push({id,key,value})};
if(type==="eVar")ph.forEach(h=>Object.entries(evars(h)).forEach(([k,v])=>arr(v).forEach(x=>add(k,x))));
if(type==="prop")ph.forEach(h=>Object.entries(props(h)).forEach(([k,v])=>arr(v).forEach(x=>add(k,x))));
if(type==="event")ph.forEach(h=>events(h).forEach(x=>{if(String(x).toLowerCase()==="event217")add(x,"1");else if(String(x).toLowerCase()!=="event6")add(x,"1")}));
return rows}
function pageRows(p,r){return{pageLoad:pageLoadHits(p,r),evars:variableRows(p,r,"eVar"),props:variableRows(p,r,"prop"),events:variableRows(p,r,"event")}}
function buildSummary(pages,r,ctas){const adobe=pages.filter(p=>allHits(p,r).length>0).length;const c=ctas.flatMap(x=>x.records.map(ctaDetails));return{pages:pages.length,adobe,cta:c.length,hit:adobe>0}}
function buildHTML(results){
const pages=Array.isArray(results?.pages)?results.pages:[],errors=Array.isArray(results?.errors)?results.errors:[],data=pages.map(p=>pageRows(p,results)),ctas=pages.map(p=>({p,records:ctaRecords(p)})),s=buildSummary(pages,results,ctas);
let html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Adobe Website Analytics Validation Report</title><style>*{box-sizing:border-box}body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0;background:#f5f7fa;color:#1f2937;line-height:1.45}.header{background:#111827;color:#fff;padding:28px 38px}.header h1{margin:0;font-size:26px}.header p{margin:5px 0 0;color:#cbd5e1;font-size:11px}.container{max-width:1500px;margin:auto;padding:24px 28px 40px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}.card,.section{background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 2px 7px rgba(15,23,42,.04)}.card{padding:16px}.label{font-size:10px;text-transform:uppercase;color:#6b7280;font-weight:700;letter-spacing:.5px}.num{font-size:26px;font-weight:700;margin-top:3px}.sub{font-size:10px;color:#6b7280;margin-top:4px}.section{margin-bottom:20px;overflow:hidden}.head{padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#fafbfc}.head h2{margin:0;font-size:17px}.head p{margin:4px 0 0;color:#6b7280;font-size:11px}.body{padding:0 20px 18px}.table{overflow:auto}table{width:100%;border-collapse:collapse}th{background:#374151;color:#fff;text-align:left;padding:10px;font-size:10px;text-transform:uppercase;white-space:nowrap}td{padding:9px 10px;border-bottom:1px solid #edf0f3;font-size:11px;vertical-align:top}tr:last-child td{border-bottom:0}.b{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:50%;font-size:14px;font-weight:800;line-height:1}.pass{background:#dcfce7;color:#15803d}.fail{background:#fee2e2;color:#dc2626}.neutral{background:#e5e7eb;color:#374151}.muted{color:#9ca3af}.url{word-break:break-all}.subhead{font-size:13px;font-weight:700;margin:18px 0 8px}.meta{font-size:11px;color:#6b7280;margin:-3px 0 12px;word-break:break-all}.statusPass{color:#15803d;font-weight:800}.statusFail{color:#dc2626;font-weight:800}.errorline{padding:8px 0;border-bottom:1px solid #edf0f3;font-size:11px}.errorline:last-child{border-bottom:0}.footer{text-align:center;color:#9ca3af;font-size:10px;padding:0 0 20px}@media(max-width:850px){.cards{grid-template-columns:repeat(2,1fr)}.container{padding:15px 10px}.header{padding:22px 18px}}</style></head><body><div class="header"><h1>Adobe Website Analytics Validation Report</h1><p>Generated: '+e(new Date().toLocaleString())+'</p></div><div class="container">';
html+='<div class="cards"><div class="card"><div class="label">Pages Scanned</div><div class="num">'+s.pages+'</div></div><div class="card"><div class="label">Adobe Pages</div><div class="num">'+s.adobe+'</div></div><div class="card"><div class="label">CTA Checks</div><div class="num">'+s.cta+'</div></div><div class="card"><div class="label">Adobe Hit</div><div class="num">'+badge(s.hit?"Yes":"No")+'</div><div class="sub">/b/ss '+(s.hit?"captured":"not captured")+' in network</div></div></div>';
html+='<div class="section"><div class="head"><h2>2. Page-Level Validation</h2><p>Page-load analytics variables and events captured from Adobe Analytics hits.</p></div><div class="body">';
pages.forEach((p,i)=>{const d=data[i];html+='<div class="subhead">Page '+(i+1)+' — '+e(pageName(p)||"-")+'</div><div class="meta">'+e(pageUrl(p))+'</div>';
html+='<div class="subhead">eVars</div><div class="table"><table><thead><tr><th>#</th><th>eVar</th><th>eVar Value</th><th>Adobe Hit</th><th>Status</th></tr></thead><tbody>';
d.evars.forEach((x,n)=>html+='<tr><td>'+(n+1)+'</td><td>'+e(x.key)+'</td><td>'+val(x.value)+'</td><td>'+badge("Yes")+'</td><td><span class="statusPass">PASS</span></td></tr>');
if(!d.evars.length)html+='<tr><td colspan="5" class="muted">No eVar values captured.</td></tr>';
html+='</tbody></table></div>';
html+='<div class="subhead">Props</div><div class="table"><table><thead><tr><th>#</th><th>Prop</th><th>Prop Value</th><th>Adobe Hit</th><th>Status</th></tr></thead><tbody>';
d.props.forEach((x,n)=>html+='<tr><td>'+(n+1)+'</td><td>'+e(x.key)+'</td><td>'+val(x.value)+'</td><td>'+badge("Yes")+'</td><td><span class="statusPass">PASS</span></td></tr>');
if(!d.props.length)html+='<tr><td colspan="5" class="muted">No prop values captured.</td></tr>';
html+='</tbody></table></div>';
html+='<div class="subhead">Events</div><div class="table"><table><thead><tr><th>#</th><th>Event</th><th>Event Value</th><th>Adobe Hit</th><th>Status</th></tr></thead><tbody>';
d.events.forEach((x,n)=>html+='<tr><td>'+(n+1)+'</td><td>'+e(x.key)+'</td><td>'+val(x.value)+'</td><td>'+badge("Yes")+'</td><td><span class="statusPass">PASS</span></td></tr>');
if(!d.events.length)html+='<tr><td colspan="5" class="muted">No events captured.</td></tr>';
html+='</tbody></table></div>';
});
html+='</div></div>';
html+='<div class="section"><div class="head"><h2>3. CTA Validation</h2><p>CTA tracking is validated using the captured Adobe CTA hit, event6, and eVar24.</p></div><div class="body">';
let ctaIndex=0;
ctas.forEach((group,i)=>{if(!group.records.length)return;html+='<div class="subhead">Page '+(i+1)+' — '+e(pageName(group.p)||"-")+'</div><div class="table"><table><thead><tr><th>#</th><th>CTA Validated</th><th>Adobe Hit</th><th>event6</th><th>eVar24</th><th>Status</th></tr></thead><tbody>';
group.records.forEach(item=>{ctaIndex++;const c=ctaDetails(item),name=item.ctaName||item.label||item.name||item.cta||"Unnamed CTA";html+='<tr><td>'+ctaIndex+'</td><td>'+e(name)+'</td><td>'+badge(c.captured?"Yes":"No")+'</td><td>'+badge(c.event6?"Yes":"No")+'</td><td>'+val(c.ev24)+'</td><td><span class="'+(c.status==="PASS"?"statusPass":"statusFail")+'">'+c.status+'</span></td></tr>'});
html+='</tbody></table></div>'});
if(!ctaIndex)html+='<div class="errorline">No CTA validations captured.</div>';
html+='</div></div>';
html+='<div class="section"><div class="head"><h2>4. Marketing Channel</h2><p>Marketing pixel detection remains unchanged.</p></div><div class="body"><div class="table"><table><thead><tr><th>#</th><th>Vendor</th><th>Use</th><th>Pages</th></tr></thead><tbody>';
const pixels=[];pages.forEach(p=>(Array.isArray(p.marketingPixels)?p.marketingPixels:[]).forEach(x=>{const name=x?.name||x?.vendor;if(!name)return;let y=pixels.find(a=>a.name.toLowerCase()===String(name).toLowerCase());if(!y){y={name,use:x.use||"Engagement",pages:[]};pixels.push(y)}if(!y.pages.includes(pageUrl(p)))y.pages.push(pageUrl(p))}));
pixels.forEach((x,i)=>html+='<tr><td>'+(i+1)+'</td><td>'+e(x.name)+'</td><td>'+e(x.use)+'</td><td class="url">'+e(x.pages.join(", "))+'</td></tr>');
if(!pixels.length)html+='<tr><td colspan="4" class="muted">No marketing pixels detected.</td></tr>';
html+='</tbody></table></div></div></div>';
html+='<div class="section"><div class="head"><h2>5. Validation Errors</h2><p>Each issue is shown as a single line.</p></div><div class="body">';
const errorLines=[];errors.forEach(x=>errorLines.push(x?.error||x?.message||JSON.stringify(x)));
pages.forEach(p=>ctaRecords(p).forEach(item=>{const c=ctaDetails(item);if(c.status!=="PASS"){const name=item.ctaName||item.label||item.name||item.cta||"Unnamed CTA";errorLines.push(name+" CTA not fired / Adobe CTA hit not captured; may not be implemented under Adobe tags.")}}));
uniq(errorLines).forEach(x=>html+='<div class="errorline">'+e(x)+'</div>');
if(!errorLines.length)html+='<div class="errorline">No validation errors.</div>';
html+='</div></div></div><div class="footer">Adobe Website Analytics Validator</div></body></html>';
return html}
async function generateHTML(results,outputDirectory){if(!results)throw new Error("Scan results are required to generate the report.");outputDirectory=outputDirectory||path.join(__dirname,"output");fs.mkdirSync(outputDirectory,{recursive:true});const outputPath=path.join(outputDirectory,"adobeScanReport.html");fs.writeFileSync(outputPath,buildHTML(results),"utf8");return outputPath}
async function generate(results,outputDirectory){return generateHTML(results,outputDirectory)}
module.exports={generateHTML,generate};
