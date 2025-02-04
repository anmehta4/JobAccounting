const esClient = require('./client');
var cal = require('mathjs');
let indexList;
let jobList = [];
let userList = {};
let scheddList = {};
let userHourList = {};
let userMemoryList = {};
let scheddHourList = {};
let scheddMemoryList = {};
let finalUserList = {};
let finalScheddList = {};
let printUserList = {};
let printScheddList = {};
let unsortUserList = {};
let unsortScheddList = {};
let removelist = {}

// Check the memory size
const v8 = require('v8');
const totalHeapSize = v8.getHeapStatistics().total_available_size;
const totalHeapSizeGb = (totalHeapSize / 1024 / 1024 / 1024).toFixed(2);
console.log('totalHeapSizeGb: ', totalHeapSizeGb);

// This function query the data from elastic search and store into an array
async function search(indexName, input_date) {
    let response =  await esClient.search({
        index: indexName,
        scroll: "10s",
        size: 1000,
        body: {

            
            'query': {
                    range : {
                        "CompletionDate" : {
                            "gte" : (new Date(input_date + " CST").setHours(0,0,0,0)) / 1000 ,
                            "lte" : (new Date(input_date + " CST").setHours(23,59,59,0)) / 1000,
                        }
                    }
                } 
        }
    })
    let tempJobList = response.hits.hits;
    let jobListLength = jobList.length + response.hits.total.value;
    for (let curr of tempJobList) {
        jobList.push(curr);
    }
    while (jobList.length < jobListLength) {
        response = await esClient.scroll({
            scrollId: response._scroll_id,
            scroll: '10s',
        })
        tempJobList = response.hits.hits;
        for (let curr of tempJobList) {
            jobList.push(curr);
        }
    }
    console.log(indexName,jobList.length)

};

// Main Function
async function runPass() {
    await search('chtc-' + process.argv[2], process.argv[2]);
    await processResult(jobList);
    await exportResult()
}
runPass()

// Function for changing the format of hours
function getHours(input_hours) {
    let decimalTime = input_hours * 60 * 60;
    let hours = Math.floor((decimalTime / (60 * 60)));
    decimalTime = decimalTime - (hours * 60 * 60);
    let minutes = Math.floor((decimalTime / 60));
    decimalTime = decimalTime - (minutes * 60);
    let seconds = Math.round(decimalTime);
    if(hours < 10)
    {
        hours = "0" + hours;
    }
    if(minutes < 10)
    {
        minutes = "0" + minutes;
    }
    if(seconds < 10)
    {
        seconds = "0" + seconds;
    }
    return ("" + hours + ":" + minutes);
} 

