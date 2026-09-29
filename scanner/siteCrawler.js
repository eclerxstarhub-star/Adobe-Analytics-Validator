const{Builder,By,until}=require("selenium-webdriver"),chrome=require("selenium-webdriver/chrome");

class SiteCrawler{
constructor(options={}){
this.driver=null;
this.logger=options.logger||(()=>{});
this.onProgress=options.onProgress||(()=>{});
this.currentPageUrl="";
this.currentPageName="";
this.currentStep="Starting crawl";
this.currentAction="";
this.currentCTA="";
this.maxPages=options.maxPages||25;
this.maxAdobeWait=options.maxAdobeWait||30000;
this.postAdobeWait=options.postAdobeWait||2000;
this.ctaClickWait=options.ctaClickWait||15000;
this.ctaPollInterval=options.ctaPollInterval||250;
this.validations={pageLoad:true,eVars:true,props:true,events:true,products:true,cta:true,...(options.validations||{})};
this.results={pages:[],adobePages:[],adobeHits:[],marketingPixels:[],errors:[],eVars:{},props:{},events:{},reportSuites:{},ctaValidations:[],totalNetworkRequests:0};
this.visited=new Set;
this.queue=[];
}

log(level,message){try{this.logger(level,String(message))}catch(e){}}
progress(){try{this.onProgress()}catch(e){}}

async createDriver(){
const options=new chrome.Options;
options.setPageLoadStrategy("eager");
options.addArguments("--headless=new","--disable-gpu","--disable-software-rasterizer","--no-sandbox","--disable-dev-shm-usage","--disable-notifications","--disable-popup-blocking","--window-size=1920,1080","--blink-settings=imagesEnabled=false");
options.setLoggingPrefs({performance:"ALL"});
options.setPerfLoggingPrefs({enableNetwork:true,enablePage:true});
this.driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
try{
await this.driver.manage().setTimeouts({pageLoad:90000,script:10000});
}catch(e){
this.log("WARN",`Unable to configure WebDriver timeouts: ${e.message||e}`);
}
try{
await this.driver.sendDevToolsCommand("Network.enable",{});
await this.driver.sendDevToolsCommand("Network.setBlockedURLs",{urls:["*.png","*.jpg","*.jpeg","*.gif","*.webp","*.avif","*.mp4","*.webm"]});
}catch(e){
this.log("WARN",`Unable to configure Chrome network controls: ${e.message||e}`);
}
return this.driver;
}

async quitDriver(){
if(this.driver)try{await this.driver.quit()}catch(e){}finally{this.driver=null}
}

normalizeUrl(url){
if(!url)return"";
try{const u=new URL(url);u.hash="";return u.toString().replace(/\/$/,"")}catch(e){return String(url).split("#")[0].replace(/\/$/,"")}
}

normalizeText(value){
return String(value||"").replace(/\s+/g," ").trim().toLowerCase();
}

normalizeHref(value){
if(!value)return"";
try{
const u=new URL(value,this.currentPageUrl||undefined);
u.hash="";
return u.toString().replace(/\/$/,"").toLowerCase();
}catch(e){
return String(value).trim().replace(/\/$/,"").toLowerCase();
}
}

getHrefPath(value){
if(!value)return"";
try{
return new URL(value,this.currentPageUrl||undefined).pathname.replace(/\/$/,"").toLowerCase();
}catch(e){
return String(value).split("?")[0].split("#")[0].replace(/\/$/,"").toLowerCase();
}
}

isSameDomain(url,baseUrl){
try{return new URL(url).hostname===new URL(baseUrl).hostname}catch(e){return false}
}

isValidPageUrl(url){
if(!url)return false;
try{
const u=new URL(url),p=u.pathname.toLowerCase();
return/^https?:$/.test(u.protocol)&&!p.startsWith("/api/")&&!p.includes("/api")&&!/\.(pdf|jpg|jpeg|png|gif|svg|css|js|json|xml|zip)$/i.test(p)
}catch(e){return false}
}

isCheckoutSuccessUrl(url){
if(!url)return false;
try{return new URL(url).pathname.toLowerCase().startsWith("/personal/checkout-success")}catch(e){return false}
}

async getPerformanceLogs(){
if(!this.driver)return[];
try{
return await this.driver.manage().logs().get("performance");
}catch(e){
this.log("ERROR",`Chrome performance logs unavailable: ${e.message||e}`);
return[];
}
}

async clearPerformanceLogs(){
try{await this.getPerformanceLogs()}catch(e){}
}

parsePerformanceLog(entry){
try{
const outer=JSON.parse(entry.message);
return outer&&outer.message?outer.message:null
}catch(e){return null}
}

isAdobeRequest(url){
return!!url&&/\/b\/ss(?:\/|[?#]|$)/i.test(url)
}

extractAdobeData(url,postData="",requestId=""){
if(!this.isAdobeRequest(url))return null;
try{
const parsed=new URL(url),params=new URLSearchParams(parsed.search||"");

if(postData)try{
const body=new URLSearchParams(postData);
for(const[k,v]of body.entries())params.set(k,v)
}catch(e){}

const suiteMatch=parsed.pathname.match(/\/b\/ss\/([^/?]+)/i),reportSuite=suiteMatch?decodeURIComponent(suiteMatch[1]):"";
const pageName=params.get("pageName")||params.get("gn")||"",products=params.get("products")||"",eventsRaw=params.get("events")||"",eVars={},props={},events={};
const linkType=params.get("pe")||"",linkName=params.get("pev2")||"",linkText=params.get("link")||"";
const g=params.get("g")||"",ch=params.get("ch")||"",server=params.get("server")||"";

for(const[key,value]of params.entries()){
if(/^v\d+$/i.test(key)){eVars[key]=value;this.results.eVars[key]=value}
else if(/^c\d+$/i.test(key)){props[key]=value;this.results.props[key]=value}
else if(/^event\d+$/i.test(key)){events[key]=value;this.results.events[key]=value}
}

if(eventsRaw)for(const event of eventsRaw.split(",")){
const name=event.trim();
if(name){events[name]=true;this.results.events[name]=true}
}

if(reportSuite)this.results.reportSuites[reportSuite]=(this.results.reportSuites[reportSuite]||0)+1;

const hit={url,requestId,reportSuite,pageName,products,events,eVars,props,g,ch,server,pe:linkType,pev2:linkName,link:linkText,timestamp:new Date().toISOString()};

const hitKey=[requestId||"",url,JSON.stringify(eVars),JSON.stringify(props),JSON.stringify(events),pageName,products,linkType,linkName,linkText].join("|");

if(!this.results.adobeHits.some(existing=>existing._key===hitKey)){
hit._key=hitKey;
this.results.adobeHits.push(hit)
}

if(pageName&&!this.results.adobePages.some(item=>item.requestId===requestId&&item.url===url)){
this.results.adobePages.push({pageName,url,reportSuite,requestId})
}

return hit;
}catch(e){
this.log("WARN",`Unable to parse Adobe request: ${e.message||e}`);
return null
}
}

identifyMarketingPixel(url){
if(!url)return null;

const signatures=[
{name:"Meta",match:/facebook\.com\/tr|connect\.facebook\.net/i},
{name:"Google Analytics",match:/google-analytics\.com|googletagmanager\.com/i},
{name:"Google Ads",match:/googleadservices\.com|doubleclick\.net/i},
{name:"Pinterest",match:/pinimg\.com|pinterest\.com/i},
{name:"TikTok",match:/analytics\.tiktok\.com|tiktok\.com/i},
{name:"LinkedIn",match:/linkedin\.com\/insight/i},
{name:"Microsoft",match:/bat\.bing\.com/i},
{name:"Amazon",match:/amazon-adsystem\.com/i}
];

const found=signatures.find(s=>s.match.test(url));
return found?found.name:null;
}

async collectNetworkData(){
const logs=await this.getPerformanceLogs(),hits=[];

for(const entry of logs){
const message=this.parsePerformanceLog(entry);
if(!message||message.method!=="Network.requestWillBeSent")continue;

const params=message.params||{},request=params.request||{};
if(!request.url)continue;

this.results.totalNetworkRequests++;

const pixel=this.identifyMarketingPixel(request.url);

if(pixel)this.results.marketingPixels.push({
name:pixel,
vendor:pixel,
url:request.url,
timestamp:new Date().toISOString()
});

if(this.isAdobeRequest(request.url)){
const hit=this.extractAdobeData(request.url,request.postData||"",params.requestId||"");
if(hit)hits.push(hit);
}
}

return hits;
}

async captureAdobeHits(timeout=this.maxAdobeWait){
const start=Date.now(),hits=[],seen=new Set;

while(Date.now()-start<timeout){
const current=await this.collectNetworkData();

for(const hit of current){
const key=hit.requestId||hit._key||`${hit.url}|${hit.timestamp}`;

if(!seen.has(key)){
seen.add(key);
hits.push(hit);
}
}

if(hits.length)return hits;

await new Promise(r=>setTimeout(r,this.ctaPollInterval));
}

return hits;
}

async waitForAdobeHit(timeout=this.maxAdobeWait){
return await this.captureAdobeHits(timeout)
}

async waitForPageComplete(timeout=15000,hitSink=null){
if(!this.driver)return false;

const start=Date.now();

while(Date.now()-start<timeout){
try{
const captured=await this.collectNetworkData();
if(Array.isArray(hitSink)&&captured.length)hitSink.push(...captured);
}catch(e){}

try{
const readyState=await this.driver.executeScript("return document.readyState");

if(readyState==="complete"||readyState==="interactive")return true;
}catch(e){}

await new Promise(r=>setTimeout(r,250));
}

return false;
}

async waitForDynamicContent(timeout=10000,hitSink=null){
if(!this.driver)return;

const start=Date.now();

while(Date.now()-start<timeout){
try{
const captured=await this.collectNetworkData();
if(Array.isArray(hitSink)&&captured.length)hitSink.push(...captured);
}catch(e){}

try{
const count=await this.driver.executeScript(()=>{
return document.querySelectorAll("a,button,input[type='button'],input[type='submit'],[role='button']").length
});

if(count>0)return;
}catch(e){}

await new Promise(r=>setTimeout(r,250));
}
}

async getPageNameFromDom(){
if(!this.driver)return"";

try{
return await this.driver.executeScript(()=>{
try{
if(window.digitalData){
if(window.digitalData.page&&window.digitalData.page.pageInfo)return window.digitalData.page.pageInfo.pageName||window.digitalData.page.pageInfo.page_name||"";
if(window.digitalData.pageName)return window.digitalData.pageName;
}

if(Array.isArray(window.dataLayer))for(let i=window.dataLayer.length-1;i>=0;i--){
const item=window.dataLayer[i];

if(item&&typeof item==="object"){
if(item.pageName)return item.pageName;
if(item.page&&item.page.pageName)return item.page.pageName;
}
}

if(Array.isArray(window.adobeDataLayer))for(let i=window.adobeDataLayer.length-1;i>=0;i--){
const item=window.adobeDataLayer[i];

if(item&&typeof item==="object"){
if(item.pageName)return item.pageName;
if(item.eventInfo&&item.eventInfo.pageName)return item.eventInfo.pageName;
}
}
}catch(e){}

return"";
})
}catch(e){
this.log("WARN",`Unable to read pageName from DOM: ${e.message||e}`);
return"";
}
}

async getPageLinks(baseUrl){
if(!this.driver)return[];

const links=await this.driver.findElements(By.css("a[href]")),urls=[];

for(const link of links)try{
const href=await link.getAttribute("href");
if(!href)continue;

const absolute=new URL(href,baseUrl).toString(),normalized=this.normalizeUrl(absolute);

if(this.isSameDomain(normalized,baseUrl)&&this.isValidPageUrl(normalized))urls.push(normalized);
}catch(e){}

return[...new Set(urls)];
}

isStructuralCTA(label,id,className,tagName,href){
const value=`${label} ${id} ${className}`.toLowerCase().trim();

if(!label)return true;
if(/^b\d+[-_]/i.test(label)&&!/\s/.test(label))return true;
if(/applicationtitlewrapper|applicationtitle|carousel|slick-|swiper-|owl-|pagination|breadcrumb/i.test(value))return true;
if(/^(previous item|next item|toggle the menu|carousel previous|carousel next)$/i.test(label))return true;
if(/^(previous|next)$/i.test(label)&&!href)return true;
if(tagName==="button"&&!href&&/^(menu|open menu|close menu)$/i.test(label))return true;

return false;
}

async getCTAs(){
if(!this.driver)return[];

const selectors=["a","button","input[type='button']","input[type='submit']","[role='button']"];
const elements=await this.driver.findElements(By.css(selectors.join(",")));
const ctas=[];
const seenMeaningful=new Set;

let detected=0,skipped=0;

for(let index=0;index<elements.length;index++){
const element=elements[index];

try{
if(!(await element.isDisplayed())||!(await element.isEnabled())){
skipped++;
continue;
}

const tagName=(await element.getTagName()).toLowerCase();
const text=((await element.getText())||"").trim();
const ariaLabel=((await element.getAttribute("aria-label"))||"").trim();
const title=((await element.getAttribute("title"))||"").trim();
const name=((await element.getAttribute("name"))||"").trim();
const id=((await element.getAttribute("id"))||"").trim();
const href=((await element.getAttribute("href"))||"").trim();
const className=((await element.getAttribute("class"))||"").trim();
const label=text||ariaLabel||title||name;

detected++;

if(!label||this.isStructuralCTA(label,id,className,tagName,href)){
skipped++;
continue;
}

const fingerprint=[
this.normalizeText(label),
this.getHrefPath(href)
].join("|");

if(seenMeaningful.has(fingerprint))continue;

seenMeaningful.add(fingerprint);

ctas.push({
index,
tagName,
text,
ariaLabel,
title,
name,
id,
href,
className,
label,
fingerprint
});

}catch(e){}
}

this.log("INFO",`CTA elements detected: ${detected}`);
this.log("INFO",`Unique CTA candidates found: ${ctas.length}`);

if(skipped)this.log("INFO",`Structural/hidden CTA elements skipped: ${skipped}`);

return ctas;
}

normalizeAdobeEvent(eventName){
return String(eventName || "").trim().toLowerCase().replace(/^event/, "");
}

isEvent6(eventName){
return this.normalizeAdobeEvent(eventName) === "6";
}

hitHasEvent6(hit){
return !!(hit && hit.events) && Object.keys(hit.events).some(name => this.isEvent6(name));
}

getHitEVar24(hit){
return hit && hit.eVars ? hit.eVars.v24 || hit.eVars.V24 || "" : "";
}

isCTAAdobeHit(hit){
if(!hit) return false;

const pe = String(hit.pe || "").toLowerCase();
const pev2 = String(hit.pev2 || "").toLowerCase();

return pe === "lnk_o" || pev2 === "cta click";
}

async preparePageForCTAClick(pageUrl, ctaLabel = ""){
this.currentAction = `Reloading page for CTA: ${ctaLabel || "CTA"}`;
this.progress();

await this.clearPerformanceLogs();

try{
await this.driver.get(pageUrl);
}catch(error){
this.log("ERROR", `Page reload failed for CTA ${ctaLabel || "CTA"}: ${error.message || error}`);
throw error;
}

this.currentPageUrl = this.normalizeUrl(await this.driver.getCurrentUrl());

await this.driver.wait(
until.elementLocated(By.css("body")),
15000
).catch(() => {});

const pageComplete = await this.waitForPageComplete(30000);

if(!pageComplete){
this.log(
"WARN",
`Page did not reach document.readyState=complete within timeout: ${pageUrl}`
);
}

await this.waitForDynamicContent(10000);

await new Promise(r => setTimeout(r, this.postAdobeWait));

await this.clearPerformanceLogs();

await new Promise(r => setTimeout(r, 300));
}

async findCTAElement(cta){
if(!this.driver)return null;

const selectors="a,button,input[type='button'],input[type='submit'],[role='button']";
const targetLabel=this.normalizeText(cta.label||cta.text||cta.ariaLabel||cta.title||cta.name);
const targetText=this.normalizeText(cta.text);
const targetAria=this.normalizeText(cta.ariaLabel);
const targetTitle=this.normalizeText(cta.title);
const targetName=this.normalizeText(cta.name);
const targetHref=this.normalizeHref(cta.href);
const targetPath=this.getHrefPath(cta.href);

for(let attempt=0;attempt<20;attempt++){

try{

const elements=await this.driver.findElements(By.css(selectors));

const candidateIndex=await this.driver.executeScript((selector,targetLabel,targetText,targetAria,targetTitle,targetName,targetHref,targetPath)=>{
const normalize=value=>String(value||"").replace(/\s+/g," ").trim().toLowerCase();

const normalizeHref=value=>{
if(!value)return"";

try{
const u=new URL(value,window.location.href);
u.hash="";
return u.toString().replace(/\/$/,"").toLowerCase();
}catch(e){
return normalize(value).replace(/\/$/,"");
}
};

const getPath=value=>{
if(!value)return"";

try{
return new URL(value,window.location.href).pathname.replace(/\/$/,"").toLowerCase();
}catch(e){
return String(value).split("?")[0].split("#")[0].replace(/\/$/,"").toLowerCase();
}
};

const elements=[...document.querySelectorAll(selector)];
let bestIndex=-1;
let bestScore=0;

for(let i=0;i<elements.length;i++){
const el=elements[i];

try{
const style=window.getComputedStyle(el);
const rect=el.getBoundingClientRect();

if(style.display==="none"||style.visibility==="hidden"||parseFloat(style.opacity||"1")===0||rect.width===0||rect.height===0)continue;

const text=normalize(el.innerText||el.textContent||"");
const aria=normalize(el.getAttribute("aria-label"));
const title=normalize(el.getAttribute("title"));
const name=normalize(el.getAttribute("name"));
const href=normalizeHref(el.getAttribute("href"));
const path=getPath(el.getAttribute("href"));
const label=text||aria||title||name;

let score=0;

if(targetLabel&&label===targetLabel)score+=100;
if(targetText&&text===targetText)score+=80;
if(targetAria&&aria===targetAria)score+=70;
if(targetTitle&&title===targetTitle)score+=60;
if(targetName&&name===targetName)score+=50;
if(targetHref&&href===targetHref)score+=40;
if(targetPath&&path===targetPath)score+=30;

if(targetLabel&&label===targetLabel&&targetPath&&path===targetPath)score+=100;
if(targetText&&text===targetText&&targetPath&&path===targetPath)score+=80;

if(score>bestScore){
bestScore=score;
bestIndex=i;
}

}catch(e){}
}

return bestScore>=50?bestIndex:-1;

},selectors,targetLabel,targetText,targetAria,targetTitle,targetName,targetHref,targetPath);

if(typeof candidateIndex==="number"&&candidateIndex>=0&&elements[candidateIndex]){

try{
if(await elements[candidateIndex].isDisplayed()&&await elements[candidateIndex].isEnabled()){
this.log(
"INFO",
`CTA found after reload: ${cta.label||cta.text||"CTA"}`
);
return elements[candidateIndex];
}
}catch(e){}
}

}catch(e){}

await new Promise(r=>setTimeout(r,500));
}

this.log(
"WARN",
`CTA not found in refreshed DOM: ${cta.label||cta.text||"CTA"}`
);

return null;
}

async collectCTAAdobeHits(){
const start=Date.now(),hits=[],seen=new Set;

while(Date.now()-start<this.ctaClickWait){

const current=await this.collectNetworkData();

for(const hit of current){

const key=hit.requestId||hit._key||`${hit.url}|${hit.pageName}|${JSON.stringify(hit.eVars)}|${JSON.stringify(hit.events)}|${hit.timestamp}`;

if(!seen.has(key)){
seen.add(key);
hits.push(hit);
}
}

await new Promise(r=>setTimeout(r,this.ctaPollInterval));
}

return hits;
}

async validateCTAs(pageUrl,pageName,ctas){
const list=Array.isArray(ctas)?ctas:[];
const validations=[];

this.log("INFO",`Validating ${list.length} unique CTA(s) on page.`);

for(let i=0;i<list.length;i++){

const cta=list[i];

this.currentCTA=cta.label||cta.text||"CTA";

const validation={
pageUrl,
pageName,
ctaName:cta.label,
label:cta.label,
text:cta.text,
href:cta.href,
status:"NOT_VALIDATED",
validation:"NOT_VALIDATED",
event6:false,
eVar24:"",
adobeHit:null,
adobeHitCount:0,
ctaAdobeHitCount:0,
event6Hit:false,
eVar24Hit:false,
ctaAdobeHits:[],
error:""
};

this.log("INFO",`CTA ${i+1}/${list.length}: ${validation.ctaName}`);

try{

/*
 * 1. Reload the PAGE before this CTA.
 * This is the only reload between CTA validations.
 */
await this.preparePageForCTAClick(pageUrl,validation.ctaName);

/*
 * 2. Find the CTA in the NEW DOM.
 */
this.currentAction=`Finding CTA ${i+1} of ${list.length}`;
this.progress();

const element=await this.findCTAElement(cta);

if(!element){

validation.status="FAIL";
validation.validation="ELEMENT_NOT_FOUND";
validation.error=`CTA element was not found after page reload. Page URL: ${pageUrl}`;

this.log(
"ERROR",
`CTA failed: ${validation.ctaName} - ${validation.error}`
);

validations.push(validation);
continue;
}

/*
 * 3. Scroll CTA into view.
 */
await this.driver.executeScript(
"arguments[0].scrollIntoView({block:'center',inline:'center'});",
element
);

await new Promise(r=>setTimeout(r,500));

/*
 * 4. Clear network logs immediately before CLICK.
 */
await this.clearPerformanceLogs();

/*
 * 5. CLICK CTA.
 */
this.currentAction=`Clicking CTA ${i+1} of ${list.length}`;
this.progress();

try{
/* Use JS click so navigation does not block network-log capture. */
await this.driver.executeScript("arguments[0].click();",element);
}catch(clickError){
this.log(
"WARN",
`JavaScript click failed for ${validation.ctaName}; using WebDriver click.`
);
await element.click();
}

/*
 * 6. Capture /b/ss generated AFTER the CTA click.
 */
this.currentAction="Waiting for CTA Adobe /b/ss";
this.progress();

let hits=[];
const captureStart=Date.now(),captureLimit=this.ctaClickWait;
while(Date.now()-captureStart<captureLimit){
const current=await this.collectNetworkData();
for(const hit of current){
const key=hit.requestId||hit._key||[hit.url,hit.pageName,JSON.stringify(hit.eVars),JSON.stringify(hit.events),hit.timestamp].join("|");
if(!hits.some(existing=>(existing.requestId&&existing.requestId===hit.requestId)||existing._key===key))hits.push(hit);
}
const event6Found=hits.some(hit=>this.hitHasEvent6(hit));
const v24Found=hits.some(hit=>this.getHitEVar24(hit)!=="");
if(event6Found&&v24Found)break;
await new Promise(r=>setTimeout(r,this.ctaPollInterval));
}

/*
 * 7. Identify CTA Adobe hits.
 */
const ctaHits=hits.filter(hit=>this.isCTAAdobeHit(hit));

/*
 * 8. event6 and v24 may be on separate hits.
 */
const event6Hit=ctaHits.find(hit=>this.hitHasEvent6(hit))||null;
const eVar24Hit=ctaHits.find(hit=>this.getHitEVar24(hit)!=="")||null;

validation.adobeHitCount=hits.length;
validation.ctaAdobeHitCount=ctaHits.length;

validation.event6=!!event6Hit;
validation.eVar24=eVar24Hit?this.getHitEVar24(eVar24Hit):"";

validation.event6Hit=!!event6Hit;
validation.eVar24Hit=!!eVar24Hit;

validation.ctaAdobeHits=ctaHits.map(hit=>({
url:hit.url,
requestId:hit.requestId,
pageName:hit.pageName,
events:hit.events,
eVars:hit.eVars,
pe:hit.pe,
pev2:hit.pev2,
link:hit.link,
timestamp:hit.timestamp
}));

validation.adobeHit=
event6Hit||
eVar24Hit||
ctaHits[0]||
hits[hits.length-1]||
null;

/*
 * 9. PASS requires event6 and v24/eVar24 on an actual CTA tracking hit.
 */
if(validation.event6&&validation.eVar24&&ctaHits.some(hit=>this.hitHasEvent6(hit)&&this.getHitEVar24(hit)!=="")){

validation.status="PASS";
validation.validation="PASS";
validation.error="";

this.log(
"INFO",
`CTA PASS: ${validation.ctaName} - event6 and eVar24/v24 fired`
);

}else{

validation.status="FAIL";
validation.validation="FAIL";

const missing=[];

if(!validation.event6){
missing.push(`event6 not fired on Page URL: ${pageUrl}`);
}

if(!validation.eVar24){
missing.push(`eVar24/v24 not fired on Page URL: ${pageUrl}`);
}

if(!hits.length){

validation.error=
`No Adobe /b/ss hit was captured after CTA click. event6 and eVar24/v24 not fired on Page URL: ${pageUrl}`;

}else if(!ctaHits.length){

validation.error=
`Adobe /b/ss hit(s) captured, but no CTA hit (pe=lnk_o/pev2=Cta Click) was detected. ${missing.join(" | ")}`;

}else{

validation.error=missing.join(" | ");

}

this.log(
"ERROR",
`CTA FAIL: ${validation.ctaName} - ${validation.error}`
);

}

}catch(error){

validation.status="FAIL";
validation.validation="FAIL";
validation.error=
`${error.message||String(error)} | Page URL: ${pageUrl}`;

this.log(
"ERROR",
`CTA error: ${validation.ctaName} - ${validation.error}`
);

/*
 * A navigation/proxy error must not kill all remaining CTAs.
 * The next CTA gets a fresh page reload.
 */

}

validations.push(validation);
this.progress();

/*
 * IMPORTANT:
 * There is NO explicit reload here.
 *
 * The NEXT loop iteration calls preparePageForCTAClick(),
 * which performs the one required reload before the next CTA.
 *
 * Therefore:
 *
 * CTA 1 -> click/capture -> CTA 2 reload -> CTA 2
 * CTA 2 -> click/capture -> CTA 3 reload -> CTA 3
 */
}

this.currentAction="";
this.currentCTA="";
this.progress();

return validations;
}

mergePageResult(pageResult){
this.results.pages.push(pageResult);

if(pageResult.adobeHits&&pageResult.adobeHits.length){
for(const hit of pageResult.adobeHits){
if(!this.results.adobeHits.some(x=>x._key===hit._key)){
this.results.adobeHits.push(hit);
}
}
}

if(pageResult.errors&&pageResult.errors.length){
this.results.errors.push(
...pageResult.errors.map(error=>({
url:pageResult.url,
error:String(error)
}))
);
}

if(pageResult.ctaValidations&&pageResult.ctaValidations.length){
this.results.ctaValidations.push(...pageResult.ctaValidations);
}

this.progress();
}

async scanPage(url,baseUrl){
const pageUrl=this.normalizeUrl(url),pageNumber=this.results.pages.length+1;

this.currentPageUrl=pageUrl;
this.currentStep=`Scanning page ${pageNumber}`;
this.currentAction="Loading page";
this.currentCTA="";
this.progress();

const pageResult={
url:pageUrl,
finalUrl:pageUrl,
title:"",
pageName:"",
adobeHits:[],
adobeTracked:false,
adobeStatus:"FAIL",
reportSuite:"",
eVars:{},
props:{},
events:{},
marketingPixels:[],
links:[],
ctas:[],
ctaValidations:[],
errors:[],
status:"PASS"
};

try{

this.log("INFO",`Opening page: ${pageUrl}`);

await this.clearPerformanceLogs();

await this.driver.get(pageUrl);

this.currentPageUrl=this.normalizeUrl(
await this.driver.getCurrentUrl()
);
this.currentPageName="";

let earlyPageHits=await this.collectNetworkData();

await this.driver.wait(
until.elementLocated(By.css("body")),
15000
).catch(()=>{});

this.currentAction="Waiting for page";
this.progress();

const pageLoadDrain=[];
const pageComplete=await this.waitForPageComplete(15000,pageLoadDrain);

if(!pageComplete){
this.log(
"WARN",
`Page did not reach document.readyState=complete within timeout: ${pageUrl}`
);
}

await this.waitForDynamicContent(10000,pageLoadDrain);

await new Promise(r=>setTimeout(r,this.postAdobeWait));

pageResult.title=await this.driver.getTitle();

const actualLoadedUrl=this.normalizeUrl(
await this.driver.getCurrentUrl()
);

if(this.isCheckoutSuccessUrl(pageUrl)&&actualLoadedUrl){
pageResult.url=actualLoadedUrl;
}

pageResult.finalUrl=actualLoadedUrl||pageResult.url;
this.currentPageUrl=pageResult.finalUrl;

/*
 * Capture PAGE-LOAD Adobe hit.
 */
this.currentAction="Capturing Adobe Analytics";
this.progress();

const pageHits=await this.captureAdobeHits(this.maxAdobeWait);
const allCapturedPageHits=[...earlyPageHits,...pageLoadDrain,...pageHits];
const uniquePageHits=[];
const pageSeen=new Set;

for(const hit of allCapturedPageHits){

const key=
hit.requestId||
hit._key||
[hit.url,hit.pageName,hit.timestamp].join("|");

if(!pageSeen.has(key)){
pageSeen.add(key);
uniquePageHits.push(hit);
}
}

const latestHit=uniquePageHits[uniquePageHits.length-1];
const pageNameHit=[...uniquePageHits]
.reverse()
.find(hit=>String(hit?.pageName||"").trim());
const domPageName=
pageNameHit?.pageName
?""
:await this.getPageNameFromDom();

pageResult.adobeHits=uniquePageHits;
pageResult.adobeTracked=uniquePageHits.length>0;
pageResult.adobeStatus=pageResult.adobeTracked?"PASS":"FAIL";
pageResult.pageName=
pageNameHit?.pageName||
domPageName||
"";
this.currentPageName=pageResult.pageName||"";
this.currentAction="Page name captured";
this.progress();

if(latestHit){

pageResult.reportSuite=latestHit.reportSuite||"";
pageResult.eVars=latestHit.eVars||{};
pageResult.props=latestHit.props||{};
pageResult.events=latestHit.events||{};

}

if(!pageResult.adobeTracked){

pageResult.status="FAIL";
pageResult.errors.push(
"No Adobe Analytics /b/ss hit was captured on page load."
);

this.log(
"ERROR",
"No Adobe Analytics /b/ss hit was captured on page load"
);

}else{

this.log(
"INFO",
`Adobe Analytics hit(s) captured: ${uniquePageHits.length}`
);

}

pageResult.marketingPixels=this.results.marketingPixels.slice(-100);

pageResult.links=await this.getPageLinks(baseUrl);

if(this.validations.cta){
this.currentAction="Finding links and CTAs";
this.progress();

pageResult.ctas=await this.getCTAs();

this.log(
"INFO",
`Unique CTA candidates selected for validation: ${pageResult.ctas.length}`
);

this.currentAction="Validating CTAs";
this.currentCTA="";
this.progress();

pageResult.ctaValidations=
await this.validateCTAs(
pageResult.url,
pageResult.pageName,
pageResult.ctas
);

if(
pageResult.ctaValidations.some(
item=>item.status==="FAIL"
)
){
pageResult.status="FAIL";
}
}else{
pageResult.ctas=[];
pageResult.ctaValidations=[];
}

}catch(error){

pageResult.status="FAIL";

pageResult.errors.push(
error.message||String(error)
);

this.log(
"ERROR",
`Page ${pageNumber} failed: ${error.message||String(error)}`
);

this.log(
"ERROR",
error.stack||String(error)
);

console.error(
`[SiteCrawler] Page scan failed: ${pageResult.url}`
);

console.error(
`[SiteCrawler] Error: ${error.stack||error.message}`
);

}

this.mergePageResult(pageResult);

this.currentPageUrl=
pageResult.finalUrl||pageResult.url;
this.currentPageName=pageResult.pageName||"";

this.currentStep=
`Completed page ${pageNumber}`;

this.currentAction="";
this.currentCTA="";
this.progress();

return pageResult;
}

buildSummary(){
const pageFails=
this.results.pages.some(p=>p.status==="FAIL");

const adobeHits=this.results.adobeHits.length;
const ctas=this.results.ctaValidations;

const ctaStatus=
ctas.length?
ctas.every(x=>x.status==="PASS")?"PASS":"FAIL":
"-";

return{
status:pageFails?"FAIL":"PASS",
pagesVisited:this.results.pages.length,
adobeHits,
adobe:adobeHits>0?"PASS":"FAIL",
cta:ctaStatus,
errors:this.results.errors.length,
totalCTAs:ctas.length,
ctaPass:ctas.filter(x=>x.status==="PASS").length,
ctaFail:ctas.filter(x=>x.status==="FAIL").length
};
}

async scanSelectedUrls(urls){
const selected=[
...new Set(
(urls||[])
.map(u=>this.normalizeUrl(u))
.filter(u=>this.isValidPageUrl(u))
)
];

if(!selected.length){
throw new Error("No valid URLs were provided.");
}

await this.createDriver();

this.results={
pages:[],
adobePages:[],
adobeHits:[],
marketingPixels:[],
errors:[],
eVars:{},
props:{},
events:{},
reportSuites:{},
ctaValidations:[],
totalNetworkRequests:0
};

this.visited=new Set;
this.queue=[];

this.currentStep="Starting selected URL validation";
this.currentPageName="";
this.currentAction="";
this.currentCTA="";

const baseUrl=selected[0];

try{

for(const url of selected){
await this.scanPage(url,baseUrl);
}

}finally{

await this.quitDriver();

this.currentAction="";
this.currentCTA="";
this.progress();

}

this.results.summary=this.buildSummary();

return this.results;
}

async scan(startUrl,maxPages=this.maxPages){
const baseUrl=this.normalizeUrl(startUrl);

if(!this.isValidPageUrl(baseUrl)){
throw new Error(`Invalid start URL: ${startUrl}`);
}

await this.createDriver();

this.results={
pages:[],
adobePages:[],
adobeHits:[],
marketingPixels:[],
errors:[],
eVars:{},
props:{},
events:{},
reportSuites:{},
ctaValidations:[],
totalNetworkRequests:0
};

this.visited=new Set;
this.queue=[baseUrl];

this.currentStep="Starting website crawl";
this.currentPageUrl=baseUrl;
this.currentPageName="";
this.currentAction="";
this.currentCTA="";
this.progress();

try{

while(
this.queue.length&&
this.visited.size<maxPages
){

const currentUrl=this.queue.shift();
const normalizedUrl=this.normalizeUrl(currentUrl);

if(this.visited.has(normalizedUrl))continue;

this.visited.add(normalizedUrl);

this.currentStep=
`Scanning page ${this.visited.size} of ${maxPages}`;

this.currentPageUrl=normalizedUrl;
this.progress();

const pageResult=
await this.scanPage(normalizedUrl,baseUrl);

for(const link of pageResult.links||[]){

const normalizedLink=
this.normalizeUrl(link);

if(
!this.visited.has(normalizedLink)&&
!this.queue.includes(normalizedLink)&&
this.isSameDomain(normalizedLink,baseUrl)
){
this.queue.push(normalizedLink);
}

}

}

this.currentStep=
`Website crawl completed (${this.results.pages.length} pages)`;

this.currentAction="";
this.currentCTA="";
this.currentPageName="";
this.progress();

}finally{

await this.quitDriver();

}

this.results.summary=this.buildSummary();

return this.results;
}

async close(){
if(this.driver){
try{
await this.driver.quit();
}catch(e){}
finally{
this.driver=null;
}
}
}

getResults(){
return this.results;
}

getSummary(){
return{
totalPages:this.results.pages.length,
adobeTrackedPages:
this.results.pages.filter(p=>p.adobeTracked).length,
totalAdobeHits:this.results.adobeHits.length,
totalMarketingPixels:this.results.marketingPixels.length,
totalErrors:this.results.errors.length,
totalCTAs:this.results.ctaValidations.length,
ctaPass:
this.results.ctaValidations.filter(x=>x.status==="PASS").length,
ctaFail:
this.results.ctaValidations.filter(x=>x.status==="FAIL").length,
reportSuites:
Object.keys(this.results.reportSuites)
};
}
}

module.exports=SiteCrawler;