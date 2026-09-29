const express=require("express");
const path=require("path");
const fs=require("fs");
const PreSalesJourneyValidator=require("../scanner/preSalesJourneyValidator");
const preSalesReportGenerator=require("../reports/preSalesReportGenerator");
const SiteCrawler=require("../scanner/siteCrawler");
const reportGenerator=require("../reports/reportGenerator");
const app=express();
const PORT=process.env.PORT||3000;
let currentJob=null;
let activeValidator=null;
loadDotEnv();

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"..","public")));
app.use("/reports",express.static(path.join(__dirname,"..","reports","output")));

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
        if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
        if(process.env[key]===undefined)process.env[key]=value;
    }
}

function loadPreSalesJourneyConfig(){
    const configPath=path.join(__dirname,"..","config","preSalesJourney.json");
    if(!fs.existsSync(configPath))throw new Error("Pre-Sales journey configuration file was not found.");
    return JSON.parse(fs.readFileSync(configPath,"utf8"));
}

function validatePreSalesUrl(value){
    const url=String(value||"").trim();
    if(!url)return{error:"Pre-Sales Website URL is required."};
    let parsed;
    try{parsed=new URL(url)}catch(_){return{error:"Pre-Sales Website URL is invalid."}};
    if(!["http:","https:"].includes(parsed.protocol))return{error:"Pre-Sales Website URL must start with http:// or https://"};
    const hostname=parsed.hostname.toLowerCase();
    const allowedHosts=[
 "starhubltd-tst1.outsystemsenterprise.com",
 "starhubltd-tst.outsystemsenterprise.com",
 "consumer-hfd.starhub.com",
 "consumer.starhub.com"
];
    if(!allowedHosts.includes(hostname))return{error:"Unsupported Pre-Sales Website URL. Please use TST1, TST, or HFD StarHub environment."};
    return{url:`${parsed.protocol}//${parsed.host}`};
}

function buildRuntimeJourneyConfig(journeyConfig,baseUrl){
    const base=String(baseUrl||"").replace(/\/+$/,"");
    return{
        ...journeyConfig,
        startUrl:`${base}/personal/login`,
        homeUrlPrefix:`${base}/personal/store/mobile-plans`,
        deviceListingPrefix:`${base}/personal/store/mobile/devices`,
        productPdpPrefix:`${base}/personal/store/mobile/devices/apple/iphone-17-pro-max`,
        intentPrefix:`${base}/personal/store/intent-selection`,
        starPlanPrefix:`${base}/personal/store/product-starplan`,
        simPrefix:`${base}/personal/store/sim-selection`,
        suggestionPrefix:`${base}/personal/store/product-suggestion-SN-UD`,
        watchPrefix:`${base}/personal/store/mobile/tablets-watches/apple/watch-s11-46mm-al`,
        reviewOrderPrefix:`${base}/personal/revieworder`,
        mobileNumberPrefix:`${base}/personal/checkout/your-mobile-number`,
        reviewDetailPrefix:`${base}/personal/checkout/reviewdetail`,
        threeDsPrefix:`${base}/TorpedoPayment/ThreeDSLoadingPageForWeb`,
        successPrefix:`${base}/personal/checkout-success`
    };
}

function detectEnvironment(baseUrl,journeyConfig){
    const base=String(baseUrl||"").replace(/\/+$/,"").toLowerCase();
    const environments=journeyConfig.environments||{};
    for(const[name,value]of Object.entries(environments)){
        const envBase=String(value||"").replace(/\/+$/,"").toLowerCase();
        if(base===envBase)return name;
    }
    return "custom";
}

function validatePreSalesInputs(inputs){
    const errors=[];
    if(!String(inputs.hubId||"").trim())errors.push("Hub ID is required.");
    const paymentMode=String(inputs.paymentMode||"").trim();
    if(!["Pay Later","Pay Today"].includes(paymentMode))errors.push("Payment Mode must be Pay Later or Pay Today.");
    const simType=String(inputs.simType||"").trim();
    if(!["eSIM","Physical SIM"].includes(simType))errors.push("SIM Type must be eSIM or Physical SIM.");
    if(paymentMode==="Pay Later"){
        const period=String(inputs.payLaterPeriod||"").trim();
        if(!["12","24","36"].includes(period))errors.push("Pay Later Period must be 12, 24, or 36 months.");
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
        pages:[],
        summary:null,
        currentStep:null,
        currentPage:null,
        currentPageName:"",
        currentPageStatus:"",
        currentAction:null,
        currentCta:null
    };
}

