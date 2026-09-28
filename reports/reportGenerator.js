const fs=require("fs"),path=require("path");

function escapeHtml(value){
if(value===null||value===undefined)return"";
return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function normalizeArray(value){
if(Array.isArray(value))return value;
if(value===null||value===undefined||value==="")return[];
return[value];
}

function unique(values){
return[...new Set(values.filter(v=>v!==null&&v!==undefined).map(v=>String(v).trim()).filter(Boolean))];
}

function getPageUrl(page){
return page.url||page.pageUrl||page.URL||"";
}

function getPageName(page){
return page.pageName||page.page_name||"";
}

function getPageError(page){
return Array.isArray(page.errors)&&page.errors.length>0;
}

function getAdobePresent(page){
return page.adobeTagPresent===true||(Array.isArray(page.adobeHits)&&page.adobeHits.length>0);
}

function getHitUrl(hit){
return hit?.url||hit?.pageUrl||hit?.URL||hit?.pageURL||"";
}

function getHitPageName(hit){
return hit?.pageName||hit?.page_name||"";
}

function getHitEvars(hit){
return hit&&hit.eVars&&typeof hit.eVars==="object"?hit.eVars:{};
}

function getHitProps(hit){
return hit&&hit.props&&typeof hit.props==="object"?hit.props:{};
}

function getHitEvents(hit){
if(!hit||hit.events===undefined||hit.events===null)return[];
if(Array.isArray(hit.events))return hit.events;
if(typeof hit.events==="object")return Object.keys(hit.events);
return String(hit.events).split(",").map(v=>v.trim()).filter(Boolean);
}

function collectPageEvars(page){
const values={};

if(page.eVars&&typeof page.eVars==="object"){
Object.entries(page.eVars).forEach(([key,value])=>{
values[key]=unique(normalizeArray(value));
});
}

if(Array.isArray(page.adobeHits)){
page.adobeHits.forEach(hit=>{
Object.entries(getHitEvars(hit)).forEach(([key,value])=>{
if(!values[key])values[key]=[];
values[key].push(...normalizeArray(value));
values[key]=unique(values[key]);
});
});
}

return values;
}

function collectPageProps(page){
const values={};

if(page.props&&typeof page.props==="object"){
Object.entries(page.props).forEach(([key,value])=>{
values[key]=unique(normalizeArray(value));
});
}

if(Array.isArray(page.adobeHits)){
page.adobeHits.forEach(hit=>{
Object.entries(getHitProps(hit)).forEach(([key,value])=>{
if(!values[key])values[key]=[];
values[key].push(...normalizeArray(value));
values[key]=unique(values[key]);
});
});
}

return values;
}

function collectPageEvents(page){
const events=[];

if(Array.isArray(page.events))events.push(...page.events);
else if(page.events&&typeof page.events==="object")events.push(...Object.keys(page.events));

if(Array.isArray(page.adobeHits)){
page.adobeHits.forEach(hit=>{
events.push(...getHitEvents(hit));
});
}

return unique(events);
}

function collectGlobalEvars(results){
const values={};

if(results&&results.eVars&&typeof results.eVars==="object"){
Object.entries(results.eVars).forEach(([key,value])=>{
values[key]=unique(normalizeArray(value));
});
}

if(results&&Array.isArray(results.adobeHits)){
results.adobeHits.forEach(hit=>{
Object.entries(getHitEvars(hit)).forEach(([key,value])=>{
if(!values[key])values[key]=[];
values[key].push(...normalizeArray(value));
values[key]=unique(values[key]);
});
});
}

return values;
}

function collectGlobalProps(results){
const values={};

if(results&&results.props&&typeof results.props==="object"){
Object.entries(results.props).forEach(([key,value])=>{
values[key]=unique(normalizeArray(value));
});
}

if(results&&Array.isArray(results.adobeHits)){
results.adobeHits.forEach(hit=>{
Object.entries(getHitProps(hit)).forEach(([key,value])=>{
if(!values[key])values[key]=[];
values[key].push(...normalizeArray(value));
values[key]=unique(values[key]);
});
});
}

return values;
}

function collectGlobalEvents(results){
const events=[];

if(results&&Array.isArray(results.events))events.push(...results.events);
else if(results&&results.events&&typeof results.events==="object")events.push(...Object.keys(results.events));

if(results&&Array.isArray(results.adobeHits)){
results.adobeHits.forEach(hit=>{
events.push(...getHitEvents(hit));
});
}

return unique(events);
}

function getMatchingGlobalHits(page,results){
const pageUrl=getPageUrl(page);
const pageName=getPageName(page);
const globalHits=Array.isArray(results?.adobeHits)?results.adobeHits:[];

return globalHits.filter(hit=>{
const hitUrl=getHitUrl(hit);
const hitPageName=getHitPageName(hit);

return(
(pageUrl&&hitUrl===pageUrl)||
(pageName&&hitPageName===pageName)
);
});
}

function getPageEvarValues(page,results,key){
const values=[];
const pageValues=collectPageEvars(page);

if(Object.prototype.hasOwnProperty.call(pageValues,key)){
values.push(...pageValues[key]);
}

const matchingHits=getMatchingGlobalHits(page,results);

matchingHits.forEach(hit=>{
const hitValues=getHitEvars(hit);

if(Object.prototype.hasOwnProperty.call(hitValues,key)){
values.push(...normalizeArray(hitValues[key]));
}
});

return unique(values);
}

function getPagePropValues(page,results,key){
const values=[];
const pageValues=collectPageProps(page);

if(Object.prototype.hasOwnProperty.call(pageValues,key)){
values.push(...pageValues[key]);
}

const matchingHits=getMatchingGlobalHits(page,results);

matchingHits.forEach(hit=>{
const hitValues=getHitProps(hit);

if(Object.prototype.hasOwnProperty.call(hitValues,key)){
values.push(...normalizeArray(hitValues[key]));
}
});

return unique(values);
}

function getPageEventValues(page,results,event){
const events=collectPageEvents(page);

if(events.some(value=>String(value).toLowerCase()===String(event).toLowerCase())){
return true;
}

const matchingHits=getMatchingGlobalHits(page,results);

return matchingHits.some(hit=>{
return getHitEvents(hit).some(value=>{
return String(value).toLowerCase()===String(event).toLowerCase();
});
});
}

function getAllVariableKeys(pages,results,type){
const keys=new Set();

const globalValues=type==="eVar"
?collectGlobalEvars(results)
:collectGlobalProps(results);

Object.keys(globalValues).forEach(key=>keys.add(key));

pages.forEach(page=>{
const values=type==="eVar"
?collectPageEvars(page)
:collectPageProps(page);

Object.keys(values).forEach(key=>keys.add(key));

const matchingHits=getMatchingGlobalHits(page,results);

matchingHits.forEach(hit=>{
const hitValues=type==="eVar"
?getHitEvars(hit)
:getHitProps(hit);

Object.keys(hitValues).forEach(key=>keys.add(key));
});
});

return[...keys];
}

function getAllEventNames(pages,results){
const events=new Set();

collectGlobalEvents(results).forEach(event=>events.add(event));

pages.forEach(page=>{
collectPageEvents(page).forEach(event=>events.add(event));

getMatchingGlobalHits(page,results).forEach(hit=>{
getHitEvents(hit).forEach(event=>events.add(event));
});
});

return[...events];
}

function buildPageValidation(pages,results){
return pages.map((page,index)=>{
const pageUrl=getPageUrl(page);
const pageHits=Array.isArray(page.adobeHits)?page.adobeHits:[];
const matchingGlobalHits=getMatchingGlobalHits(page,results);

return{
srNo:index+1,
url:pageUrl,
adobePresent:getAdobePresent(page)||pageHits.length>0||matchingGlobalHits.length>0,
error:getPageError(page)
};
});
}

function buildVariableValidation(pages,results,type){
const keys=getAllVariableKeys(pages,results,type);
const rows=[];
let srNo=1;

pages.forEach(page=>{
const pageUrl=getPageUrl(page);

keys.forEach(key=>{
const values=type==="eVar"
?getPageEvarValues(page,results,key)
:getPagePropValues(page,results,key);

if(values.length){
rows.push({
srNo:srNo++,
key,
values,
populatedPages:[{
url:pageUrl,
values
}],
notPopulatedPages:[]
});
}else{
rows.push({
srNo:srNo++,
key,
values:[],
populatedPages:[],
notPopulatedPages:[{
url:pageUrl
}]
});
}
});
});

return rows;
}

function buildEventValidation(pages,results){
const events=getAllEventNames(pages,results);
const rows=[];
let srNo=1;

pages.forEach(page=>{
const pageUrl=getPageUrl(page);

events.forEach(event=>{
const populated=getPageEventValues(page,results,event);

if(populated){
rows.push({
srNo:srNo++,
event,
values:[],
populatedPages:[{
url:pageUrl
}],
notPopulatedPages:[]
});
}else{
rows.push({
srNo:srNo++,
event,
values:[],
populatedPages:[],
notPopulatedPages:[{
url:pageUrl
}]
});
}
});
});

return rows;
}

function extractCTARecords(page){
const records=[];

if(!Array.isArray(page.ctaValidations))return records;

page.ctaValidations.forEach(item=>{
const name=item.ctaName||item.label||item.name||item.eVar24||item.value||"";

const status=String(
item.status||item.validation||"NOT_VALIDATED"
).toUpperCase();

const event6=
item.event6===true||
String(item.event6).toLowerCase()==="yes";

const eVar24=
item.eVar24||
item.v24||
item.linkLocation||
"";

records.push({
name,
event6,
eVar24,
eVar24Present:String(eVar24).trim()!=="",
validation:status,
diagnostic:item.error||item.errorMessage||item.diagnostic||""
});
});

return records.filter(item=>String(item.name||"").trim());
}

function buildUniqueCTAValidation(pages){
const map=new Map;

pages.forEach(page=>{
const pageUrl=getPageUrl(page);
const pageName=getPageName(page);

extractCTARecords(page).forEach(cta=>{
const name=String(cta.name||"").trim();

if(!name)return;

const key=name.toLowerCase();

if(!map.has(key)){
map.set(key,{
ctaName:name,
occurrences:[],
pages:[],
failedPages:[],
notValidatedPages:[]
});
}

const item=map.get(key);

const passed=
cta.event6===true&&
cta.eVar24Present===true;

const notValidated=cta.validation==="NOT_VALIDATED";

item.occurrences.push({
url:pageUrl,
pageName,
passed,
event6:cta.event6,
eVar24:cta.eVar24,
eVar24Present:cta.eVar24Present,
notValidated,
diagnostic:cta.diagnostic||""
});

if(pageUrl&&!item.pages.includes(pageUrl)){
item.pages.push(pageUrl);
}

if(!passed){
if(notValidated){
if(!item.notValidatedPages.some(p=>p.url===pageUrl&&p.pageName===pageName)){
item.notValidatedPages.push({
url:pageUrl,
pageName,
diagnostic:cta.diagnostic||""
});
}
}else{
if(!item.failedPages.some(p=>p.url===pageUrl&&p.pageName===pageName)){
item.failedPages.push({
url:pageUrl,
pageName,
event6:cta.event6,
eVar24:cta.eVar24,
diagnostic:cta.diagnostic||""
});
}
}
}
});
});

return[...map.values()].map((item,index)=>{
const total=item.occurrences.length;
const passed=item.occurrences.filter(x=>x.passed).length;
const failed=item.occurrences.filter(x=>!x.passed&&!x.notValidated).length;
const notValidated=item.occurrences.filter(x=>x.notValidated).length;

const allPassed=total>0&&passed===total;

let status="FAIL";

if(allPassed)status="PASS";
else if(!failed&&notValidated)status="NOT VALIDATED";

let event6="No";

if(allPassed)event6="Yes";
else if(passed>0)event6="Yes / No";

const eVar24Values=unique(
item.occurrences
.map(x=>x.eVar24)
.filter(Boolean)
);

return{
srNo:index+1,
ctaName:item.ctaName,
pages:item.pages.map(url=>({url})),
event6,
eVar24:eVar24Values.join(", "),
status,
failedPages:item.failedPages,
notValidatedPages:item.notValidatedPages,
totalOccurrences:total,
passedOccurrences:passed,
failedOccurrences:failed,
notValidatedOccurrences:notValidated
};
});
}

function buildMarketingPixelValidation(pages){
const map=new Map;

pages.forEach(page=>{
const pageUrl=getPageUrl(page);
const pixels=Array.isArray(page.marketingPixels)?page.marketingPixels:[];

pixels.forEach(pixel=>{
if(!pixel)return;

const name=pixel.name||pixel.vendor||"";

if(!name)return;

const key=name.toLowerCase();

if(!map.has(key)){
map.set(key,{
name,
use:pixel.use||"Engagement",
pages:[],
errors:[]
});
}

const item=map.get(key);

if(pageUrl&&!item.pages.includes(pageUrl)){
item.pages.push(pageUrl);
}

if(pixel.error===true||pixel.errors===true){
item.errors.push(pageUrl);
}

if(pixel.use)item.use=pixel.use;
});
});

return[...map.values()].map((item,index)=>({
srNo:index+1,
name:item.name,
pageUrls:item.pages,
use:item.use,
error:item.errors.length>0,
errorPages:item.errors
}));
}

function statusBadge(status){
const value=String(status).toUpperCase();

if(value==="PASS"||value==="YES"){
return`<span class="badge badge-pass">✓ ${escapeHtml(status)}</span>`;
}

if(value==="FAIL"||value==="NO"){
return`<span class="badge badge-fail">✕ ${escapeHtml(status)}</span>`;
}

if(value==="NOT VALIDATED"){
return`<span class="badge badge-warning">! NOT VALIDATED</span>`;
}

return`<span class="badge badge-neutral">${escapeHtml(status)}</span>`;
}

function yesNoBadge(value){
return value===true||String(value).toLowerCase()==="yes"
?`<span class="badge badge-pass">✓ Yes</span>`
:`<span class="badge badge-fail">✕ No</span>`;
}

function pageListHtml(items){
if(!items||!items.length)return`<span class="muted">-</span>`;

return items.map(item=>{
if(typeof item==="string"){
return`<div class="list-item">${escapeHtml(item)}</div>`;
}

const url=item.url||item.pageUrl||"";
const values=item.values||[];

let html=`<div class="list-item">`;

if(url){
html+=`<div class="url-text">${escapeHtml(url)}</div>`;
}

if(values.length){
html+=`<div class="value-text">${escapeHtml(values.join(", "))}</div>`;
}

html+=`</div>`;

return html;
}).join("");
}

function pageUrlListHtml(items){
if(!items||!items.length)return`<span class="muted">-</span>`;

return items.map(item=>{
const url=typeof item==="string"
?item
:item.url||item.pageUrl||"";

return`<div class="list-item"><div class="url-text">${escapeHtml(url)}</div></div>`;
}).join("");
}

function buildHTML(results){
const pages=Array.isArray(results.pages)?results.pages:[];

const errors=Array.isArray(results.errors)?results.errors:[];

const totalPages=pages.length;

const pageValidation=buildPageValidation(pages,results);

const adobePages=pageValidation.filter(page=>page.adobePresent);

const adobeHits=Array.isArray(results.adobeHits)
?results.adobeHits.length
:pages.reduce((n,p)=>n+normalizeArray(p.adobeHits).length,0);

const marketingPixels=buildMarketingPixelValidation(pages);

const eVarValidation=buildVariableValidation(pages,results,"eVar");

const propValidation=buildVariableValidation(pages,results,"prop");

const eventValidation=buildEventValidation(pages,results);

const ctaValidation=buildUniqueCTAValidation(pages);

const passCTAs=ctaValidation.filter(x=>x.status==="PASS").length;
const failCTAs=ctaValidation.filter(x=>x.status==="FAIL").length;
const notValidatedCTAs=ctaValidation.filter(x=>x.status==="NOT VALIDATED").length;

const reportDate=new Date().toLocaleString();

let html=`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Adobe Website Analytics Scan Report</title>
<meta name="viewport" content="width=device-width,initial-scale=1.0">

<style>

*{
box-sizing:border-box;
}

body{
font-family:Inter,Segoe UI,Arial,Helvetica,sans-serif;
margin:0;
padding:0;
background:#f5f7fa;
color:#1f2937;
line-height:1.5;
}

.header{
background:linear-gradient(135deg,#111827,#374151);
color:#fff;
padding:32px 40px;
}

.header-inner{
max-width:1500px;
margin:0 auto;
}

.header h1{
margin:0;
font-size:30px;
font-weight:700;
letter-spacing:-.4px;
}

.header p{
margin:7px 0 0;
color:#d1d5db;
font-size:13px;
}

.container{
max-width:1500px;
margin:0 auto;
padding:28px 30px 50px;
}

.summary{
display:grid;
grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
gap:14px;
margin-bottom:28px;
}

.card{
background:#fff;
border:1px solid #e5e7eb;
border-radius:12px;
padding:18px 18px 16px;
box-shadow:0 2px 7px rgba(15,23,42,.05);
}

.card-title{
font-size:12px;
font-weight:600;
color:#6b7280;
text-transform:uppercase;
letter-spacing:.45px;
}

.card-value{
font-size:28px;
font-weight:700;
margin-top:6px;
color:#111827;
}

.card-sub{
font-size:11px;
color:#9ca3af;
margin-top:4px;
}

.section{
background:#fff;
border:1px solid #e5e7eb;
border-radius:12px;
margin-bottom:22px;
box-shadow:0 2px 7px rgba(15,23,42,.04);
overflow:hidden;
}

.section-header{
padding:18px 22px;
border-bottom:1px solid #e5e7eb;
background:#fafbfc;
}

.section-header h2{
margin:0;
font-size:18px;
font-weight:700;
color:#111827;
}

.section-header p{
margin:5px 0 0;
font-size:12px;
color:#6b7280;
}

.section-body{
padding:0;
}

.table-container{
overflow:auto;
max-height:620px;
}

table{
width:100%;
border-collapse:separate;
border-spacing:0;
}

th{
position:sticky;
top:0;
z-index:2;
background:#374151;
color:#fff;
padding:12px 13px;
text-align:left;
font-size:11px;
font-weight:700;
text-transform:uppercase;
letter-spacing:.35px;
white-space:nowrap;
}

td{
padding:12px 13px;
border-bottom:1px solid #edf0f3;
vertical-align:top;
font-size:12px;
color:#374151;
}

tbody tr:hover{
background:#f8fafc;
}

tbody tr:last-child td{
border-bottom:none;
}

tbody tr:nth-child(even){
background:#fcfcfd;
}

tbody tr:nth-child(even):hover{
background:#f8fafc;
}

.number{
width:60px;
text-align:center;
color:#6b7280;
}

.key-cell{
font-weight:700;
color:#111827;
white-space:nowrap;
}

.url-cell{
min-width:280px;
max-width:450px;
}

.url-text{
word-break:break-word;
color:#374151;
}

.value-text{
margin-top:5px;
font-size:11px;
color:#6b7280;
background:#f3f4f6;
border-radius:5px;
padding:4px 6px;
word-break:break-word;
}

.value-cell{
min-width:220px;
max-width:450px;
word-break:break-word;
}

.count-cell{
white-space:nowrap;
font-weight:600;
color:#374151;
}

.badge{
display:inline-flex;
align-items:center;
gap:4px;
padding:4px 9px;
border-radius:999px;
font-size:10px;
font-weight:700;
white-space:nowrap;
}

.badge-pass{
background:#dcfce7;
color:#166534;
}

.badge-fail{
background:#fee2e2;
color:#991b1b;
}

.badge-warning{
background:#fef3c7;
color:#92400e;
}

.badge-neutral{
background:#e5e7eb;
color:#374151;
}

.muted{
color:#9ca3af;
}

.list-item{
margin-bottom:6px;
}

.list-item:last-child{
margin-bottom:0;
}

.cta-name{
font-weight:700;
color:#111827;
}

.cta-details{
margin-top:4px;
font-size:10px;
color:#9ca3af;
}

.failed{
color:#991b1b;
font-size:11px;
line-height:1.6;
word-break:break-word;
}

.info-box{
margin:16px 22px;
padding:12px 14px;
border-radius:8px;
background:#eff6ff;
border:1px solid #dbeafe;
color:#1e40af;
font-size:12px;
}

.warning-box{
margin:16px 22px;
padding:12px 14px;
border-radius:8px;
background:#fffbeb;
border:1px solid #fde68a;
color:#92400e;
font-size:12px;
}

.empty{
padding:28px;
text-align:center;
color:#9ca3af;
font-size:13px;
}

.cta-summary{
display:flex;
gap:10px;
flex-wrap:wrap;
margin:0 22px 16px;
}

.mini-stat{
padding:7px 11px;
border-radius:7px;
background:#f3f4f6;
font-size:11px;
color:#4b5563;
}

.mini-stat strong{
color:#111827;
}

.footer{
max-width:1500px;
margin:0 auto;
padding:0 30px 30px;
text-align:center;
color:#9ca3af;
font-size:11px;
}

@media(max-width:800px){

.container{
padding:18px 12px 35px;
}

.header{
padding:25px 18px;
}

.header h1{
font-size:24px;
}

.card-value{
font-size:24px;
}

th,td{
padding:10px;
}

}

</style>
</head>

<body>

<div class="header">
<div class="header-inner">
<h1>Adobe Website Analytics Scanner</h1>
<p>Generated: ${escapeHtml(reportDate)}</p>
</div>
</div>

<div class="container">

<div class="summary">

<div class="card">
<div class="card-title">Total Pages</div>
<div class="card-value">${totalPages}</div>
<div class="card-sub">Pages scanned</div>
</div>

<div class="card">
<div class="card-title">Adobe Pages</div>
<div class="card-value">${adobePages.length}</div>
<div class="card-sub">Pages with Adobe tracking</div>
</div>

<div class="card">
<div class="card-title">Adobe Hits</div>
<div class="card-value">${adobeHits}</div>
<div class="card-sub">Captured /b/ss hits</div>
</div>

<div class="card">
<div class="card-title">eVars</div>
<div class="card-value">${eVarValidation.length}</div>
<div class="card-sub">Page-level validations</div>
</div>

<div class="card">
<div class="card-title">Props</div>
<div class="card-value">${propValidation.length}</div>
<div class="card-sub">Page-level validations</div>
</div>

<div class="card">
<div class="card-title">Events</div>
<div class="card-value">${eventValidation.length}</div>
<div class="card-sub">Page-level validations</div>
</div>

<div class="card">
<div class="card-title">Unique CTAs</div>
<div class="card-value">${ctaValidation.length}</div>
<div class="card-sub">Unique CTA names</div>
</div>

<div class="card">
<div class="card-title">Marketing Vendors</div>
<div class="card-value">${marketingPixels.length}</div>
<div class="card-sub">Third-party pixels</div>
</div>

<div class="card">
<div class="card-title">Errors</div>
<div class="card-value">${errors.length}</div>
<div class="card-sub">Crawler errors</div>
</div>

</div>

<div class="section">

<div class="section-header">
<h2>Page Validation</h2>
<p>Adobe tracking presence and page-level crawler errors.</p>
</div>

<div class="section-body">

<div class="table-container">

<table>

<thead>
<tr>
<th>#</th>
<th>Page URL</th>
<th>Adobe Tracking</th>
<th>Page Error</th>
</tr>
</thead>

<tbody>`;

if(pageValidation.length){

pageValidation.forEach(row=>{
html+=`<tr>
<td class="number">${row.srNo}</td>
<td class="url-cell"><div class="url-text">${escapeHtml(row.url)}</div></td>
<td>${yesNoBadge(row.adobePresent)}</td>
<td>${row.error?'<span class="badge badge-fail">✕ Error</span>':'<span class="badge badge-pass">✓ No Error</span>'}</td>
</tr>`;
});

}else{

html+=`<tr><td colspan="4" class="empty">No page validation data was captured.</td></tr>`;

}

html+=`</tbody>
</table>

</div>
</div>
</div>

<div class="section">

<div class="section-header">
<h2>Adobe eVar Validation</h2>
<p>Each eVar is checked independently against each scanned page URL.</p>
</div>

<div class="section-body">`;

if(eVarValidation.length){

html+=`<div class="table-container">
<table>
<thead>
<tr>
<th>#</th>
<th>eVar Value</th>
<th>Adobe Event/eVar/prop</th>
<th>Event populated on page URL</th>
<th>Event not populated on page URL</th>
</tr>
</thead>
<tbody>`;

eVarValidation.forEach(row=>{
html+=`<tr>
<td class="number">${row.srNo}</td>
<td class="value-cell">${row.values.length?`<div class="value-text">${escapeHtml(row.values.join(", "))}</div>`:`<span class="muted">-</span>`}</td>
<td class="key-cell">${escapeHtml(row.key)}</td>
<td class="url-cell">${pageUrlListHtml(row.populatedPages)}</td>
<td class="url-cell">${pageUrlListHtml(row.notPopulatedPages)}</td>
</tr>`;
});

html+=`</tbody>
</table>
</div>`;

}else{

html+=`<div class="empty">No Adobe eVar data was captured.</div>`;

}

html+=`</div>
</div>

<div class="section">

<div class="section-header">
<h2>Adobe Prop Validation</h2>
<p>Each prop is checked independently against each scanned page URL.</p>
</div>

<div class="section-body">`;

if(propValidation.length){

html+=`<div class="table-container">
<table>
<thead>
<tr>
<th>#</th>
<th>eVar Value</th>
<th>Adobe Event/eVar/prop</th>
<th>Event populated on page URL</th>
<th>Event not populated on page URL</th>
</tr>
</thead>
<tbody>`;

propValidation.forEach(row=>{
html+=`<tr>
<td class="number">${row.srNo}</td>
<td class="value-cell">${row.values.length?`<div class="value-text">${escapeHtml(row.values.join(", "))}</div>`:`<span class="muted">-</span>`}</td>
<td class="key-cell">${escapeHtml(row.key)}</td>
<td class="url-cell">${pageUrlListHtml(row.populatedPages)}</td>
<td class="url-cell">${pageUrlListHtml(row.notPopulatedPages)}</td>
</tr>`;
});

html+=`</tbody>
</table>
</div>`;

}else{

html+=`<div class="empty">No Adobe prop data was captured.</div>`;

}

html+=`</div>
</div>

<div class="section">

<div class="section-header">
<h2>Adobe Event Validation</h2>
<p>Each event is checked independently against each scanned page URL.</p>
</div>

<div class="section-body">`;

if(eventValidation.length){

html+=`<div class="table-container">
<table>
<thead>
<tr>
<th>#</th>
<th>eVar Value</th>
<th>Adobe Event/eVar/prop</th>
<th>Event populated on page URL</th>
<th>Event not populated on page URL</th>
</tr>
</thead>
<tbody>`;

eventValidation.forEach(row=>{
html+=`<tr>
<td class="number">${row.srNo}</td>
<td class="value-cell"><span class="muted">-</span></td>
<td class="key-cell">${escapeHtml(row.event)}</td>
<td class="url-cell">${pageUrlListHtml(row.populatedPages)}</td>
<td class="url-cell">${pageUrlListHtml(row.notPopulatedPages)}</td>
</tr>`;
});

html+=`</tbody>
</table>
</div>`;

}else{

html+=`<div class="empty">No Adobe event data was captured.</div>`;

}

html+=`</div>
</div>

<div class="section">

<div class="section-header">
<h2>CTA Validation</h2>
<p>Unique CTA validation across the scanned site.</p>
</div>

<div class="info-box">
<strong>PASS criteria:</strong> the CTA must generate Adobe <strong>/b/ss</strong> traffic containing <strong>event6</strong> and a populated <strong>eVar24/v24</strong>. These two values do not need to be present in the same Adobe hit.
</div>

<div class="cta-summary">
<div class="mini-stat">Total: <strong>${ctaValidation.length}</strong></div>
<div class="mini-stat">PASS: <strong>${passCTAs}</strong></div>
<div class="mini-stat">FAIL: <strong>${failCTAs}</strong></div>
<div class="mini-stat">Not Validated: <strong>${notValidatedCTAs}</strong></div>
</div>

<div class="section-body">`;

if(ctaValidation.length){

html+=`<div class="table-container">
<table>
<thead>
<tr>
<th>#</th>
<th>CTA Name</th>
<th>Pages</th>
<th>event6</th>
<th>eVar24 / v24</th>
<th>Result</th>
<th>Failure Details</th>
</tr>
</thead>
<tbody>`;

ctaValidation.forEach(row=>{

const failed=[
...(row.failedPages||[]).map(p=>{
const details=[];

if(p.url)details.push(p.url);

if(p.event6===false){
details.push("event6 missing");
}

if(!p.eVar24){
details.push("eVar24/v24 missing");
}

if(p.diagnostic){
details.push(p.diagnostic);
}

return details.join(" — ");
}),
...(row.notValidatedPages||[]).map(p=>{
return`${p.url||p.pageUrl||""} — NOT VALIDATED${p.diagnostic?" — "+p.diagnostic:""}`;
})
];

html+=`<tr>

<td class="number">${row.srNo}</td>

<td>
<div class="cta-name">${escapeHtml(row.ctaName)}</div>
<div class="cta-details">${row.totalOccurrences} occurrence${row.totalOccurrences===1?"":"s"} checked</div>
</td>

<td class="url-cell">
${pageListHtml(row.pages)}
</td>

<td>
${statusBadge(row.event6)}
</td>

<td class="value-cell">
${row.eVar24
?`<span class="value-text">${escapeHtml(row.eVar24)}</span>`
:`<span class="muted">-</span>`}
</td>

<td>
${statusBadge(row.status)}
</td>

<td class="failed">
${failed.length?escapeHtml(failed.join(" | ")):"—"}
</td>

</tr>`;
});

html+=`</tbody>
</table>
</div>`;

}else{

html+=`<div class="empty">No CTA validation data was captured.</div>`;

}

html+=`</div>
</div>

<div class="section">

<div class="section-header">
<h2>Third-Party Marketing Pixels</h2>
<p>Third-party marketing and analytics vendors detected during crawling.</p>
</div>

<div class="section-body">`;

if(marketingPixels.length){

html+=`<div class="table-container">
<table>
<thead>
<tr>
<th>#</th>
<th>Marketing Pixel</th>
<th>Page URL</th>
<th>Use</th>
<th>Error</th>
</tr>
</thead>
<tbody>`;

marketingPixels.forEach(row=>{
html+=`<tr>
<td class="number">${row.srNo}</td>
<td class="key-cell">${escapeHtml(row.name)}</td>
<td class="url-cell">${escapeHtml(row.pageUrls.join(", "))}</td>
<td>${escapeHtml(row.use)}</td>
<td>${row.error
?'<span class="badge badge-fail">✕ Yes</span>'
:'<span class="badge badge-pass">✓ No</span>'}</td>
</tr>`;
});

html+=`</tbody>
</table>
</div>`;

}else{

html+=`<div class="empty">No third-party marketing pixels detected.</div>`;

}

html+=`</div>
</div>

</div>

<div class="footer">
Adobe Website Analytics Scanner
</div>

</body>
</html>`;

return html;
}

async function generateHTML(results,outputDirectory){
if(!results)throw new Error("Scan results are required to generate the report.");

if(!outputDirectory){
outputDirectory=path.join(__dirname,"output");
}

if(!fs.existsSync(outputDirectory)){
fs.mkdirSync(outputDirectory,{recursive:true});
}

const outputPath=path.join(outputDirectory,"adobeScanReport.html");

fs.writeFileSync(
outputPath,
buildHTML(results),
"utf8"
);

return outputPath;
}

async function generate(results,outputDirectory){
return generateHTML(results,outputDirectory);
}

module.exports={
generateHTML,
generate
};