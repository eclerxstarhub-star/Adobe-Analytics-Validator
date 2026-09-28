const express=require("express"),path=require("path"),fs=require("fs");
const app=express(),PORT=Number(process.env.PORT)||3000,HOST="0.0.0.0";
let PreSalesJourneyValidator=null,preSalesReportGenerator=null,SiteCrawler=null,reportGenerator=null,currentJob=null,activeValidator=null,activeCrawler=null,monitorTimer=null,shutdownInProgress=false,uncaughtHandling=false;
loadDotEnv();
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"..","public")));
app.use("/reports",express.static(path.join(__dirname,"..","reports","output")));

function loadDotEnv(){
 const p=path.join(__dirname,"..",".env");
 if(!fs.existsSync(p))return;
 for(const line of fs.readFileSync(p,"utf8").split(/\r?\n/)){
  const s=line.trim();
  if(!s||s.startsWith("#"))continue;
  const i=s.indexOf("=");
  if(i<1)continue;
  const k=s.slice(0,i).trim();
  let v=s.slice(i+1).trim();
  if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
  if(process.env[k]===undefined)process.env[k]=v;
 }
}

function loadRuntimeModules(){
 if(!PreSalesJourneyValidator)PreSalesJourneyValidator=require("../scanner/preSalesJourneyValidator");
 if(!preSalesReportGenerator)preSalesReportGenerator=require("../reports/preSalesReportGenerator");
 if(!SiteCrawler)SiteCrawler=require("../scanner/siteCrawler");
 if(!reportGenerator)reportGenerator=require("../reports/reportGenerator");
}

function loadPreSalesJourneyConfig(){
 const p=path.join(__dirname,"..","config","preSalesJourney.json");
 if(!fs.existsSync(p))throw new Error(`Pre-Sales journey configuration not found: ${p}`);
 try{return JSON.parse(fs.readFileSync(p,"utf8"));}catch(e){throw new Error(`Unable to read Pre-Sales journey configuration: ${e.message||e}`);}
}