function addJobLog(job,message,level="INFO"){
    if(!job)return;
    if(!Array.isArray(job.logs))job.logs=[];
    const entry={
        timestamp:new Date().toISOString(),
        level:String(level||"INFO").toUpperCase(),
        message:String(message??"")
    };
    job.logs.push(entry);
    if(job.logs.length>1000)job.logs=job.logs.slice(-1000);
    const prefix=`[${entry.level}]`;
    if(entry.level==="ERROR")console.error(prefix,entry.message);
    else console.log(prefix,entry.message);
}

function syncValidatorState(job,validator){
    if(!job||!validator)return;
    try{
        const result=validator.result||{};

        job.currentStep=
            validator.currentStep||
            result.currentStep||
            job.currentStep||
            null;

        job.currentAction=
            validator.currentAction||
            result.currentAction||
            job.currentAction||
            null;

        job.currentCta=
            validator.currentCTA||
            validator.currentCta||
            result.currentCTA||
            result.currentCta||
            job.currentCta||
            null;

        job.currentPage=
            validator.currentPageUrl||
            validator.currentPage||
            validator.currentUrl||
            result.currentPageUrl||
            result.currentUrl||
            job.currentPage||
            null;

        if(Array.isArray(validator.pages)){
    job.pages=validator.pages;
}else if(Array.isArray(result.pages)){
    job.pages=result.pages;
}
if(Array.isArray(job.pages)&&job.pages.length){
    const lastPage=job.pages[job.pages.length-1];
    job.currentPageName=lastPage?.pageName||"";
    job.currentPageStatus=lastPage?.status||"";
}

        if(result.currentPage){
            if(typeof result.currentPage==="object"){
                job.currentPage=
                    result.currentPage.url||
                    result.currentPage.pageUrl||
                    job.currentPage;
            }else if(typeof result.currentPage==="string"){
                job.currentPage=result.currentPage;
            }
        }

        if(result.summary)job.summary=result.summary;
    }catch(error){
        console.error("Unable to sync validator state:",error?.message||error);
    }
}

function serializeJob(job){
    if(!job)return null;

    const startedAt=job.startedAt?new Date(job.startedAt):null;
    const finishedAt=job.finishedAt?new Date(job.finishedAt):null;
    let duration=null;

    if(startedAt){
        const endTime=finishedAt||new Date();
        const durationMs=endTime.getTime()-startedAt.getTime();
        const totalSeconds=Math.max(0,Math.floor(durationMs/1000));
        const minutes=Math.floor(totalSeconds/60);
        const seconds=totalSeconds%60;
        duration=`${minutes}m ${seconds}s`;
    }

    let currentStep="Waiting to start";
    if(job.status==="QUEUED")currentStep="Job queued";
    if(job.status==="RUNNING")currentStep=job.currentStep||"Executing Selenium journey";
    if(job.status==="COMPLETED")currentStep="Validation completed";
    if(job.status==="FAILED")currentStep="Validation failed";

    return{
    jobId:job.id,
    status:job.status,
    createdAt:job.createdAt,
    startedAt:job.startedAt,
    completedAt:job.finishedAt,
    finishedAt:job.finishedAt,
    duration,
    currentStep,
    currentPage:job.currentPage||null,
    currentPageName:job.currentPageName||"",
    currentPageStatus:job.currentPageStatus||"",
    currentAction:job.currentAction||null,
    currentCta:job.currentCta||null,
    lastPage:Array.isArray(job.pages)&&job.pages.length?job.pages[job.pages.length-1]:null,
    message:job.error||null,
    error:job.error||null,
    reportPath:job.reportPath,
    logs:Array.isArray(job.logs)?job.logs:[],
    pages:Array.isArray(job.pages)?job.pages:[],
    summary:job.summary||null,
    inputs:job.inputs
};
}

