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

// Servir arquivos estáticos (HTML, CSS, JS, Imagens)
app.use(express.static(path.join(__dirname, './')));

// Rota para o Robô Operacional (Acesso Direto)
app.get('/operacional', (req, res) => {
    res.sendFile(path.join(__dirname, 'operacional.html'));
});

// Rota raiz também aponta para o Operacional por segurança
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'operacional.html'));
});

// --- DATABASE & STATE ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let globalMarket = { top30: [], allTickersMap: new Map() };
let binanceWS = null;

// --- BINANCE ORDER SIGNING (HMAC-SHA256) ---
function signRequest(params, secret) {
    return crypto.createHmac('sha256', secret).update(params).digest('hex');
}

// --- BINANCE MARKET MOTOR (RANKING & PRICES) ---
function startBinanceWS() {
    if (binanceWS) binanceWS.terminate();
    binanceWS = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');

    binanceWS.on('message', (data) => {
        const tickers = JSON.parse(data);
        const usdtTickers = tickers
            .filter(t => t.s.endsWith('USDT'))
            .map(t => ({
                symbol: t.s,
                price: parseFloat(t.c),
                vol: parseFloat(t.P),
                quoteVol: parseFloat(t.q)
            }))
            .filter(t => t.quoteVol > 1000000) // Mínimo de 1M volume em 24h
            .filter(t => !['USDC','FDUSD','TUSD','EUR','TRY','BRL','DAI','PAXG'].some(s => t.symbol.includes(s)))
            .sort((a,b) => b.vol - a.vol);

        globalMarket.top30 = usdtTickers.slice(0, 30);
        
        // Cache global de preços para o conversor de saldo
        usdtTickers.forEach(t => globalMarket.allTickersMap.set(t.symbol, t.price));
    });

    binanceWS.on('error', () => setTimeout(startBinanceWS, 5000));
}

// --- ENDPOINTS OPERACIONAIS ---

// 1. Ranking para o Frontend
app.get('/moedas-ranking', (req, res) => {
    res.json(globalMarket.top30);
});

// 2. Cálculo de PNL Real Assinado (Binance -> Backend -> Frontend)
app.post('/pnl-real', async (req, res) => {
    const { key, secret } = req.body;
    if (!key || !secret) return res.status(400).json({ error: 'Faltam credenciais' });

    try {
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}&recvWindow=10000`;
        const signature = signRequest(query, secret);
        
        const response = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': key }
        });

        const balances = response.data.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0);
        let totalUsdt = 0;

        for (const b of balances) {
            const amount = parseFloat(b.free) + parseFloat(b.locked);
            if (b.asset === 'USDT') {
                totalUsdt += amount;
            } else {
                const pair = b.asset + 'USDT';
                const price = globalMarket.allTickersMap.get(pair);
                if (price) totalUsdt += amount * price;
            }
        }
        res.json({ totalUsdt });
    } catch (error) {
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// 3. Proxy de Ordens (Blindagem da API Key no Frontend)
app.post('/executar-ordem', async (req, res) => {
    const { key, secret, symbol, side, qty, type } = req.body;
    if (!key || !secret) return res.status(400).json({ error: 'Faltam credenciais' });

    try {
        const timestamp = Date.now();
        const params = { symbol, side, type, timestamp, recvWindow: 10000 };

        if (side === 'BUY') {
            // BUSCAR SALDO USDT REAL
            const qAcc = `timestamp=${timestamp}&recvWindow=10000`;
            const sAcc = signRequest(qAcc, secret);
            const aRes = await axios.get(`https://api.binance.com/api/v3/account?${qAcc}&signature=${sAcc}`, {
                headers: { 'X-MBX-APIKEY': key }
            });
            const usdt = aRes.data.balances.find(b => b.asset === 'USDT');
            const free = parseFloat(usdt ? usdt.free : 0);
            
            if (free < 10) throw new Error(`Saldo USDT Insuficiente ($${free.toFixed(2)})`);

            // BUSCAR PREÇO ATUAL DA MOEDA (PARA CALCULAR QTY)
            const pRes = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            const price = parseFloat(pRes.data.price);
            
            // Calcular: (Saldo * 0.98 para taxas/seguranca) / Preco
            const calculatedQty = (free * 0.98) / price;
            
            // Arredondamento agressivo (4 decimais) para passar no filtro da Binance
            params.quantity = calculatedQty.toFixed(4);
        } else {
            // VENDA: Usa a quantidade passada pelo front (qty)
            params.quantity = qty;
        }

        const queryString = new URLSearchParams(params).toString();
        const signature = signRequest(queryString, secret);
        const finalUrl = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;

        const response = await axios.post(finalUrl, {}, {
            headers: { 'X-MBX-APIKEY': key }
        });
        res.json(response.data);
    } catch (error) {
        const msg = error.response?.data?.msg || error.message;
        console.error("Order Fail:", msg);
        res.status(500).json({ error: msg });
    }
});

// 4. Proxy de Informações de Lote (ExchangeInfo)
app.get('/info-par', async (req, res) => {
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
    console.log(`🚀 ALFA MASTER ELITE na Porta ${PORT}`);
    startBinanceWS();
});
