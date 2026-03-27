const express = require('express');
const cors = require('cors');    
const crypto = require('crypto');
const axios = require('axios');  
const WebSocket = require('ws'); 
const fs = require('fs');        
const path = require('path');    

const app = express();
app.use(express.json());
app.use(cors());

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, './')));

app.get('/operacional', (req, res) => {
    res.sendFile(path.join(__dirname, 'operacional.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'operacional.html'));
});

// --- DATABASE & STATE ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let globalMarket = { top30: [], allTickersMap: new Map() };

app.get('/moedas-ranking', (req, res) => {
    res.json(globalMarket.top30);
});

function signRequest(params, secret) {
    return crypto.createHmac('sha256', secret).update(params).digest('hex');
}

function startBinanceWS() {
    console.log("Iniciando WebSocket Binance...");
    const ws = new WebSocket("wss://stream.binance.com:9443/ws/!ticker@arr");

    ws.on("message", (data) => {
        try {
            const tickers = JSON.parse(data);
            if (!Array.isArray(tickers)) return;

            const list = tickers
                .filter(t => t.s.endsWith("USDT") && parseFloat(t.q) > 1000000)
                .map(t => ({
                    symbol: t.s,
                    vol: parseFloat(t.P),
                    quoteVol: parseFloat(t.q)
                }))
                .sort((a, b) => b.vol - a.vol)
                .slice(0, 30);

            if (list.length > 0) globalMarket.top30 = list;
        } catch (e) {
            console.error("Erro no processamento do WebSocket:", e.message);
        }
    });

    ws.on("error", (err) => {
        console.error("Erro no WebSocket:", err.message);
        setTimeout(startBinanceWS, 5000);
    });

    ws.on("close", () => {
        console.log("WebSocket fechado, reconectando...");
        setTimeout(startBinanceWS, 5000);
    });
}

app.post('/ordem', async (req, res) => {
    const { key, secret, symbol, side, qty } = req.body;
    const timestamp = Date.now();
    let params = { symbol, side, type: 'MARKET', timestamp, recvWindow: 10000 };

    try {
        if (side === 'BUY') {
            const qAcc = `timestamp=${timestamp}&recvWindow=10000`;
            const sAcc = signRequest(qAcc, secret);
            const aRes = await axios.get(`https://api.binance.com/api/v3/account?${qAcc}&signature=${sAcc}`, {
                headers: { 'X-MBX-APIKEY': key }
            });
            const usdt = aRes.data.balances.find(b => b.asset === 'USDT');
            const free = parseFloat(usdt ? usdt.free : 0);

            if (free < 10) throw new Error(`Saldo USDT Insuficiente ($${free.toFixed(2)})`);

            const iRes = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`);
            const filters = iRes.data.symbols[0].filters;
            const lSize = filters.find(f => f.filterType === 'LOT_SIZE');
            const pRes = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            const price = parseFloat(pRes.data.price);

            const step = parseFloat(lSize.stepSize);
            const calculatedQty = (free * 0.99) / price;
            params.quantity = (Math.floor(calculatedQty / step) * step).toFixed(8).replace(/\.?0+$/, "");
        } else {
            params.quantity = qty;
        }

        const queryString = new URLSearchParams(params).toString();
        const signature = signRequest(queryString, secret);
        const finalUrl = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;

        const response = await axios.post(finalUrl, null, {
            headers: { 'X-MBX-APIKEY': key }
        });
        res.json(response.data);
    } catch (error) {
        const msg = error.response?.data?.msg || error.message;
        console.error("Order Fail:", msg);
        res.status(500).json({ error: msg });
    }
});

app.get("/info-par", async (req, res) => {
    const symbol = req.query.symbol;
    try {
        const response = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => {
    console.log('MOTOR LIGADO NA PORTA: ' + PORT);
    if (typeof startBinanceWS === 'function') startBinanceWS();
});