function getPreSalesInputs(body){
    const source=body||{};
    const options=source.options&&typeof source.options==="object"?source.options:{};

    return{
        url:String(source.url||source.websiteUrl||options.url||options.websiteUrl||"").trim(),
        hubId:String(source.hubId||options.hubId||"").trim(),
        hubPassword:String(source.hubPassword||options.hubPassword||process.env.HUB_PASSWORD||""),
        paymentMode:String(source.paymentMode||options.paymentMode||"").trim(),
        payLaterPeriod:String(source.payLaterPeriod||source.paymentPeriod||options.payLaterPeriod||options.paymentPeriod||"").trim(),
        simType:String(source.simType||options.simType||"").trim(),
        options
    };
}

function createPreSalesJobFromBody(body){
    const inputs=getPreSalesInputs(body);
    const urlValidation=validatePreSalesUrl(inputs.url);

    if(urlValidation.error)return{error:urlValidation.error};

    const validationErrors=validatePreSalesInputs(inputs);
    if(validationErrors.length)return{error:validationErrors.join(" ")};

    const journeyConfig=loadPreSalesJourneyConfig();
    const baseUrl=urlValidation.url;
    const runtimeJourneyConfig=buildRuntimeJourneyConfig(journeyConfig,baseUrl);
    const environment=detectEnvironment(baseUrl,journeyConfig);

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
            payLaterPeriod:inputs.paymentMode==="Pay Later"?inputs.payLaterPeriod:"",
            simType:inputs.simType,
            options:{
                ...inputs.options,
                url:baseUrl,
                websiteUrl:baseUrl,
                startUrl:runtimeJourneyConfig.startUrl,
                environment,
                credentials,
                hubId:inputs.hubId,
                hubPassword:inputs.hubPassword,
                paymentMode:inputs.paymentMode,
                payLaterPeriod:inputs.paymentMode==="Pay Later"?inputs.payLaterPeriod:"",
                simType:inputs.simType
            },
            journeyConfig:runtimeJourneyConfig
        })
    };
}

function validateAnalyticsUrl(value){
    const url=String(value||"").trim();
    if(!url)return{error:"Analytics Website URL is required."};
    let parsed;
    try{parsed=new URL(url)}catch(_){return{error:"Analytics Website URL is invalid."}}
    if(!["http:","https:"].includes(parsed.protocol))return{error:"Analytics Website URL must start with http:// or https://"};
    if(!parsed.hostname)return{error:"Analytics Website URL is invalid."};
    return{url:parsed.toString()};
}

function getAnalyticsInputs(body){
    const source=body||{};
    const options=source.options&&typeof source.options==="object"?source.options:{};
    const rawValidations=source.validations||options.validations||{};
    return{url:String(source.url||source.websiteUrl||options.url||options.websiteUrl||"").trim(),validationType:String(source.validationType||options.validationType||"singlePage").trim().toLowerCase(),validations:{pageLoad:rawValidations.pageLoad!==false,eVars:rawValidations.eVars!==false,props:rawValidations.props!==false,events:rawValidations.events!==false,products:rawValidations.products!==false,cta:rawValidations.cta!==false},maxPages:Number(source.maxPages||options.maxPages||25),options};
}

function createAnalyticsJobFromBody(body){
    const inputs=getAnalyticsInputs(body);
    const urlValidation=validateAnalyticsUrl(inputs.url);
    if(urlValidation.error)return{error:urlValidation.error};
    if(!["singlepage","sitewide"].includes(inputs.validationType))return{error:"validationType must be singlePage or sitewide."};
    if(!Number.isFinite(inputs.maxPages)||inputs.maxPages<1)return{error:"maxPages must be a positive number."};
    return{job:createJob({mode:"analytics",url:urlValidation.url,websiteUrl:urlValidation.url,validationType:inputs.validationType,validations:inputs.validations,maxPages:Math.floor(inputs.maxPages),options:inputs.options})};
}

function syncAnalyticsState(job,crawler){
    if(!job||!crawler)return;
    job.currentStep=crawler.currentStep||job.currentStep||null;
    job.currentAction=crawler.currentAction||job.currentAction||null;
    job.currentCta=crawler.currentCTA||job.currentCta||null;
    job.currentPage=crawler.currentPageUrl||job.currentPage||null;
    if(Array.isArray(crawler.results?.pages))job.pages=crawler.results.pages;
    if(Array.isArray(job.pages)&&job.pages.length){const last=job.pages[job.pages.length-1];job.currentPageName=last?.pageName||"";job.currentPageStatus=last?.status||"";}
    if(crawler.results?.summary)job.summary=crawler.results.summary;
}