// Traverse the joblist and retrieve the information that we need 
async function processResult(jobList){
    jobList.forEach(element => {
        let currObs = element._source;

        if (typeof currObs.RequestGpus !== 'undefined' && currObs.RequestGpus != 0) {
        
            if (typeof userList[currObs.User] === 'undefined') {
                let content = {};
                let currHour = [];
                let currMemory = [];
                content.CommittedCoreHr = currObs.CommittedCoreHr;
                content.CoreHr = currObs.CoreHr;
                content.Jobs = 1;
                content.RequestMemory = typeof currObs.RequestMemory === 'undefined' ? 0 : currObs.RequestMemory;
                content.RequestCpus = typeof currObs.RequestCpus === 'undefined' ? 0 : currObs.RequestCpus;
                if (currObs.CompletionDate - currObs.JobCurrentStartDate < 60) {
                    content.ShortJobStarts = 1;
                } else {
                    content.ShortJobStarts = 0;
                }
                content.NumJobStarts = currObs.NumJobStarts;
                content.RequestGpus = currObs.RequestGpus;
                content.NumShadowStarts = typeof currObs.NumShadowStarts === 'undefined' ? 0 : currObs.NumShadowStarts;
                
                content.JobGpus =  typeof currObs.JobGpus === 'undefined' ? 0 : currObs.JobGpus;
                content.ScheddName = currObs.ScheddName;
                content.Schedd = currObs.ScheddName.split('.')[1];
                
                
                if (typeof currObs.WallClockHr !== 'undefined') {
                    content.WallClockHr = currObs.WallClockHr ;
                    currHour.push(currObs.WallClockHr  );
                    
                }
                if (typeof currObs.MemoryUsage !== 'undefined') {
                    currMemory.push(currObs.MemoryUsage);
                }
                userMemoryList[currObs.User] = currMemory;
                userHourList[currObs.User] = currHour;
                userList[currObs.User] = content;

            } else {
                let content = userList[currObs.User];
                let currHour = userHourList[currObs.User];
                let currMemory = userMemoryList[currObs.User];
                content.Jobs += 1;
                content.NumJobStarts += currObs.NumJobStarts;
                content.CoreHr += currObs.CoreHr;
                content.CommittedCoreHr += currObs.CommittedCoreHr;
                content.RequestGpus = Math.max(content.RequestGpus, currObs.RequestGpus);
                content.JobGpus = Math.max(content.JobGpus, typeof currObs.JobGpus === 'undefined' ? 0 : currObs.JobGpus);
                content.RequestCpus = Math.max(content.RequestCpus, typeof currObs.RequestCpus === 'undefined' ? 0 : currObs.RequestCpus);
                content.RequestMemory = Math.max(content.RequestMemory, typeof currObs.RequestMemory === 'undefined' ? 0 : currObs.RequestMemory);
                if (currObs.CompletionDate - currObs.JobCurrentStartDate < 60) {
                    content.ShortJobStarts ++;
                } 
                content.NumShadowStarts += typeof currObs.NumShadowStarts === 'undefined' ? 0 : currObs.NumShadowStarts;
                
                if (typeof currObs.WallClockHr !== 'undefined') {
                    content.WallClockHr += currObs.WallClockHr ;
                    currHour.push(currObs.WallClockHr );
                    userHourList[currObs.User] = currHour;
                }
                if (typeof currObs.MemoryUsage !== 'undefined') {
                    currMemory.push(currObs.MemoryUsage);
                    userMemoryList[currObs.User] = currMemory;
                }
                userList[currObs.User] = content;
            }
            if (typeof scheddList[currObs.ScheddName] === 'undefined') {
                let content = {};
                let currHour = [];
                let currMemory = [];
                content.CommittedCoreHr = currObs.CommittedCoreHr;
                content.CoreHr = currObs.CoreHr;
                content.Jobs = 1;
                content.RequestMemory = typeof currObs.RequestMemory === 'undefined' ? 0 : currObs.RequestMemory;
                content.RequestGpus = currObs.RequestGpus;
                content.JobGpus =  typeof currObs.JobGpus === 'undefined' ? 0 : currObs.JobGpus;
                content.RequestCpus = typeof currObs.RequestCpus === 'undefined' ? 0 : currObs.RequestCpus;
                if (currObs.CompletionDate - currObs.JobCurrentStartDate < 60) {
                    content.ShortJobStarts = 1;
                } else {
                    content.ShortJobStarts = 0;
                }
                content.NumJobStarts = currObs.NumJobStarts;
                content.NumShadowStarts = typeof currObs.NumShadowStarts === 'undefined' ? 0 : currObs.NumShadowStarts;
                
                
                if (typeof currObs.WallClockHr !== 'undefined') {
                    content.WallClockHr = currObs.WallClockHr ;
                    currHour.push(currObs.WallClockHr );
                }
                scheddHourList[currObs.ScheddName] = currHour;
                if (typeof currObs.MemoryUsage !== 'undefined') {
                    currMemory.push(currObs.MemoryUsage);
                }
                scheddMemoryList[currObs.ScheddName] = currMemory;
                scheddList[currObs.ScheddName] = content;

            } else {
                let content = scheddList[currObs.ScheddName];
                let currHour = scheddHourList[currObs.ScheddName];
                let currMemory = scheddMemoryList[currObs.ScheddName];
                content.Jobs += 1;
                content.NumJobStarts += currObs.NumJobStarts;
                content.CoreHr += currObs.CoreHr;
                content.CommittedCoreHr += currObs.CommittedCoreHr;
                content.RequestCpus = Math.max(content.RequestCpus, typeof currObs.RequestCpus === 'undefined' ? 0 : currObs.RequestCpus);
                content.RequestGpus = Math.max(content.RequestGpus, currObs.RequestGpus);
                content.JobGpus = Math.max(content.JobGpus, typeof currObs.JobGpus === 'undefined' ? 0 : currObs.JobGpus);
                content.RequestMemory = Math.max(content.RequestMemory, typeof currObs.RequestMemory === 'undefined' ? 0 : currObs.RequestMemory);
                if (currObs.CompletionDate - currObs.JobCurrentStartDate < 60) {
                    content.ShortJobStarts ++;
                } 
                content.NumShadowStarts  += typeof currObs.NumShadowStarts === 'undefined' ? 0 : currObs.NumShadowStarts;
                
                if (typeof currObs.WallClockHr !== 'undefined') {
                    content.WallClockHr += currObs.WallClockHr ;
                    currHour.push(currObs.WallClockHr );
                    scheddHourList[currObs.ScheddName] = currHour;
                }  
                if (typeof currObs.MemoryUsage !== 'undefined') {
                    currMemory.push(currObs.MemoryUsage);
                    scheddMemoryList[currObs.User] = currMemory;
                }
                scheddList[currObs.ScheddName] = content;
            }
        }
            


    });



    Object.entries(userList).forEach(([key, value]) => {
        let currUser = {};
        currUser["Completed Hours"] = Math.round(value.CommittedCoreHr);
        currUser["Used Hours"] = Math.round(value.CoreHr);
        currUser["Uniq Job Ids"] = value.Jobs;
        currUser["Request Mem"] = Math.round(value.RequestMemory);
        let currMemory = userMemoryList[key];
        currMemory.sort(function(a,b){return a - b});
        let median_index = Math.floor(currMemory.length / 2);
        
        currUser["Used Mem"] = Math.round((currMemory.length % 2 !== 0  ? currMemory[median_index] :  (currMemory[median_index - 1] + currMemory[median_index]) / 2));
        currUser["Max Mem"] = Math.round(currMemory[currMemory.length - 1]);

        if (Number.isNaN(currUser["Used Mem"])) {
            currUser["Used Mem"] = 0;
        }
        if (Number.isNaN(currUser["Max Mem"])) {
            currUser["Max Mem"] = 0;
        }

        currUser["Request Cpus"] = value.RequestCpus;
        currUser["Request Gpus"] = value.RequestGpus;
        currUser["Short Jobs"] = value.ShortJobStarts;
        currUser["All Jobs"] = value.NumJobStarts;
        currUser["NumShadowStarts"] = value.NumShadowStarts;
        let currHour = userHourList[key];
        currHour.sort(function(a,b){return a - b});
        median_index = Math.floor(currHour.length / 2);
        currUser["Min"]  = getHours(currHour[0]);
        let per25 = (Math.floor(currHour.length*.25) - 1) >= 0 ? Math.floor(currHour.length*.25) - 1 : 0;
        currUser["25%"] = getHours(currHour[per25]);
        currUser["Median"] = getHours((currHour.length % 2 !== 0  ? currHour[median_index] :  (currHour[median_index - 1] + currHour[median_index]) / 2));


        let per75 = (Math.floor(currHour.length*.75) - 1) >= 0 ? Math.floor(currHour.length*.75) - 1 : 0;
        currUser["75%"] = getHours(currHour[per75]);
        currUser["Max"] = getHours(currHour[currHour.length - 1]);
        currUser["Mean"] = getHours((value.WallClockHr / currHour.length));
        currUser["Std"] = getHours(cal.std(currHour));
        currUser["ScheddName"] = value.ScheddName;
        currUser["Schedd"] = value.Schedd;

        unsortUserList[key] = currUser;
    })
    Object.entries(scheddList).forEach(([key, value]) => {
        let currSchedd = {};
        currSchedd["Completed Hours"] = Math.round(value.CommittedCoreHr);
        currSchedd["Used Hours"] = Math.round(value.CoreHr);
        currSchedd["Uniq Job Ids"] = value.Jobs;
        currSchedd["Request Mem"] = Math.round(value.RequestMemory);
        let currMemory = scheddMemoryList[key];
        currMemory.sort(function(a,b){return a - b});
        let median_index = Math.floor(currMemory.length / 2);
        
        currSchedd["Used Mem"] = Math.round((currMemory.length % 2 !== 0  ? currMemory[median_index] :  (currMemory[median_index - 1] + currMemory[median_index]) / 2));
        currSchedd["Max Mem"] = Math.round(currMemory[currMemory.length - 1]);

        if (Number.isNaN(currSchedd["Used Mem"])) {
            currSchedd["Used Mem"] = 0;
        }
        if (Number.isNaN(currSchedd["Max Mem"])) {
            currSchedd["Max Mem"] = 0;
        }

        currSchedd["Request Cpus"] = value.RequestCpus;
        currSchedd["Short Jobs"] = value.ShortJobStarts;
        currSchedd["All Jobs"] = value.NumJobStarts;
        currSchedd["NumShadowStarts"] = value.NumShadowStarts;
        currSchedd["Request Gpus"] = value.RequestGpus;
        let currHour = scheddHourList[key];
        currHour.sort(function(a,b){return a - b});
        median_index = Math.floor(currHour.length / 2);
        currSchedd["Min"]  = getHours(currHour[0]);
        let per25 = (Math.floor(currHour.length*.25) - 1) >= 0 ? Math.floor(currHour.length*.25) - 1 : 0;
        currSchedd["25%"] = getHours(currHour[per25]);
        currSchedd["Median"] = getHours((currHour.length % 2 !== 0  ? currHour[median_index] :  (currHour[median_index - 1] + currHour[median_index]) / 2));
        let per75 = (Math.floor(currHour.length*.75) - 1) >= 0 ? Math.floor(currHour.length*.75) - 1 : 0;
        currSchedd["75%"] = getHours(currHour[per75]);
        currSchedd["Max"] = getHours(currHour[currHour.length - 1]);
        currSchedd["Mean"] = getHours((value.WallClockHr / currHour.length));
        currSchedd["Std"] = getHours(cal.std(currHour));

        unsortScheddList[key] = currSchedd;
    })


    Object.keys(unsortUserList).sort(function(a,b){
        return unsortUserList[b]["Completed Hours"] - unsortUserList[a]["Completed Hours"]
    }).forEach(function(k){
        finalUserList[k]=unsortUserList[k]
    });
    
    
    Object.keys(unsortScheddList).sort(function(a,b){
        return unsortScheddList[b]["Completed Hours"] - unsortScheddList[a]["Completed Hours"]
    }).forEach(function(k){
        finalScheddList[k]=unsortScheddList[k]
    });


    


    Object.entries(finalUserList).forEach(([key, value]) => {
        let currUser = JSON.parse(JSON.stringify(value));
        currUser["Completed Hours"] = currUser["Completed Hours"].toLocaleString();
        currUser["Used Hours"] = currUser["Used Hours"].toLocaleString();
        currUser["Uniq Job Ids"] = currUser["Uniq Job Ids"].toLocaleString();
        currUser["Request Mem"] = currUser["Request Mem"].toLocaleString();

        currUser["Used Mem"] = currUser["Used Mem"].toLocaleString();
        currUser["Max Mem"] = currUser["Max Mem"].toLocaleString();

        currUser["Request Cpus"] = currUser["Request Cpus"].toLocaleString();
        currUser["Short Jobs"] = currUser["Short Jobs"].toLocaleString();
        currUser["All Jobs"] = currUser["All Jobs"].toLocaleString();
        currUser["NumShadowStarts"] = currUser["NumShadowStarts"].toLocaleString();
        currUser["Request Gpus"] = currUser["Request Gpus"].toLocaleString();

        printUserList[key] = currUser;
    })


    Object.entries(finalScheddList).forEach(([key, value]) => {

        let currSchedd = JSON.parse(JSON.stringify(value));
        currSchedd["Completed Hours"] = currSchedd["Completed Hours"].toLocaleString();
        currSchedd["Used Hours"] = currSchedd["Used Hours"].toLocaleString();
        currSchedd["Uniq Job Ids"] = currSchedd["Uniq Job Ids"].toLocaleString();
        currSchedd["Request Mem"] = currSchedd["Request Mem"].toLocaleString();

        currSchedd["Used Mem"] = currSchedd["Used Mem"].toLocaleString();
        currSchedd["Max Mem"] = currSchedd["Max Mem"].toLocaleString();

        currSchedd["Request Cpus"] = currSchedd["Request Cpus"].toLocaleString();
        currSchedd["Short Jobs"] = currSchedd["Short Jobs"].toLocaleString();
        currSchedd["All Jobs"] = currSchedd["All Jobs"].toLocaleString();
     
        currSchedd["NumShadowStarts"] = currSchedd["NumShadowStarts"].toLocaleString();
        currSchedd["Request Gpus"] = currSchedd["Request Gpus"].toLocaleString();
        printScheddList[key] = currSchedd;
    })




   
}

// Generate the result in json
async function exportResult() {
    var fs = require('fs');
    let userFile = JSON.stringify(finalUserList);
    fs.writeFile('userGpuStats.json', userFile, 'utf8', (err) => {
        if (err) {
            console.error(err);
            return;
        };
        console.log("File has been created");
    });
    let scheddFile = JSON.stringify(finalScheddList);
    fs.writeFile('scheddGpuStats.json', scheddFile, 'utf8', (err) => {
        if (err) {
            console.error(err);
            return;
        };
        console.log("File has been created");
    });

    let userPrintFile = JSON.stringify(printUserList);
    fs.writeFile('userGpuPrintStats.json', userPrintFile, 'utf8', (err) => {
        if (err) {
            console.error(err);
            return;
        };
        console.log("File has been created");
    });
    let scheddPrintFile = JSON.stringify(printScheddList);
    fs.writeFile('scheddGpuPrintStats.json', scheddPrintFile, 'utf8', (err) => {
        if (err) {
            console.error(err);
            return;
        };
        console.log("File has been created");
    });
}




  

