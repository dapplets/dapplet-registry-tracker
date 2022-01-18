const ethers = require('ethers');
const abi = require('./abi.json');
const https = require('https');
const { Client } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const STATE_FILE_PATH = path.join(__dirname, 'state.json');
const REGISTRY_ADDRESS = '0x55627158187582228031eD8DF9893d76318D084E';

dotenv.config();

const { DISCORD_BOT_ID, DISCORD_BOT_KEY, DISCORD_CHANNEL_ID, TX_TIMESTAMP_AFTER, ETHERSCAN_API_KEY } = process.env;

function myPromise(timeout, callback) {
    return new Promise((resolve, reject) => {
        // Set up the timeout
        const timer = setTimeout(() => {
            reject(new Error(`Promise timed out after ${timeout} ms`));
        }, timeout);

        // Set up the real work
        callback().then((value) => {
            clearTimeout(timer);
            resolve(value);
        }).catch((error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

async function httpRequest(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(data).toString('utf8'))));
        }).on('error', err => reject(err.message));
    });
}

function prettifyData(arr) {
    const obj = Object.assign({}, arr);
    for (const key in obj) {
        const isNumber = !Number.isNaN(Number.parseInt(key));
        if (isNumber) {
            delete obj[key];
        } else if (typeof obj[key] === 'object') {
            obj[key] = prettifyData(obj[key]);
        }
    }
    return obj;
}

function getState() {
    if (fs.existsSync(STATE_FILE_PATH)) {
        const json = fs.readFileSync(STATE_FILE_PATH);
        return JSON.parse(json);
    } else {
        return {
            lastBlock: 0
        };
    }
}

function setState(state) {
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(STATE_FILE_PATH, json);
}

function constructMessage(tx) {
    const inter = new ethers.utils.Interface(abi);
    const parsed = inter.parseTransaction({ data: tx.input });

    switch (parsed.name) {
        case "addModuleInfo": 
            return `New module published.\n\`${parsed.args.mInfo.name}\``;
        case "addModuleVersion": 
            return `Update of \`${parsed.args.mod_name}\` is available\nv${parsed.args.vInfo.major}.${parsed.args.vInfo.minor}.${parsed.args.vInfo.patch} in ${parsed.args.vInfo.branch}`;
        case "transferOwnership": 
            return `Ownership of \`${parsed.args.mod_name}\` is transfered to \`${parsed.args.newUserId}\``;
        case "addContextId": 
            return `Context ID \`${parsed.args.contextId}\` added to \`${parsed.args.mod_name}\``;
        case "removeContextId": 
            return `Context ID \`${parsed.args.contextId}\` removed from \`${parsed.args.mod_name}\``;
        default:
            return `${parsed.name}\n\`\`\`\n${JSON.stringify(prettifyData(parsed.args), null, 2)}\n\`\`\`\ntx:${tx.hash}`;
    }
}

async function start() {
    const state = getState();

    const startBlock = state.lastBlock + 1;
    const resp = await httpRequest(`https://api-goerli.etherscan.io/api?module=account&action=txlist&address=${REGISTRY_ADDRESS}&startblock=${startBlock}&endblock=99999999&page=1&offset=1000&sort=asc&apikey=${ETHERSCAN_API_KEY}`);
    const transactions = resp.result;

    if (transactions.length === 0) {
        console.log('No transactions');
        return;
    }

    const client = new Client();
    await client.login(DISCORD_BOT_KEY);
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);

    for (const tx of transactions) {
        try {
            const message = constructMessage(tx);
            await channel.send(message);
            console.log('Message sent:\n' + message + '\n');
            setState({ lastBlock: Number(tx.blockNumber) });
        } catch (err) {
            console.error(err);
        }
    }
}

myPromise(45000, () => start())
    .then(() => {
        console.log('done');
        process.exit();
    })
    .catch((e) => {
        console.log(e);
        process.exit();
    });