const ethers = require('ethers');
const abi = require('./abi.json');
const https = require('https');
const { Client } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const { DISCORD_BOT_ID, DISCORD_BOT_KEY, DISCORD_CHANNEL_ID, TX_TIMESTAMP_AFTER, ETHERSCAN_API_KEY } = process.env;

function myPromise(timeout, callback) {
    return new Promise((resolve, reject) => {
        // Set up the timeout
        const timer = setTimeout(() => {
            reject(new Error(`Promise timed out after ${timeout} ms`));
        }, timeout);

        // Set up the real work
        callback(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
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

async function start() {
    const resp = await httpRequest(`https://api-rinkeby.etherscan.io/api?module=account&action=txlist&address=0xb76b02b35ad7cb71e2061056915e521e8f05c130&startblock=0&endblock=99999999&page=1&offset=1000&sort=asc&apikey=${ETHERSCAN_API_KEY}`);
    const inter = new ethers.utils.Interface(abi);
    const client = new Client();
    await client.login(DISCORD_BOT_KEY);
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    const rawMessages = await channel.messages.fetch({ limit: 50 });
    const botMessages = Array.from(rawMessages.values())
        .filter(x => x.author.id === DISCORD_BOT_ID)
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    const lastBotMessageTxHash = /tx:(0x[0-9a-fA-F]{64})/gm.exec(botMessages[0]?.content ?? '')?.[1];

    const transactions = resp.result.filter(x => x.timeStamp >= Number(TX_TIMESTAMP_AFTER));

    let skip = true;
    for (const tx of transactions) {
        if (!lastBotMessageTxHash || !skip) {
            try {
                const parsed = inter.parseTransaction({ data: tx.input });
                const message = `Registry Tracker\n${parsed.name}\n\`\`\`\n${JSON.stringify(prettifyData(parsed.args), null, 2)}\n\`\`\`\ntx:${tx.hash}`;
                await channel.send(message);
            } catch (err) {
                console.error(err);
            }
        } else {
            console.log('skip ' + tx.hash);
        }

        if (tx.hash.toLowerCase() === lastBotMessageTxHash.toLowerCase()) {
            skip = false;
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