function createJob(inputs){
 return{
  id:`job-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
  status:"QUEUED",
  startedAt:null,
  finishedAt:null,
  inputs,
  reportPath:null,
  error:null,
  logs:[],
  pages:[],
  currentPage:null,
  summary:null
 };
}

function addJobLog(job,message,level="INFO"){
 if(!job)return;
 const text=String(message),last=job.logs[job.logs.length-1];
 if(last&&last.level===level&&last.message===text)return;
 job.logs.push({timestamp:new Date().toISOString(),level,message:text});
 if(job.logs.length>500)job.logs.splice(0,job.logs.length-500);
}

function updateSummary(job,result){
 if(!job||!result)return;
 const s=result.summary||{},pages=Array.isArray(result.pages)?result.pages:[],hits=Array.isArray(result.hits)?result.hits:[],adobeHits=Array.isArray(result.adobeHits)?result.adobeHits:[],errors=Array.isArray(result.errors)?result.errors:[],ctas=Array.isArray(result.ctaValidations)?result.ctaValidations:[];
 const totalAdobeHits=Number(s.adobeHits??adobeHits.length??hits.length??0);
 let adobe=s.adobeStatus||s.adobe;
 if(adobe!=="PASS"&&adobe!=="FAIL")adobe=totalAdobeHits>0?"PASS":pages.length?"FAIL":"-";
 let cta="-";
 if(ctas.length){
  const passed=ctas.filter(x=>String(x.status||x.validation||"").toUpperCase()==="PASS").length;
  const failed=ctas.filter(x=>String(x.status||x.validation||"").toUpperCase()==="FAIL").length;
  if(passed===ctas.length)cta="PASS";
  else if(passed>0&&failed>0)cta="PARTIALLY PASS";
  else if(failed===ctas.length)cta="FAIL";
  else cta="NOT VALIDATED";
 }
 let journey=s.status;
 if(journey!=="PASS"&&journey!=="FAIL"){
  journey=pages.some(x=>String(x.status||"").toUpperCase()==="FAIL")||ctas.some(x=>String(x.status||x.validation||"").toUpperCase()==="FAIL")?"FAIL":"PASS";
 }
 job.summary={journey,adobe,cta,pagesVisited:Number(s.pagesVisited??pages.length??0),adobeHits:totalAdobeHits,errors:errors.length};
}

function syncAnalyticsState(job,crawler){
 if(!job||!crawler)return;
 let result={};
 try{result=typeof crawler.getResults==="function"?crawler.getResults()||{}:{}}catch(e){addJobLog(job,`Unable to read crawler results: ${e.message||e}`,"WARN");return;}
 const pages=Array.isArray(result.pages)?result.pages:[];
 for(let i=job.pages.length;i<pages.length;i++){
  const p=pages[i],step=p.step||p.name||`Page ${i+1}`,url=p.url||p.pageUrl||"";
  if(job.pages.some(x=>x.step===step&&x.url===url))continue;
  job.pages.push({step,url,pageName:p.pageName||"",status:p.status||"PASS",adobeHitCount:Number(p.adobeHitCount||(Array.isArray(p.adobeHits)?p.adobeHits.length:0)),eventsFound:p.eventsFound||p.events||[]});
  addJobLog(job,`${step} completed - ${url}`,String(p.status||"").toUpperCase()==="FAIL"?"ERROR":"INFO");
 }
 const currentUrl=crawler.currentPageUrl||crawler.currentUrl||"",currentStep=crawler.currentStep||"",currentAction=crawler.currentAction||"",currentCTA=crawler.currentCTA||"";
 if(currentUrl||currentStep)job.currentPage={url:currentUrl,step:currentStep||`Scanning page ${pages.length||1}`,action:currentAction,cta:currentCTA,status:"RUNNING"};
 updateSummary(job,result);
}

function syncValidatorState(job,validator){
 if(!job||!validator||!validator.result)return;
 const result=validator.result,pages=Array.isArray(result.pages)?result.pages:[];
 for(let i=job.pages.length;i<pages.length;i++){
  const p=pages[i],step=p.step||`Page ${i+1}`,url=p.url||"";
  job.pages.push({step,url,pageName:p.pageName||"",status:p.status||"PASS",adobeHitCount:Number(p.adobeHitCount||(Array.isArray(p.adobeHits)?p.adobeHits.length:0)),eventsFound:p.eventsFound||p.events||[]});
  addJobLog(job,`${step} completed - ${url}`,String(p.status||"").toUpperCase()==="FAIL"?"ERROR":"INFO");
 }
 const currentUrl=validator.currentPageUrl||"";
 if(currentUrl||validator.currentStep)job.currentPage={url:currentUrl,step:validator.currentStep||`Scanning page ${pages.length||1}`,action:validator.currentAction||"",cta:validator.currentCTA||"",status:"RUNNING"};
 updateSummary(job,result);
}

function syncCompletedState(job,result){
 if(!job||!result)return;
 const pages=Array.isArray(result.pages)?result.pages:[];
 job.pages=pages.map((p,i)=>({step:p.step||p.name||`Page ${i+1}`,url:p.url||p.pageUrl||"",pageName:p.pageName||"",status:p.status||"PASS",adobeHitCount:Number(p.adobeHitCount||(Array.isArray(p.adobeHits)?p.adobeHits.length:0)),eventsFound:p.eventsFound||p.events||[]}));
 job.currentPage=null;
 updateSummary(job,result);
}

function startAnalyticsMonitor(job,crawler){
 stopMonitor();
 monitorTimer=setInterval(()=>{try{syncAnalyticsState(job,crawler)}catch(e){addJobLog(job,`Analytics monitor error: ${e.message||e}`,"WARN")}},500);
}

function startValidatorMonitor(job,validator){
 stopMonitor();
 monitorTimer=setInterval(()=>{try{syncValidatorState(job,validator)}catch(e){addJobLog(job,`Monitor error: ${e.message||e}`,"WARN")}},500);
}

function stopMonitor(){
 if(monitorTimer){clearInterval(monitorTimer);monitorTimer=null;}
}

function createEmptyResult(){
 return{startedAt:new Date().toISOString(),finishedAt:null,authentication:{},summary:{},pages:[],actions:[],products:[],orders:[],ecommerceEvents:[],hits:[],adobeHits:[],errors:[],selections:[]};
}

function normalizePreSalesFailureResult(result,reason,termination){
 const r=result||createEmptyResult();
 r.summary=r.summary||{};
 r.pages=Array.isArray(r.pages)?r.pages:[];
 r.actions=Array.isArray(r.actions)?r.actions:[];
 r.products=Array.isArray(r.products)?r.products:[];
 r.orders=Array.isArray(r.orders)?r.orders:[];
 r.ecommerceEvents=Array.isArray(r.ecommerceEvents)?r.ecommerceEvents:[];
 r.hits=Array.isArray(r.hits)?r.hits:[];
 r.errors=Array.isArray(r.errors)?r.errors:[];
 r.selections=Array.isArray(r.selections)?r.selections:[];
 r.summary.status="FAIL";
 r.summary.pagesVisited=r.pages.length;
 r.summary.adobeHits=r.hits.length;
 r.summary.ecommerceEvents=r.ecommerceEvents.length;
 r.summary.productsCaptured=r.products.length;
 r.summary.ordersCaptured=r.orders.length;
 r.summary.passed=r.pages.filter(x=>x.status==="PASS").length;
 r.summary.failed=r.pages.filter(x=>x.status==="FAIL").length;
 r.interrupted=true;
 r.executionTerminationReason=reason||"Validation execution was interrupted.";
 r.executionTerminationType=termination||"INTERRUPTED";
 if(reason&&!r.errors.some(x=>String(x.error||"")===String(reason)))r.errors.push({timestamp:new Date().toISOString(),step:r.pages.length+1,error:reason,currentUrl:activeValidator?.currentPageUrl||""});
 r.finishedAt=new Date().toISOString();
 return r;
}

async function generatePreSalesHTMLReport(result,outputDirectory){
 if(!preSalesReportGenerator)loadRuntimeModules();
 const g=preSalesReportGenerator;
 if(typeof g.generatePreSalesHTML==="function")return g.generatePreSalesHTML(result,outputDirectory,{uniqueFile:true});
 if(typeof g.generateHTML==="function")return g.generateHTML(result,outputDirectory,{uniqueFile:true});
 if(typeof g.generate==="function")return g.generate(result,outputDirectory,{uniqueFile:true});
 if(typeof g.generatePreSalesReport==="function")return g.generatePreSalesReport(result,outputDirectory,{uniqueFile:true});
 if(typeof g.generateReport==="function")return g.generateReport(result,outputDirectory,{uniqueFile:true});
 if(typeof g.createReport==="function")return g.createReport(result,outputDirectory,{uniqueFile:true});
 if(typeof g==="function")return g(result,outputDirectory,{uniqueFile:true});
 const keys=Object.keys(g||{});
 throw new Error(`Pre-Sales report generator export not supported. Available exports: ${keys.join(", ")||"none"}`);
}

async function generatePreSalesFailureReport(job,result,reason,termination="PAGE_OR_EXECUTION_FAILURE"){
 loadRuntimeModules();
 const r=normalizePreSalesFailureResult(result,reason,termination),out=path.join(__dirname,"..","reports","output");
 fs.mkdirSync(out,{recursive:true});
 const file=await generatePreSalesHTMLReport(r,out);
 job.reportPath=`/reports/${path.basename(file)}`;
 job.finishedAt=r.finishedAt;
 job.error=reason||null;
 job.status="FAILED";
 syncCompletedState(job,r);
 addJobLog(job,`Failure report generated: ${job.reportPath}`);
 return job.reportPath;
}

async function generateAnalyticsFailureReport(job,crawler,reason,termination="PAGE_OR_EXECUTION_FAILURE"){
 loadRuntimeModules();
 let r=createEmptyResult();
 try{if(crawler&&typeof crawler.getResults==="function")r=crawler.getResults()||createEmptyResult()}catch(_){}
 r.pages=Array.isArray(r.pages)?r.pages:[];
 r.hits=Array.isArray(r.hits)?r.hits:[];
 r.adobeHits=Array.isArray(r.adobeHits)?r.adobeHits:[];
 r.errors=Array.isArray(r.errors)?r.errors:[];
 r.summary=r.summary||{};
 if(!r.errors.some(x=>String(x.error||"")===String(reason)))r.errors.push({timestamp:new Date().toISOString(),error:reason,currentUrl:crawler?.currentPageUrl||crawler?.currentUrl||""});
 r.summary.status="FAIL";
 r.summary.pagesVisited=r.pages.length;
 r.summary.adobeHits=r.adobeHits.length||r.hits.length;
 r.interrupted=true;
 r.executionTerminationReason=reason;
 r.executionTerminationType=termination;
 r.finishedAt=new Date().toISOString();
 const out=path.join(__dirname,"..","reports","output");
 fs.mkdirSync(out,{recursive:true});
 const file=await reportGenerator.generateHTML(r,out);
 job.reportPath=`/reports/${path.basename(file)}`;
 job.status="FAILED";
 job.finishedAt=r.finishedAt;
 job.error=reason||null;
 syncCompletedState(job,r);
 addJobLog(job,`Analytics failure report generated: ${job.reportPath}`);
 return job.reportPath;
}

async function runAnalyticsValidation(job){
 loadRuntimeModules();
 job.status="RUNNING";
 job.startedAt=new Date().toISOString();
 const singlePage=String(job.inputs.validationType||"").toLowerCase().includes("single");
 addJobLog(job,singlePage?"Single Page Adobe Analytics validation started.":"Sitewide Adobe Analytics validation started.");
 addJobLog(job,`Website URL: ${job.inputs.url}`);
 if(!singlePage)addJobLog(job,"Maximum pages: 25");
 addJobLog(job,"Initializing Selenium site crawler.");
 const crawler=new SiteCrawler({maxPages:25,maxAdobeWait:30000,logger:(level,message)=>addJobLog(job,message,level),onProgress:()=>syncAnalyticsState(job,crawler)});
 activeCrawler=crawler;
 startAnalyticsMonitor(job,crawler);
 addJobLog(job,"Selenium site crawler initialized.");
 addJobLog(job,singlePage?"Starting single-page Adobe /b/ss and CTA validation.":"Starting website crawl and Adobe /b/ss validation.");
 try{
  const result=singlePage?await crawler.scanSelectedUrls([job.inputs.url]):await crawler.scan(job.inputs.url,25);
  syncAnalyticsState(job,crawler);
  addJobLog(job,singlePage?"Single-page validation completed. Generating Analytics report.":"Website crawl completed. Generating Analytics report.");
  const out=path.join(__dirname,"..","reports","output");
  fs.mkdirSync(out,{recursive:true});
  const file=await reportGenerator.generateHTML(result,out);
  job.reportPath=`/reports/${path.basename(file)}`;
  job.finishedAt=new Date().toISOString();
  syncCompletedState(job,result);
  job.status="COMPLETED";
  job.error=null;
  addJobLog(job,`Report generated: ${job.reportPath}`);
  addJobLog(job,`Analytics validation finished with status ${job.status}.`);
  return result;
 }catch(e){
  const reason=e?.message||String(e);
  addJobLog(job,`Analytics validation failed: ${reason}`,"ERROR");
  try{await generateAnalyticsFailureReport(job,crawler,reason,"EXECUTION_FAILURE")}catch(re){
   job.status="FAILED";job.error=reason;job.finishedAt=new Date().toISOString();
   addJobLog(job,`Unable to generate Analytics failure report: ${re.message||re}`,"ERROR");
  }
  return null;
 }finally{
  stopMonitor();
  if(activeCrawler===crawler)activeCrawler=null;
  job.currentPage=null;
 }
}

function validatePreSalesUrl(value){
 const url=String(value||"").trim();
 if(!url)return{error:"Pre-Sales Website URL is required."};
 let parsed;
 try{parsed=new URL(url)}catch(_){return{error:"Pre-Sales Website URL is invalid."}};
 if(!["http:","https:"].includes(parsed.protocol))return{error:"Pre-Sales Website URL must start with http:// or https://"};
 const hostname=parsed.hostname.toLowerCase();
 const allowedHosts=["starhubltd-tst1.outsystemsenterprise.com","starhubltd-tst.outsystemsenterprise.com","consumer-hfd.starhub.com","consumer.starhub.com","starhub.com"];
 if(!allowedHosts.includes(hostname))return{error:"Unsupported Pre-Sales Website URL. Please use a configured StarHub environment."};
 return{url:`${parsed.protocol}//${parsed.host}/`};
}

function buildRuntimeJourneyConfig(journeyConfig,selectedBaseUrl){
 const base=new URL(selectedBaseUrl),baseOrigin=base.origin;
 function replaceUrls(value){
  if(Array.isArray(value))return value.map(replaceUrls);
  if(value&&typeof value==="object"){
   const output={};
   for(const [key,item] of Object.entries(value))output[key]=replaceUrls(item);
   return output;
  }
  if(typeof value!=="string")return value;
  const text=value.trim();
  if(!/^https?:\/\//i.test(text))return value;
  try{
   const parsed=new URL(text);
   return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`,baseOrigin).toString();
  }catch(_){return value}
 }
 return replaceUrls(journeyConfig);
}

function validatePreSalesInputs(inputs){
 const paymentMode=String(inputs.paymentMode||"").trim(),simType=String(inputs.simType||"").trim();
 if(!String(inputs.hubId||"").trim())return{error:"Hub ID is required."};
 if(paymentMode!=="Pay Later"&&paymentMode!=="Pay Today")return{error:"Payment Mode must be Pay Later or Pay Today."};
 if(!["eSIM","Physical SIM"].includes(simType))return{error:"SIM Type must be eSIM or Physical SIM."};
 if(paymentMode==="Pay Later"&&!["12","24","36"].includes(String(inputs.payLaterPeriod||"").trim()))return{error:"Pay Later Period must be 12, 24, or 36 months."};
 return null;
}

async function runPreSalesJourney(job){
 loadRuntimeModules();
 job.status="RUNNING";
 job.startedAt=new Date().toISOString();
 addJobLog(job,"Pre-Sales Journey validation started.");
 addJobLog(job,"Loading Pre-Sales journey configuration.");
 const journeyConfig=loadPreSalesJourneyConfig(),selectedUrl=String(job.inputs.url||"").trim(),urlValidation=validatePreSalesUrl(selectedUrl);
 if(urlValidation.error)throw new Error(urlValidation.error);
 const startUrl=urlValidation.url,runtimeJourneyConfig=buildRuntimeJourneyConfig(journeyConfig,startUrl);
 if(!runtimeJourneyConfig.startUrl)throw new Error("Pre-Sales journey configuration does not contain a startUrl.");
 addJobLog(job,`Selected Pre-Sales Website URL: ${startUrl}`);
 addJobLog(job,`Journey start URL: ${runtimeJourneyConfig.startUrl}`);
 addJobLog(job,`Home URL prefix: ${runtimeJourneyConfig.homeUrlPrefix||"-"}`);
 addJobLog(job,`Device listing prefix: ${runtimeJourneyConfig.deviceListingPrefix||"-"}`);
 addJobLog(job,`Product PDP prefix: ${runtimeJourneyConfig.productPdpPrefix||"-"}`);
 addJobLog(job,`Intent prefix: ${runtimeJourneyConfig.intentPrefix||"-"}`);
 addJobLog(job,"Initializing Selenium Pre-Sales Journey Validator.");
 const options=job.inputs.options||{};
 const credentials=options.credentials&&typeof options.credentials==="object"?options.credentials:{hubId:job.inputs.hubId||"",hubPassword:job.inputs.hubPassword||""};
 const paymentMode=String(job.inputs.paymentMode||"").trim();
 const paymentPrompt=paymentMode==="Pay Later"?"1":"2";
 const simType=String(job.inputs.simType||"").trim();
 const payLaterPeriod=paymentMode==="Pay Later"?String(job.inputs.payLaterPeriod||""):"";
 addJobLog(job,`Payment Mode: ${paymentMode||"-"}`);
 addJobLog(job,`Payment Prompt: ${paymentPrompt}`);
 addJobLog(job,`Payment Period: ${payLaterPeriod||"-"}`);
 addJobLog(job,`SIM Type: ${simType||"-"}`);
 const validator=new PreSalesJourneyValidator({
  startUrl:runtimeJourneyConfig.startUrl,
  credentials,
  journeyConfig:runtimeJourneyConfig,
  maxAdobeWait:60000,
  networkQuietTime:4000,
  pollInterval:250,
  logger:(level,message)=>addJobLog(job,message,level),
  onProgress:()=>syncValidatorState(job,validator),
  paymentOptionPrompt:async()=>paymentPrompt,
  payLaterPeriod:payLaterPeriod||null,
  simType
 });
 activeValidator=validator;
 startValidatorMonitor(job,validator);
 addJobLog(job,"Selenium Pre-Sales Journey Validator initialized.");
 try{
  addJobLog(job,"Starting complete 12-step Pre-Sales journey.");
  const result=await validator.run();
  syncValidatorState(job,validator);
  const out=path.join(__dirname,"..","reports","output");
  fs.mkdirSync(out,{recursive:true});
  const file=await generatePreSalesHTMLReport(result,out);
  job.reportPath=`/reports/${path.basename(file)}`;
  job.finishedAt=new Date().toISOString();
  syncCompletedState(job,result);
  job.status=result?.summary?.status==="FAIL"?"FAILED":"COMPLETED";
  job.error=job.status==="FAILED"?(result?.errors?.length?result.errors[result.errors.length-1]?.error||"Pre-Sales journey failed.":"Pre-Sales journey failed."):null;
  addJobLog(job,`Pre-Sales report generated: ${job.reportPath}`);
  addJobLog(job,`Pre-Sales validation finished with status ${job.status}.`);
  return result;
 }catch(e){
  const reason=e?.message||String(e);
  addJobLog(job,`Pre-Sales validation failed: ${reason}`,"ERROR");
  try{
   await generatePreSalesFailureReport(job,validator?.result||createEmptyResult(),reason,"EXECUTION_FAILURE");
  }catch(re){
   job.status="FAILED";job.error=reason;job.finishedAt=new Date().toISOString();
   addJobLog(job,`Unable to generate Pre-Sales failure report: ${re.message||re}`,"ERROR");
  }
  return null;
 }finally{
  stopMonitor();
  if(activeValidator===validator)activeValidator=null;
  job.currentPage=null;
 }
}

function serializeJob(job){
 if(!job)return null;
 const finishedAt=job.finishedAt||null;
 let duration=null;
 if(job.startedAt){
  const start=new Date(job.startedAt).getTime(),end=finishedAt?new Date(finishedAt).getTime():Date.now();
  if(!Number.isNaN(start)&&!Number.isNaN(end)&&end>=start){
   const seconds=Math.floor((end-start)/1000);
   duration=`${Math.floor(seconds/60)}m ${seconds%60}s`;
  }
 }
 return{id:job.id,jobId:job.id,status:job.status,startedAt:job.startedAt,finishedAt,completedAt:finishedAt,duration,reportPath:job.reportPath,error:job.error,message:job.error||null,currentStep:job.currentPage?.step||null,currentPage:job.currentPage,inputs:job.inputs,logs:job.logs,pages:job.pages,summary:job.summary};
}

function findLatestReport(){
 const out=path.join(__dirname,"..","reports","output");
 if(!fs.existsSync(out))return null;
 const files=fs.readdirSync(out).filter(x=>x.toLowerCase().endsWith(".html")).map(file=>{try{return{file,mtimeMs:fs.statSync(path.join(out,file)).mtimeMs}}catch(_){return null}}).filter(Boolean).sort((a,b)=>b.mtimeMs-a.mtimeMs);
 return files.length?files[0].file:null;
}

function validateJobRequest(body){
 const url=String(body?.url||"").trim();
 if(!url)return{error:"Website URL is required."};
 if(!/^https?:\/\//i.test(url))return{error:"Website URL must start with http:// or https://"};
 return{url};
}

function getPreSalesInputs(body){
 const options=body?.options&&typeof body.options==="object"?body.options:{};
 return{
  url:String(body?.url||body?.websiteUrl||options?.url||options?.websiteUrl||"").trim(),
  hubId:body?.hubId??body?.hubID??options?.hubId??options?.hubID??"",
  hubPassword:body?.hubPassword??options?.hubPassword??"",
  paymentMode:body?.paymentMode??body?.paymentMethod??options?.paymentMode??options?.paymentMethod??"",
  payLaterPeriod:body?.payLaterPeriod??body?.paymentPeriod??body?.period??options?.payLaterPeriod??options?.paymentPeriod??options?.period??"",
  simType:body?.simType??options?.simType??"",
  startUrl:body?.startUrl??options?.startUrl??"",
  credentials:body?.credentials??options?.credentials??null,
  journeyConfig:body?.journeyConfig??options?.journeyConfig??null,
  options
 };
}

async function createPreSalesJobFromBody(body,res){
 if(currentJob&&(currentJob.status==="QUEUED"||currentJob.status==="RUNNING"))return res.status(409).json({error:"A validation job is already running.",jobId:currentJob.id,id:currentJob.id,job:serializeJob(currentJob)});
 const ps=getPreSalesInputs(body),urlValidation=validatePreSalesUrl(ps.url);
 if(urlValidation.error)return res.status(400).json({error:urlValidation.error});
 const inputValidation=validatePreSalesInputs(ps);
 if(inputValidation)return res.status(400).json({error:inputValidation.error});
 const credentials=ps.credentials&&typeof ps.credentials==="object"?ps.credentials:{};
 currentJob=createJob({
  url:urlValidation.url,
  validationType:"preSalesJourney",
  mode:"presales",
  hubId:String(ps.hubId).trim(),
  hubPassword:String(ps.hubPassword||""),
  paymentMode:String(ps.paymentMode).trim(),
  payLaterPeriod:String(ps.payLaterPeriod||"").trim(),
  simType:String(ps.simType).trim(),
  options:{
   ...ps.options,
   startUrl:urlValidation.url,
   credentials:{...credentials,hubId:credentials.hubId||ps.hubId||"",hubPassword:credentials.hubPassword||ps.hubPassword||""},
   journeyConfig:null,
   hubId:ps.hubId,
   hubPassword:ps.hubPassword,
   paymentMode:ps.paymentMode,
   payLaterPeriod:ps.payLaterPeriod,
   simType:ps.simType
  }
 });
 addJobLog(currentJob,"Pre-Sales Journey validation job created and queued.");
 setImmediate(async()=>{
  try{await runPreSalesJourney(currentJob)}catch(e){
   if(currentJob){
    currentJob.status="FAILED";
    currentJob.error=e?.message||String(e);
    currentJob.finishedAt=new Date().toISOString();
    addJobLog(currentJob,`Unhandled Pre-Sales error: ${currentJob.error}`,"ERROR");
   }
  }
 });
 return res.status(202).json({message:"Pre-Sales validation job created.",jobId:currentJob.id,id:currentJob.id,status:currentJob.status,startedAt:currentJob.startedAt,job:serializeJob(currentJob)});
}

app.get("/api/health",(req,res)=>res.json({status:"OK",timestamp:new Date().toISOString(),activeJob:currentJob?.id||null,nodeVersion:process.version,environment:process.env.NODE_ENV||"development"}));
app.get("/api/status",(req,res)=>res.json({status:"OK",job:serializeJob(currentJob),active:!!currentJob&&(currentJob.status==="QUEUED"||currentJob.status==="RUNNING")}));
app.get("/api/jobs/:id",(req,res)=>{if(!currentJob||currentJob.id!==req.params.id)return res.status(404).json({error:"Job not found"});res.json(serializeJob(currentJob))});
app.get("/api/job/:id",(req,res)=>{if(!currentJob||currentJob.id!==req.params.id)return res.status(404).json({error:"Job not found"});res.json(serializeJob(currentJob))});

app.get("/api/reports/latest",(req,res)=>{
 const report=findLatestReport();
 if(!report)return res.status(404).json({error:"No report found"});
 res.json({report,path:`/reports/${encodeURIComponent(report)}`});
});
app.get("/api/report/latest",(req,res)=>{
 const report=findLatestReport();
 if(!report)return res.status(404).json({error:"No report found"});
 res.json({report,path:`/reports/${encodeURIComponent(report)}`});
});
app.get("/api/reports/:filename",(req,res)=>{
 const filename=path.basename(req.params.filename),file=path.join(__dirname,"..","reports","output",filename);
 if(!fs.existsSync(file))return res.status(404).json({error:"Report not found"});
 res.sendFile(file);
});
app.get("/api/report/:filename",(req,res)=>{
 const filename=path.basename(req.params.filename),file=path.join(__dirname,"..","reports","output",filename);
 if(!fs.existsSync(file))return res.status(404).json({error:"Report not found"});
 res.sendFile(file);
});

async function createAnalyticsJob(req,res){
 if(currentJob&&(currentJob.status==="QUEUED"||currentJob.status==="RUNNING"))return res.status(409).json({error:"A validation job is already running.",jobId:currentJob.id,id:currentJob.id,job:serializeJob(currentJob)});
 const body=req.body||{},validationType=String(body.validationType||body.validationTypeName||body.type||"singlePage"),isPreSales=String(body.mode||"").toLowerCase()==="presales"||validationType.toLowerCase().includes("presales");
 if(isPreSales)return createPreSalesJobFromBody(body,res);
 const checked=validateJobRequest(body);
 if(checked.error)return res.status(400).json({error:checked.error});
 const validations=body.validations&&typeof body.validations==="object"?body.validations:{};
 currentJob=createJob({
  url:checked.url,
  validationType,
  mode:"analytics",
  pageLoadAnalytics:validations.pageLoad!==false&&body.pageLoadAnalytics!==false,
  eVars:validations.eVars!==false&&body.eVars!==false,
  props:validations.props!==false&&body.props!==false,
  events:validations.events!==false&&body.events!==false,
  products:validations.products!==false&&body.products!==false,
  ctaValidation:validations.cta!==false&&body.ctaValidation!==false,
  options:body.options||{}
 });
 addJobLog(currentJob,"Analytics validation job created and queued.");
 setImmediate(async()=>{
  try{await runAnalyticsValidation(currentJob)}catch(e){
   currentJob.status="FAILED";
   currentJob.error=e?.message||String(e);
   currentJob.finishedAt=new Date().toISOString();
   addJobLog(currentJob,`Unhandled validation error: ${currentJob.error}`,"ERROR");
  }
 });
 return res.status(202).json({message:"Validation job created.",jobId:currentJob.id,id:currentJob.id,status:currentJob.status,startedAt:currentJob.startedAt,job:serializeJob(currentJob)});
}

app.post("/api/jobs",createAnalyticsJob);
app.post("/api/validate",createAnalyticsJob);
app.post("/api/pre-sales/jobs",(req,res)=>createPreSalesJobFromBody(req.body||{},res));
app.post("/api/pre-sales/validate",(req,res)=>createPreSalesJobFromBody(req.body||{},res));
app.post("/api/journeys",(req,res)=>createPreSalesJobFromBody(req.body||{},res));

app.get("/api/journeys/current",(req,res)=>{
 if(!currentJob)return res.json({success:true,job:null});
 res.json({success:true,job:serializeJob(currentJob)});
});

app.get("/reports",(req,res)=>{
 const report=findLatestReport();
 if(!report)return res.status(404).send("No report found.");
 res.redirect(`/reports/${encodeURIComponent(report)}`);
});

app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"..","public","index.html")));

async function gracefulShutdown(signal){
 if(shutdownInProgress)return;
 shutdownInProgress=true;
 console.log(`\nReceived ${signal}. Shutting down gracefully...`);
 stopMonitor();
 try{
  if(activeCrawler){
   try{
    if(typeof activeCrawler.close==="function")await activeCrawler.close();
    else if(typeof activeCrawler.quitDriver==="function")await activeCrawler.quitDriver();
   }catch(e){console.error("Crawler shutdown error:",e.message||e)}
  }
  if(activeValidator){
   try{
    if(typeof activeValidator.close==="function")await activeValidator.close();
    else if(typeof activeValidator.quitDriver==="function")await activeValidator.quitDriver();
   }catch(e){console.error("Validator shutdown error:",e.message||e)}
  }
 }finally{
  activeCrawler=null;
  activeValidator=null;
  process.exit(0);
 }
}

process.on("SIGINT",()=>gracefulShutdown("SIGINT"));
process.on("SIGTERM",()=>gracefulShutdown("SIGTERM"));
process.on("uncaughtException",async e=>{
 console.error("Uncaught exception:",e);
 if(uncaughtHandling)return;
 uncaughtHandling=true;
 if(currentJob&&(currentJob.status==="RUNNING"||currentJob.status==="QUEUED")){
  currentJob.status="FAILED";
  currentJob.error=e?.message||String(e);
  currentJob.finishedAt=new Date().toISOString();
  addJobLog(currentJob,`Uncaught exception: ${currentJob.error}`,"ERROR");
 }
 await gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection",e=>{
 console.error("Unhandled rejection:",e);
 if(currentJob&&(currentJob.status==="RUNNING"||currentJob.status==="QUEUED")){
  currentJob.error=e?.message||String(e);
  addJobLog(currentJob,`Unhandled rejection: ${currentJob.error}`,"ERROR");
 }
});

app.listen(PORT,HOST,()=>{
 console.log("==============================================");
 console.log("ADOBE WEBSITE ANALYTICS VALIDATOR");
 console.log("==============================================");
 console.log(`Server:       http://localhost:${PORT}`);
 console.log(`Reports:      http://localhost:${PORT}/reports`);
 console.log(`Health:       http://localhost:${PORT}/api/health`);
 console.log(`Status:       http://localhost:${PORT}/api/status`);
 console.log(`Environment:  ${process.env.NODE_ENV||"development"}`);
 console.log(`Node:         ${process.version}`);
 console.log(`Working Dir:  ${process.cwd()}`);
 console.log("==============================================");
});