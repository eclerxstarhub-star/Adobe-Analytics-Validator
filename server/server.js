const express=require("express");
const path=require("path");
const fs=require("fs");

const PreSalesJourneyValidator=require("../scanner/preSalesJourneyValidator");
const preSalesReportGenerator=require("../reports/preSalesReportGenerator");

const app=express();
const PORT=process.env.PORT||3000;

let currentJob=null;
let activeValidator=null;

loadDotEnv();

app.use(express.json());
app.use(express.urlencoded({extended:true}));

app.use(express.static(path.join(__dirname,"..","public")));

app.use(
 "/reports",
 express.static(path.join(__dirname,"..","reports","output"))
);

function loadDotEnv(){
 const envPath=path.join(__dirname,"..",".env");
 if(!fs.existsSync(envPath))return;

 const lines=fs.readFileSync(envPath,"utf8").split(/\r?\n/);

 for(const line of lines){
  const trimmed=line.trim();
  if(!trimmed||trimmed.startsWith("#"))continue;

  const index=trimmed.indexOf("=");
  if(index<1)continue;

  const key=trimmed.slice(0,index).trim();
  let value=trimmed.slice(index+1).trim();

  if(
   (value.startsWith('"')&&value.endsWith('"'))||
   (value.startsWith("'")&&value.endsWith("'"))
  ){
   value=value.slice(1,-1);
  }

  if(process.env[key]===undefined){
   process.env[key]=value;
  }
 }
}

function loadPreSalesJourneyConfig(){
 const configPath=path.join(
  __dirname,
  "..",
  "config",
  "preSalesJourney.json"
 );

 if(!fs.existsSync(configPath)){
  throw new Error("Pre-Sales journey configuration file was not found.");
 }

 const config=JSON.parse(
  fs.readFileSync(configPath,"utf8")
 );

 return config;
}

function validatePreSalesUrl(value){
 const url=String(value||"").trim();

 if(!url){
  return{
   error:"Pre-Sales Website URL is required."
  };
 }

 let parsed;

 try{
  parsed=new URL(url);
 }catch(_){
  return{
   error:"Pre-Sales Website URL is invalid."
  };
 }

 if(!["http:","https:"].includes(parsed.protocol)){
  return{
   error:"Pre-Sales Website URL must start with http:// or https://"
  };
 }

 const hostname=parsed.hostname.toLowerCase();

 const allowedHosts=[
  "starhubltd-tst1.outsystemsenterprise.com",
  "starhubltd-tst.outsystemsenterprise.com",
  "consumer-hfd.starhub.com"
 ];

 if(!allowedHosts.includes(hostname)){
  return{
   error:"Unsupported Pre-Sales Website URL. Please use TST1, TST, or HFD StarHub environment."
  };
 }

 return{
  url:`${parsed.protocol}//${parsed.host}`
 };
}

function buildRuntimeJourneyConfig(journeyConfig,baseUrl){
 const base=String(baseUrl||"").replace(/\/+$/,"");

 return{
  ...journeyConfig,

  startUrl:`${base}/personal/login`,

  homeUrlPrefix:
   `${base}/personal/store/mobile-plans`,

  deviceListingPrefix:
   `${base}/personal/store/mobile/devices`,

  productPdpPrefix:
   `${base}/personal/store/mobile/devices/apple/iphone-17-pro-max`,

  intentPrefix:
   `${base}/personal/store/intent-selection`,

  starPlanPrefix:
   `${base}/personal/store/product-starplan`,

  simPrefix:
   `${base}/personal/store/sim-selection`,

  suggestionPrefix:
   `${base}/personal/store/product-suggestion-SN-UD`,

  watchPrefix:
   `${base}/personal/store/mobile/tablets-watches/apple/watch-s11-46mm-al`,

  reviewOrderPrefix:
   `${base}/personal/revieworder`,

  mobileNumberPrefix:
   `${base}/personal/checkout/your-mobile-number`,

  reviewDetailPrefix:
   `${base}/personal/checkout/reviewdetail`,

  threeDsPrefix:
   `${base}/TorpedoPayment/ThreeDSLoadingPageForWeb`,

  successPrefix:
   `${base}/personal/checkout-success`
 };
}

function detectEnvironment(baseUrl,journeyConfig){
 const base=String(baseUrl||"").replace(/\/+$/,"").toLowerCase();
 const environments=journeyConfig.environments||{};

 for(const [name,value] of Object.entries(environments)){
  const envBase=String(value||"")
   .replace(/\/+$/,"")
   .toLowerCase();

  if(base===envBase){
   return name;
  }
 }

 return "custom";
}

