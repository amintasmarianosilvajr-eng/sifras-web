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

// --- STATE ---
let globalMarket = { top30: [], allTickersMap: new Map() };
let binanceWS = null;
let lastWsMessage = Date.now();
let userStates = {};

// --- CONFIG & AUTH ---
const ADMIN_TOKEN = "ALFA_SECRET_2026"; 
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

if (fs.existsSync(USERS_FILE)) {
    try {
        userStates = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        console.error("Erro ao carregar users.json:", e.message);
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(userStates, null, 2));
    } catch (e) {
        console.error("Erro ao salvar users.json:", e.message);
    }
}

// Redirecionamento HTTPS/WWW
app.use((req, res, next) => {
    // SÓ REDIRECIONA NAVEGAÇÃO (GET). Não pode redirecionar POST (Heartbeat) ou vai perder os dados e falhar a aprovação.
    if (req.method !== 'GET') return next();

    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;

    if (host === 'fluxoalfafinance.online') {
        return res.redirect(301, `https://www.fluxoalfafinance.online${req.url}`);
    }
    if (protocol === 'http' && host !== 'localhost' && !host.includes('127.0.0.1')) {
        return res.redirect(301, `https://${host}${req.url}`);
    }
    next();
});

// --- ROTAS DE PÁGINAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/operacional', (req, res) => res.sendFile(path.join(__dirname, 'operacional.html')));
app.get('/leads', (req, res) => res.sendFile(path.join(__dirname, 'leads.html')));
app.get('/ADMIN', (req, res) => res.redirect('/admin'));
app.get('/OPERACIONAL', (req, res) => res.redirect('/operacional'));

app.use(express.static(path.join(__dirname, './')));

// Fallback REST para Binance
async function fetchBinanceFallback() {
    try {
        const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 5000 });
        const tickers = response.data;
        const usdtTickers = tickers
            .filter(t => t.symbol.endsWith('USDT'))
            .map(t => ({
                symbol: t.symbol,
                price: parseFloat(t.lastPrice),
                vol: parseFloat(t.priceChangePercent),
                quoteVol: parseFloat(t.quoteVolume)
            }))
            .filter(t => !['USDC','FDUSD','TUSD','EUR','TRY','BRL','DAI','PAXG'].some(s => t.symbol.includes(s)))
            .sort((a,b) => b.vol - a.vol);

        if (usdtTickers.length > 0) {
            globalMarket.top30 = usdtTickers.slice(0, 30);
            usdtTickers.forEach(t => globalMarket.allTickersMap.set(t.symbol, t.price));
            console.log(`✅ Fallback REST: ${globalMarket.top30.length} moedas.`);
        }
    } catch (e) {
        console.error("REST Fallback Error:", e.message);
    }
}

function startBinanceWS() {
    try {
        if (binanceWS) binanceWS.terminate();
        binanceWS = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');
        binanceWS.on('message', (data) => {
            try {
                lastWsMessage = Date.now();
                const tickers = JSON.parse(data);
                const usdtTickers = tickers
                    .filter(t => t.s.endsWith('USDT'))
                    .map(t => ({
                        symbol: t.s,
                        price: parseFloat(t.c),
                        vol: parseFloat(t.P),
                        quoteVol: parseFloat(t.q)
                    }))
                    .filter(t => !['USDC','FDUSD','TUSD','EUR','TRY','BRL','DAI','PAXG'].some(s => t.symbol.includes(s)))
                    .sort((a,b) => b.vol - a.vol);
                    
                if (usdtTickers.length > 0) {
                    globalMarket.top30 = usdtTickers.slice(0, 30);
                    usdtTickers.forEach(t => globalMarket.allTickersMap.set(t.symbol, t.price));
                }
            } catch (e) {}
        });
        binanceWS.on('error', (e) => {
            console.error("WS ERROR:", e.message);
            setTimeout(startBinanceWS, 5000);
        });
        binanceWS.on('close', () => setTimeout(startBinanceWS, 5000));
    } catch (e) {
        setTimeout(startBinanceWS, 5000);
    }
}

// Endpoints
app.get('/moedas-ranking', async (req, res) => {
    if (globalMarket.top30.length === 0 || (Date.now() - lastWsMessage > 15000)) {
        await fetchBinanceFallback();
    }
    res.json(globalMarket.top30);
});