async function runAnalyticsJob(job){
    job.status="RUNNING";job.startedAt=new Date().toISOString();
    let crawler=null,stateSync=null;
    try{
        const inputs=job.inputs||{};
        addJobLog(job,"Adobe Analytics validation started.");
        addJobLog(job,"Validation type: "+(inputs.validationType||"singlePage"));
        addJobLog(job,"Selected URL: "+inputs.url);
        addJobLog(job,"CTA validation: "+(inputs.validations?.cta===false?"Disabled":"Enabled"));
        crawler=new SiteCrawler({maxPages:inputs.maxPages||25,maxAdobeWait:30000,postAdobeWait:2000,ctaClickWait:8000,ctaPollInterval:250,validations:inputs.validations||{},logger:(level,message)=>{addJobLog(job,message,level);syncAnalyticsState(job,crawler)},onProgress:()=>syncAnalyticsState(job,crawler)});
        activeValidator=crawler;
        stateSync=setInterval(()=>syncAnalyticsState(job,crawler),500);
        job.currentStep=inputs.validationType==="sitewide"?"Starting website crawl":"Starting single-page validation";
        const result=inputs.validationType==="sitewide"?await crawler.scan(inputs.url,inputs.maxPages||25):await crawler.scanSelectedUrls([inputs.url]);
        syncAnalyticsState(job,crawler);
        const output=path.join(__dirname,"..","reports","output");
        fs.mkdirSync(output,{recursive:true});
        const reportFile=await reportGenerator.generateHTML(result,output);
        job.reportPath="/reports/"+path.basename(reportFile);
        job.pages=Array.isArray(result?.pages)?result.pages:[];job.summary=result?.summary||null;job.finishedAt=new Date().toISOString();
        job.status=result?.summary?.status==="FAIL"?"FAILED":"COMPLETED";
        if(job.status==="FAILED"){const lastError=Array.isArray(result?.errors)&&result.errors.length?result.errors[result.errors.length-1]:null;job.error=lastError?.error||lastError?.message||"Analytics validation failed."}else job.error=null;
        addJobLog(job,"Analytics report generated: "+job.reportPath);addJobLog(job,"Analytics validation finished with status "+job.status+".");
        return result;
    }catch(error){
        const reason=error?.message||String(error);
        addJobLog(job,"Analytics validation failed: "+reason,"ERROR");job.status="FAILED";job.error=reason;job.finishedAt=new Date().toISOString();
        try{if(crawler?.results){const output=path.join(__dirname,"..","reports","output");fs.mkdirSync(output,{recursive:true});const reportFile=await reportGenerator.generateHTML(crawler.results,output);job.reportPath="/reports/"+path.basename(reportFile)}}catch(reportError){addJobLog(job,"Unable to generate Analytics failure report: "+(reportError.message||reportError),"ERROR")}
        return null;
    }finally{
        if(stateSync)clearInterval(stateSync);if(crawler)syncAnalyticsState(job,crawler);if(activeValidator===crawler)activeValidator=null;job.currentStep=job.status==="FAILED"?"Validation failed":"Validation completed";if(crawler?.driver)await crawler.quitDriver().catch(()=>{});
    }
}
async function generateFailureReport(job,validator,reason){
    try{
        if(!preSalesReportGenerator||typeof preSalesReportGenerator.generatePreSalesHTML!=="function"){
            addJobLog(job,"Pre-Sales report generator does not expose generatePreSalesHTML.","ERROR");
            return;
        }

        const output=path.join(__dirname,"..","reports","output");
        fs.mkdirSync(output,{recursive:true});

        const result=validator?.result||{
            startedAt:job.startedAt,
            finishedAt:new Date().toISOString(),
            errors:[{error:reason,type:"EXECUTION_FAILURE"}],
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

        const reportPath=await preSalesReportGenerator.generatePreSalesHTML(result,output);

        if(reportPath){
            job.reportPath=`/reports/${path.basename(reportPath)}`;
            addJobLog(job,`Pre-Sales failure report generated: ${job.reportPath}`);
        }
    }catch(error){
        addJobLog(job,`Unable to generate Pre-Sales failure report: ${error.message||error}`,"ERROR");
    }
}

async function runPreSalesJourney(job){
    job.status="RUNNING";
    job.startedAt=new Date().toISOString();

    addJobLog(job,"Pre-Sales Journey validation started.");

    let validator=null;
    let stateSync=null;

    try{
        addJobLog(job,"Loading Pre-Sales journey configuration.");

        const journeyConfig=loadPreSalesJourneyConfig();
        const selectedUrl=String(job.inputs.url||"").trim();
        const urlValidation=validatePreSalesUrl(selectedUrl);

        if(urlValidation.error)throw new Error(urlValidation.error);

        const startUrl=urlValidation.url;
        const runtimeJourneyConfig=buildRuntimeJourneyConfig(journeyConfig,startUrl);
        const environment=detectEnvironment(startUrl,journeyConfig);

        if(!runtimeJourneyConfig.startUrl)throw new Error("Unable to build Pre-Sales journey start URL.");

        addJobLog(job,`Selected Pre-Sales Environment: ${environment.toUpperCase()}`);
        addJobLog(job,`Selected Pre-Sales Website URL: ${startUrl}`);
        addJobLog(job,`Journey start URL: ${runtimeJourneyConfig.startUrl}`);
        addJobLog(job,`Home URL prefix: ${runtimeJourneyConfig.homeUrlPrefix}`);
        addJobLog(job,`Device listing prefix: ${runtimeJourneyConfig.deviceListingPrefix}`);
        addJobLog(job,`Product PDP prefix: ${runtimeJourneyConfig.productPdpPrefix}`);
        addJobLog(job,`Intent prefix: ${runtimeJourneyConfig.intentPrefix}`);

        job.currentStep="Initializing Selenium validator";

        const paymentMode=String(job.inputs.paymentMode||"").trim();
        const paymentPrompt=paymentMode==="Pay Later"?"1":"2";
        const payLaterPeriod=paymentMode==="Pay Later"?String(job.inputs.payLaterPeriod||"").trim():"";
        const simType=String(job.inputs.simType||"").trim();

        addJobLog(job,`Payment Mode: ${paymentMode}`);
        addJobLog(job,`Payment Prompt: ${paymentPrompt}`);
        addJobLog(job,`Payment Period: ${payLaterPeriod||"-"}`);
        addJobLog(job,`SIM Type: ${simType}`);

        const credentials={
            hubId:String(job.inputs.hubId||"").trim(),
            hubPassword:String(job.inputs.hubPassword||process.env.HUB_PASSWORD||"")
        };

        validator=new PreSalesJourneyValidator({
            startUrl:runtimeJourneyConfig.startUrl,
            credentials,
            journeyConfig:runtimeJourneyConfig,
            maxAdobeWait:60000,
            networkQuietTime:4000,
            pollInterval:250,

            logger:message=>{
                addJobLog(job,message,"INFO");
                syncValidatorState(job,validator);
            },

            onProgress:()=>{
                syncValidatorState(job,validator);
            },

            paymentOptionPrompt:async()=>paymentPrompt,
            payLaterPeriod:payLaterPeriod||null,
            simType
        });

        activeValidator=validator;

        addJobLog(job,"Selenium Pre-Sales Journey Validator initialized.");

        job.currentStep="Starting complete 12-step Pre-Sales journey";

        addJobLog(job,"Starting complete 12-step Pre-Sales journey.");

        syncValidatorState(job,validator);

        stateSync=setInterval(()=>{
            if(validator){
                syncValidatorState(job,validator);
            }
        },500);

        const result=await validator.run();

        syncValidatorState(job,validator);

        const output=path.join(__dirname,"..","reports","output");
        fs.mkdirSync(output,{recursive:true});

        if(!preSalesReportGenerator||typeof preSalesReportGenerator.generatePreSalesHTML!=="function"){
            throw new Error("Pre-Sales report generator function generatePreSalesHTML was not found.");
        }

        const reportFile=await preSalesReportGenerator.generatePreSalesHTML(result,output);

        job.reportPath=`/reports/${path.basename(reportFile)}`;
        job.summary=result?.summary||null;

        if(Array.isArray(result?.pages))job.pages=result.pages;

        job.finishedAt=new Date().toISOString();

        job.status=result?.summary?.status==="FAIL"?"FAILED":"COMPLETED";

        if(job.status==="FAILED"){
            if(Array.isArray(result?.errors)&&result.errors.length){
                const lastError=result.errors[result.errors.length-1];
                job.error=lastError?.error||lastError?.message||"Pre-Sales journey failed.";
            }else{
                job.error="Pre-Sales journey failed.";
            }
        }else{
            job.error=null;
        }

        addJobLog(job,`Pre-Sales report generated: ${job.reportPath}`);
        addJobLog(job,`Pre-Sales validation finished with status ${job.status}.`);

        return result;

    }catch(error){
        const reason=error?.message||String(error);

        addJobLog(job,`Pre-Sales validation failed: ${reason}`,"ERROR");

        job.status="FAILED";
        job.error=reason;
        job.finishedAt=new Date().toISOString();

        await generateFailureReport(job,validator,reason);

        return null;

    }finally{
        if(stateSync){
            clearInterval(stateSync);
            stateSync=null;
        }

        if(validator){
            syncValidatorState(job,validator);
        }

        if(activeValidator===validator){
            activeValidator=null;
        }

        job.currentStep=job.status==="FAILED"?"Validation failed":"Validation completed";
    }
}

function isJobRunning(){
    return currentJob&&["QUEUED","RUNNING"].includes(currentJob.status);
}

app.get("/",(req,res)=>{
    res.sendFile(path.join(__dirname,"..","public","index.html"));
});

app.get("/api/health",(req,res)=>{
    res.json({
        success:true,
        status:"OK",
        service:"Adobe Analytics Validator",
        currentJob:currentJob?{id:currentJob.id,status:currentJob.status}:null
    });
});

app.post("/api/journeys",async(req,res)=>{
    const body=req.body||{};
    const created=createPreSalesJobFromBody(body);

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
            message:"Another journey is currently running. Please wait.",
            error:"Another journey is currently running. Please wait."
        });
    }

    currentJob=created.job;

    addJobLog(currentJob,"Pre-Sales Journey validation job created and queued.");

    runPreSalesJourney(currentJob).catch(error=>{
        console.error("Unexpected journey error:",error);

        if(currentJob){
            currentJob.status="FAILED";
            currentJob.finishedAt=new Date().toISOString();
            currentJob.error=error?.message||String(error);
            addJobLog(currentJob,currentJob.error,"ERROR");
        }
    });

    return res.status(202).json({
        success:true,
        message:"Pre-Sales Journey validation started.",
        jobId:currentJob.id,
        status:currentJob.status,
        startedAt:currentJob.startedAt
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
    const body=req.body||{};const mode=String(body.mode||"presales").trim().toLowerCase();
    let created,runner,message;
    if(mode==="analytics"){created=createAnalyticsJobFromBody(body);runner=runAnalyticsJob;message="Adobe Analytics validation started."}
    else if(mode==="presales"){created=createPreSalesJobFromBody(body);runner=runPreSalesJourney;message="Pre-Sales Journey validation started."}
    else return res.status(400).json({success:false,error:"Unsupported validation mode."});
    if(created.error)return res.status(400).json({success:false,error:created.error,message:created.error});
    if(isJobRunning())return res.status(409).json({success:false,error:"Another validation is currently running. Please wait.",message:"Another validation is currently running. Please wait."});
    currentJob=created.job;addJobLog(currentJob,mode==="analytics"?"Adobe Analytics validation job created and queued.":"Pre-Sales Journey validation job created and queued.");
    runner(currentJob).catch(error=>{console.error("Unexpected validation error:",error);if(currentJob){currentJob.status="FAILED";currentJob.finishedAt=new Date().toISOString();currentJob.error=error?.message||String(error);addJobLog(currentJob,currentJob.error,"ERROR")}});
    return res.status(202).json({success:true,message,jobId:currentJob.id,status:currentJob.status,startedAt:currentJob.startedAt});
});

app.get("/api/jobs/:jobId",(req,res)=>{
    const jobId=req.params.jobId;

    if(!currentJob||currentJob.id!==jobId){
        return res.status(404).json({
            success:false,
            error:"Job not found."
        });
    }

    return res.json(serializeJob(currentJob));
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
    console.log(`Web server running on port ${PORT}`);
});