function validatePreSalesInputs(inputs){
 const errors=[];

 if(!String(inputs.hubId||"").trim()){
  errors.push("Hub ID is required.");
 }

 const paymentMode=String(inputs.paymentMode||"").trim();

 if(!["Pay Later","Pay Today"].includes(paymentMode)){
  errors.push("Payment Mode must be Pay Later or Pay Today.");
 }

 const simType=String(inputs.simType||"").trim();

 if(!["eSIM","Physical SIM"].includes(simType)){
  errors.push("SIM Type must be eSIM or Physical SIM.");
 }

 if(paymentMode==="Pay Later"){
  const period=String(inputs.payLaterPeriod||"").trim();

  if(!["12","24","36"].includes(period)){
   errors.push("Pay Later Period must be 12, 24, or 36 months.");
  }
 }

 return errors;
}

function createJob(inputs){
 return{
  id:`job-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,

  status:"QUEUED",

  createdAt:new Date().toISOString(),
  startedAt:null,
  finishedAt:null,

  inputs,

  reportPath:null,
  error:null,

  logs:[],

  summary:null,

  currentStep:null,
  currentPage:null
 };
}

function addJobLog(job,message,level="INFO"){
 const entry={
  timestamp:new Date().toISOString(),
  level,
  message:String(message)
 };

 if(!Array.isArray(job.logs)){
  job.logs=[];
 }

 job.logs.push(entry);

 if(job.logs.length>1000){
  job.logs=job.logs.slice(-1000);
 }

 const prefix=`[${level}]`;

 if(level==="ERROR"){
  console.error(prefix,message);
 }else{
  console.log(prefix,message);
 }
}

function serializeJob(job){
 if(!job)return null;

 const startedAt=job.startedAt
  ?new Date(job.startedAt)
  :null;

 const finishedAt=job.finishedAt
  ?new Date(job.finishedAt)
  :null;

 let duration=null;

 if(startedAt){
  const endTime=finishedAt||new Date();

  const durationMs=
   endTime.getTime()-startedAt.getTime();

  const totalSeconds=Math.max(
   0,
   Math.floor(durationMs/1000)
  );

  const minutes=Math.floor(totalSeconds/60);
  const seconds=totalSeconds%60;

  duration=`${minutes}m ${seconds}s`;
 }

 let currentStep="Waiting to start";

 if(job.status==="QUEUED"){
  currentStep="Job queued";
 }

 if(job.status==="RUNNING"){
  currentStep=
   job.currentStep||
   "Executing Selenium journey";
 }

 if(job.status==="COMPLETED"){
  currentStep="Validation completed";
 }

 if(job.status==="FAILED"){
  currentStep="Validation failed";
 }

 return{
  jobId:job.id,
  status:job.status,

  startedAt:job.startedAt,
  completedAt:job.finishedAt,
  finishedAt:job.finishedAt,

  duration,

  currentStep,
  currentPage:job.currentPage||null,

  message:job.error||null,
  error:job.error||null,

  reportPath:job.reportPath,

  logs:Array.isArray(job.logs)?job.logs:[],

  summary:job.summary||null,

  inputs:job.inputs
 };
}

function syncValidatorState(job,validator){
 if(!validator)return;

 try{
  const result=validator.result||{};

  job.currentPage=
   validator.currentPageUrl||
   validator.currentUrl||
   job.currentPage||
   null;

  job.currentStep=
   validator.currentStep||
   validator.currentAction||
   job.currentStep||
   null;

  if(result.summary){
   job.summary=result.summary;
  }
 }catch(_){}
}

function getPreSalesInputs(body){
 const source=body||{};
 const options=
  source.options&&typeof source.options==="object"
   ?source.options
   :{};

 return{
  url:String(
   source.url||
   source.websiteUrl||
   options.url||
   options.websiteUrl||
   ""
  ).trim(),

  hubId:String(
   source.hubId||
   options.hubId||
   ""
  ).trim(),

  hubPassword:String(
   source.hubPassword||
   options.hubPassword||
   process.env.HUB_PASSWORD||
   ""
  ),

  paymentMode:String(
   source.paymentMode||
   options.paymentMode||
   ""
  ).trim(),

  payLaterPeriod:String(
   source.payLaterPeriod||
   source.paymentPeriod||
   options.payLaterPeriod||
   options.paymentPeriod||
   ""
  ).trim(),

  simType:String(
   source.simType||
   options.simType||
   ""
  ).trim(),

  options
 };
}

function createPreSalesJobFromBody(body){
 const inputs=getPreSalesInputs(body);

 const urlValidation=
  validatePreSalesUrl(inputs.url);

 if(urlValidation.error){
  return{
   error:urlValidation.error
  };
 }

 const validationErrors=
  validatePreSalesInputs(inputs);

 if(validationErrors.length){
  return{
   error:validationErrors.join(" ")
  };
 }

 const journeyConfig=loadPreSalesJourneyConfig();

 const baseUrl=urlValidation.url;

 const runtimeJourneyConfig=
  buildRuntimeJourneyConfig(
   journeyConfig,
   baseUrl
  );

 const environment=
  detectEnvironment(
   baseUrl,
   journeyConfig
  );

 const credentials={
  ...(inputs.options.credentials||{}),
  hubId:inputs.hubId,
  hubPassword:inputs.hubPassword
 };

 return{
  job:createJob({
   url:baseUrl,
   websiteUrl:baseUrl,

   environment,

   hubId:inputs.hubId,
   hubPassword:inputs.hubPassword,

   paymentMode:inputs.paymentMode,
   payLaterPeriod:
    inputs.paymentMode==="Pay Later"
     ?inputs.payLaterPeriod
     :"",

   simType:inputs.simType,

   options:{
    ...inputs.options,

    url:baseUrl,
    websiteUrl:baseUrl,

    startUrl:
     runtimeJourneyConfig.startUrl,

    environment,

    credentials,

    hubId:inputs.hubId,
    hubPassword:inputs.hubPassword,

    paymentMode:inputs.paymentMode,

    payLaterPeriod:
     inputs.paymentMode==="Pay Later"
      ?inputs.payLaterPeriod
      :"",

    simType:inputs.simType
   },

   journeyConfig:runtimeJourneyConfig
  })
 };
}

async function generateFailureReport(job,validator,reason){
 try{
  if(
   !preSalesReportGenerator||
   typeof preSalesReportGenerator.generatePreSalesHTML!=="function"
  ){
   addJobLog(
    job,
    "Pre-Sales report generator does not expose generatePreSalesHTML.",
    "ERROR"
   );
   return;
  }

  const output=path.join(
   __dirname,
   "..",
   "reports",
   "output"
  );

  fs.mkdirSync(
   output,
   {recursive:true}
  );

  const result=
   validator?.result||
   {
    startedAt:job.startedAt,
    finishedAt:new Date().toISOString(),
    errors:[
     {
      error:reason,
      type:"EXECUTION_FAILURE"
     }
    ],
    summary:{
     status:"FAIL",
     steps:0,
     pagesVisited:0,
     adobeHits:0,
     ecommerceEvents:0,
     productsCaptured:0,
     ordersCaptured:0,
     passed:0,
     failed:1
    }
   };

  const reportPath=
   await preSalesReportGenerator.generatePreSalesHTML(
    result,
    output
   );

  if(reportPath){
   job.reportPath=
    `/reports/${path.basename(reportPath)}`;

   addJobLog(
    job,
    `Pre-Sales failure report generated: ${job.reportPath}`
   );
  }
 }catch(error){
  addJobLog(
   job,
   `Unable to generate Pre-Sales failure report: ${error.message||error}`,
   "ERROR"
  );
 }
}

async function runPreSalesJourney(job){
 job.status="RUNNING";
 job.startedAt=new Date().toISOString();

 addJobLog(
  job,
  "Pre-Sales Journey validation started."
 );

 let validator=null;

 try{
  addJobLog(
   job,
   "Loading Pre-Sales journey configuration."
  );

  const journeyConfig=
   loadPreSalesJourneyConfig();

  const selectedUrl=
   String(job.inputs.url||"").trim();

  const urlValidation=
   validatePreSalesUrl(selectedUrl);

  if(urlValidation.error){
   throw new Error(urlValidation.error);
  }

  const startUrl=
   urlValidation.url;

  const runtimeJourneyConfig=
   buildRuntimeJourneyConfig(
    journeyConfig,
    startUrl
   );

  const environment=
   detectEnvironment(
    startUrl,
    journeyConfig
   );

  if(!runtimeJourneyConfig.startUrl){
   throw new Error(
    "Unable to build Pre-Sales journey start URL."
   );
  }

  addJobLog(
   job,
   `Selected Pre-Sales Environment: ${environment.toUpperCase()}`
  );

  addJobLog(
   job,
   `Selected Pre-Sales Website URL: ${startUrl}`
  );

  addJobLog(
   job,
   `Journey start URL: ${runtimeJourneyConfig.startUrl}`
  );

  addJobLog(
   job,
   `Home URL prefix: ${runtimeJourneyConfig.homeUrlPrefix}`
  );

  addJobLog(
   job,
   `Device listing prefix: ${runtimeJourneyConfig.deviceListingPrefix}`
  );

  addJobLog(
   job,
   `Product PDP prefix: ${runtimeJourneyConfig.productPdpPrefix}`
  );

  addJobLog(
   job,
   `Intent prefix: ${runtimeJourneyConfig.intentPrefix}`
  );

  job.currentStep="Initializing Selenium validator";

  const paymentMode=
   String(job.inputs.paymentMode||"").trim();

  const paymentPrompt=
   paymentMode==="Pay Later"
    ?"1"
    :"2";

  const payLaterPeriod=
   paymentMode==="Pay Later"
    ?String(job.inputs.payLaterPeriod||"").trim()
    :"";

  const simType=
   String(job.inputs.simType||"").trim();

  addJobLog(
   job,
   `Payment Mode: ${paymentMode}`
  );

  addJobLog(
   job,
   `Payment Prompt: ${paymentPrompt}`
  );

  addJobLog(
   job,
   `Payment Period: ${payLaterPeriod||"-"}`
  );

  addJobLog(
   job,
   `SIM Type: ${simType}`
  );

  const credentials={
   hubId:
    String(job.inputs.hubId||"").trim(),

   hubPassword:
    String(
     job.inputs.hubPassword||
     process.env.HUB_PASSWORD||
     ""
    )
  };

  validator=
   new PreSalesJourneyValidator({
    startUrl:runtimeJourneyConfig.startUrl,

    credentials,

    journeyConfig:runtimeJourneyConfig,

    maxAdobeWait:60000,

    networkQuietTime:4000,

    pollInterval:250,

    logger:(level,message)=>{
     addJobLog(
      job,
      message,
      level||"INFO"
     );
    },

    onProgress:()=>{
     syncValidatorState(
      job,
      validator
     );
    },

    paymentOptionPrompt:
     async()=>paymentPrompt,

    payLaterPeriod:
     payLaterPeriod||null,

    simType
   });

  activeValidator=validator;

  addJobLog(
   job,
   "Selenium Pre-Sales Journey Validator initialized."
  );

  job.currentStep=
   "Starting complete 12-step Pre-Sales journey";

  addJobLog(
   job,
   "Starting complete 12-step Pre-Sales journey."
  );

  const result=
   await validator.run();

  syncValidatorState(
   job,
   validator
  );

  const output=
   path.join(
    __dirname,
    "..",
    "reports",
    "output"
   );

  fs.mkdirSync(
   output,
   {recursive:true}
  );

  if(
   !preSalesReportGenerator||
   typeof preSalesReportGenerator.generatePreSalesHTML!=="function"
  ){
   throw new Error(
    "Pre-Sales report generator function generatePreSalesHTML was not found."
   );
  }

  const reportFile=
   await preSalesReportGenerator.generatePreSalesHTML(
    result,
    output
   );

  job.reportPath=
   `/reports/${path.basename(reportFile)}`;

  job.summary=
   result?.summary||
   null;

  job.finishedAt=
   new Date().toISOString();

  job.status=
   result?.summary?.status==="FAIL"
    ?"FAILED"
    :"COMPLETED";

  if(job.status==="FAILED"){
   if(
    Array.isArray(result?.errors)&&
    result.errors.length
   ){
    const lastError=
     result.errors[result.errors.length-1];

    job.error=
     lastError?.error||
     lastError?.message||
     "Pre-Sales journey failed.";
   }else{
    job.error=
     "Pre-Sales journey failed.";
   }
  }else{
   job.error=null;
  }

  addJobLog(
   job,
   `Pre-Sales report generated: ${job.reportPath}`
  );

  addJobLog(
   job,
   `Pre-Sales validation finished with status ${job.status}.`
  );

  return result;

 }catch(error){
  const reason=
   error?.message||
   String(error);

  addJobLog(
   job,
   `Pre-Sales validation failed: ${reason}`,
   "ERROR"
  );

  job.status="FAILED";
  job.error=reason;
  job.finishedAt=
   new Date().toISOString();

  await generateFailureReport(
   job,
   validator,
   reason
  );

  return null;

 }finally{
  if(activeValidator===validator){
   activeValidator=null;
  }

  job.currentStep=
   job.status==="FAILED"
    ?"Validation failed"
    :"Validation completed";

  if(validator){
   syncValidatorState(
    job,
    validator
   );
  }
 }
}

function isJobRunning(){
 return(
  currentJob&&
  ["QUEUED","RUNNING"].includes(
   currentJob.status
  )
 );
}

app.get("/",(req,res)=>{
 res.sendFile(
  path.join(
   __dirname,
   "..",
   "public",
   "index.html"
  )
 );
});

app.get("/api/health",(req,res)=>{
 res.json({
  success:true,
  status:"OK",
  service:"Adobe Analytics Validator",
  currentJob:
   currentJob
    ?{
      id:currentJob.id,
      status:currentJob.status
     }
    :null
 });
});

app.post("/api/journeys",async(req,res)=>{
 const body=req.body||{};

 const created=
  createPreSalesJobFromBody(body);

 if(created.error){
  return res.status(400).json({
   success:false,
   message:created.error,
   error:created.error
  });
 }

 if(isJobRunning()){
  return res.status(409).json({
   success:false,
   message:
    "Another journey is currently running. Please wait.",
   error:
    "Another journey is currently running. Please wait."
  });
 }

 currentJob=created.job;

 addJobLog(
  currentJob,
  "Pre-Sales Journey validation job created and queued."
 );

 runPreSalesJourney(currentJob).catch(error=>{
  console.error(
   "Unexpected journey error:",
   error
  );

  if(currentJob){
   currentJob.status="FAILED";
   currentJob.finishedAt=
    new Date().toISOString();
   currentJob.error=
    error?.message||
    String(error);

   addJobLog(
    currentJob,
    currentJob.error,
    "ERROR"
   );
  }
 });

 return res.status(202).json({
  success:true,
  message:
   "Pre-Sales Journey validation started.",
  jobId:currentJob.id,
  status:currentJob.status
 });
});

app.get("/api/journeys/current",(req,res)=>{
 if(!currentJob){
  return res.json({
   success:true,
   job:null
  });
 }

 return res.json({
  success:true,
  job:serializeJob(currentJob)
 });
});

app.post("/api/jobs",async(req,res)=>{
 const body=req.body||{};

 if(
  body.mode&&
  body.mode!=="presales"
 ){
  return res.status(400).json({
   success:false,
   error:
    "Only Pre-Sales Journey Validation is currently supported."
  });
 }

 const created=
  createPreSalesJobFromBody(body);

 if(created.error){
  return res.status(400).json({
   success:false,
   error:created.error,
   message:created.error
  });
 }

 if(isJobRunning()){
  return res.status(409).json({
   success:false,
   error:
    "Another journey is currently running. Please wait.",
   message:
    "Another journey is currently running. Please wait."
  });
 }

 currentJob=created.job;

 addJobLog(
  currentJob,
  "Pre-Sales Journey validation job created and queued."
 );

 runPreSalesJourney(currentJob).catch(error=>{
  console.error(
   "Unexpected journey error:",
   error
  );

  if(currentJob){
   currentJob.status="FAILED";
   currentJob.finishedAt=
    new Date().toISOString();

   currentJob.error=
    error?.message||
    String(error);

   addJobLog(
    currentJob,
    currentJob.error,
    "ERROR"
   );
  }
 });

 return res.status(202).json({
  success:true,
  message:
   "Pre-Sales Journey validation started.",
  jobId:currentJob.id,
  status:currentJob.status,
  startedAt:currentJob.startedAt
 });
});

app.get("/api/jobs/:jobId",(req,res)=>{
 const jobId=req.params.jobId;

 if(
  !currentJob||
  currentJob.id!==jobId
 ){
  return res.status(404).json({
   success:false,
   error:"Job not found."
  });
 }

 return res.json(
  serializeJob(currentJob)
 );
});

process.on("SIGTERM",async()=>{
 try{
  if(activeValidator&&activeValidator.driver){
   await activeValidator.driver.quit();
  }
 }catch(_){}

 process.exit(0);
});

process.on("SIGINT",async()=>{
 try{
  if(activeValidator&&activeValidator.driver){
   await activeValidator.driver.quit();
  }
 }catch(_){}

 process.exit(0);
});

app.listen(PORT,()=>{
 console.log(
  `Web server running on port ${PORT}`
 );
});