app.post('/register', (req, res) => {
    let { name, email, experience, whatsapp } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Dados incompletos' });
    
    // Normalização Anti-Erro
    const finalName = name.trim().toUpperCase();
    
    userStates[finalName] = { 
        username: finalName, email, experience, whatsapp, 
        isApproved: false, status: 'OFFLINE', lastSeen: Date.now(), 
        registrationDate: new Date().toISOString() 
    };
    saveUsers();
    res.json({ success: true });
});

app.post('/heartbeat', (req, res) => {
    const { username, state } = req.body;
    if (!username) return res.status(400).json({ error: 'Inválido' });
    
    const finalName = username.trim().toUpperCase();
    const user = userStates[finalName] || { isApproved: false };
    
    userStates[finalName] = { 
        ...userStates[finalName], 
        ...state, 
        username: finalName, 
        lastSeen: Date.now(), 
        isApproved: user.isApproved 
    };
    
    const shouldStop = userStates[finalName].remoteCommand === 'STOP';
    if (shouldStop) userStates[finalName].remoteCommand = null;
    
    res.json({ 
        success: true, 
        command: shouldStop ? 'STOP' : null, 
        isApproved: !!userStates[finalName].isApproved 
    });
});

// Admin
const authAdmin = (req, res, next) => {
    if (req.headers['authorization'] === `Bearer ${ADMIN_TOKEN}`) return next();
    res.status(401).json({ error: 'Negado' });
};

app.get('/admin/overview', authAdmin, (req, res) => {
    const users = Object.values(userStates).map(u => ({ ...u, online: (Date.now() - (u.lastSeen || 0)) < 15000 }));
    res.json({ users, serverUptime: process.uptime(), globalPivot: globalMarket.top30[9]?.symbol || '---', serverIp: req.headers['x-forwarded-for'] || 'Cloud' });
});

app.post('/admin/approve-user', authAdmin, (req, res) => {
    const { targetUser } = req.body;
    const finalName = targetUser.trim().toUpperCase();
    if (userStates[finalName]) { 
        userStates[finalName].isApproved = true; 
        saveUsers(); 
        res.json({ success: true }); 
    }
    else res.status(404).json({ error: 'Not found' });
});

app.post('/admin/block-user', authAdmin, (req, res) => {
    const { targetUser } = req.body;
    const finalName = targetUser.trim().toUpperCase();
    if (userStates[finalName]) { 
        userStates[finalName].isApproved = false; 
        saveUsers(); 
        res.json({ success: true }); 
    }
    else res.status(404).json({ error: 'Not found' });
});

app.post('/admin/delete-user', authAdmin, (req, res) => {
    const { targetUser } = req.body;
    const finalName = targetUser.trim().toUpperCase();
    delete userStates[finalName];
    saveUsers();
    res.json({ success: true });
});

app.post('/admin/reset-all-users', authAdmin, (req, res) => {
    userStates = {}; saveUsers(); res.json({ success: true });
});

app.post('/pnl-real', async (req, res) => {
    const { key, secret } = req.body;
    if (!key || !secret) return res.status(400).json({ error: 'Faltam credenciais' });
    try {
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}&recvWindow=10000`;
        const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
        const r = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, { headers: { 'X-MBX-APIKEY': key } });
        const balances = r.data.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0);
        let totalUsdt = 0;
        for (const b of balances) {
            const amount = parseFloat(b.free) + parseFloat(b.locked);
            if (b.asset === 'USDT') { totalUsdt += amount; }
            else {
                const pair = b.asset + 'USDT';
                const price = globalMarket.allTickersMap.get(pair);
                if (price) totalUsdt += amount * price;
            }
        }
        res.json({ totalUsdt });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/executar-ordem', async (req, res) => {
    const { key, secret, symbol, side, qty } = req.body;
    try {
        const timestamp = Date.now();
        const query = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${qty}&timestamp=${timestamp}&recvWindow=10000`;
        const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
        const response = await axios.post(`https://api.binance.com/api/v3/order?${query}&signature=${signature}`, null, { headers: { 'X-MBX-APIKEY': key } });
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: e.response?.data || e.message }); }
});

app.get('/info-par', async (req, res) => {
    try {
        const r = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${req.query.symbol}`);
        res.json(r.data);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 ALFA MASTER ELITE na Porta ${PORT}`);
    startBinanceWS();
});
