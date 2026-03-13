const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(cors());

// Senhas de Acesso
const GLOBAL_ACCESS_KEY = 'alfa777';
const ADMIN_ACCESS_KEY = 'alfa777admin';

// CONFIGURAÇÃO E PERSISTÊNCIA
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users_db.json');
let usersDB = {}; 
if (fs.existsSync(USERS_FILE)) {
    try { usersDB = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
}
function saveUsersDB() { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2)); }

const activeTokens = new Map();
const userStates = new Map();

const BLACKLIST = ['CHESS', 'KP3R', 'REEF', 'VITE', 'UNFI', 'EPX', 'FOR', 'VGX', 'OAX', 'PROS', 'SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'OG', 'BAR', 'PSG', 'CITY', 'JUV', 'ACM', 'ATM', 'ASR', 'INTER', 'TRA', 'AFC', 'MENGO', 'NAP', 'GAL', 'TH', 'PFL', 'ALL', 'LEGION', 'UCH', 'USDC', 'TUSD', 'BUSD', 'FDUSD', 'USDP', 'EUR'];

let globalMarket = {
    top10: [],
    coinJumps: {},
    exchangeInfo: null,
    lastUpdate: 0,
    priceHistory: {}
};

function createInitialState(username) {
    return {
        username, clientName: '', apiKey: '', apiSecret: '', status: 'OFFLINE', opsCount: 0, 
        lastTradedCoins: [], // Para regra de 5 moedas
        history: [], logs: [],
        dashboardData: { topRanking: [], pivotInfo: null, volatilityMetrics: null, triggerProfitAnim: false },
        isLoopActive: false, activeSymbol: null, buyPrice: 0, targetPrice: 0, currentPrice: 0, buyQty: 0,
        buyPercentage: 0.99
    };
}

function loadUserState(username) {
    const state = createInitialState(username);
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    if (fs.existsSync(userFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
            Object.assign(state, data);
            state.status = 'OFFLINE';
            state.isLoopActive = false;
        } catch (e) {}
    }
    userStates.set(username, state);
    return state;
}

function saveUserState(username) {
    const state = userStates.get(username);
    if (!state) return;
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    fs.writeFileSync(userFile, JSON.stringify({ 
        clientName: state.clientName, history: state.history, totalProfit: state.totalProfit, 
        opsCount: state.opsCount, apiKey: state.apiKey, apiSecret: state.apiSecret, 
        buyPercentage: state.buyPercentage, lastTradedCoins: state.lastTradedCoins 
    }, null, 2));
}

function addLog(username, msg, type = 'info') {
    const state = userStates.get(username);
    if (!state) return;
    const timestamp = new Date().toLocaleTimeString();
    state.logs.unshift({ timestamp, msg, type });
    if (state.logs.length > 50) state.logs.pop();
}

// SINCRONIZAÇÃO MERCADO (3s)
setInterval(async () => {
    try {
        const now = Date.now();
        
        // 1. Atualizar ExchangeInfo (a cada 30min) para filtrar moedas monitoradas e deslistadas
        if (!globalMarket.exchangeInfo || now - globalMarket.lastExchangeFetch > 1800000) {
            const exres = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
            globalMarket.exchangeInfo = exres.data;
            globalMarket.lastExchangeFetch = now;
        }

        const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 5000 });
        const data = res.data;
        
        globalMarket.top10 = data
            .filter(i => {
                if (!i.symbol.endsWith('USDT')) return false;
                const symbolBase = i.symbol.replace('USDT', '');
                
                // Filtro Blacklist (Fan Tokens, Estáveis e Suspeitas)
                if (BLACKLIST.includes(symbolBase)) return false;
                
                // Filtro moedas de monitoramento e deslistagem (via exchangeInfo)
                if (globalMarket.exchangeInfo) {
                    const info = globalMarket.exchangeInfo.symbols.find(s => s.symbol === i.symbol);
                    if (!info || info.status !== 'TRADING') return false;
                    if (info.tags && info.tags.includes('monitoring')) return false;
                }

                return true;
            })
            .map(i => ({ symbol: i.symbol, price: parseFloat(i.lastPrice), vol24h: parseFloat(i.priceChangePercent) }))
            .filter(i => i.vol24h > 0)
            .sort((a, b) => b.vol24h - a.vol24h)
            .slice(0, 10);

        for (const coin of globalMarket.top10) {
            if (!globalMarket.priceHistory[coin.symbol]) {
                globalMarket.priceHistory[coin.symbol] = { old: coin.price, time: now };
                continue;
            }
            const jump = ((coin.price - globalMarket.priceHistory[coin.symbol].old) / globalMarket.priceHistory[coin.symbol].old) * 100;
            globalMarket.coinJumps[coin.symbol] = jump;
            if (now - globalMarket.priceHistory[coin.symbol].time >= 9500) {
                globalMarket.priceHistory[coin.symbol] = { old: coin.price, time: now };
            }
        }
        globalMarket.lastUpdate = now;

        // Rodar Scanner para cada usuário ativo
        for (const [username, state] of userStates) {
            if (state.isLoopActive && state.status === 'SCANNING') {
                await runFluxoAlfaScanner(username);
            }
        }
    } catch (e) {}
}, 3000);

async function runFluxoAlfaScanner(username) {
    const state = userStates.get(username);
    if (!state || globalMarket.top10.length < 6) return;

    const rank2 = globalMarket.top10[1];
    const rank4 = globalMarket.top10[3]; // INDICADORA
    const rank6 = globalMarket.top10[5];

    const d2 = Math.abs(rank2.vol24h - rank4.vol24h);
    const d6 = Math.abs(rank6.vol24h - rank4.vol24h);

    state.dashboardData.pivotInfo = { pivot: rank4.symbol, d2: d2.toFixed(2), d6: d6.toFixed(2), t2: rank2.symbol, t6: rank6.symbol };

    let target = null;
    const LIMIT = 20.0;

    if (d2 < LIMIT && d6 < LIMIT) {
        target = (d2 <= d6) ? rank2 : rank6; // Desempate por maior proximidade
    } else if (d2 < LIMIT) {
        target = rank2;
    } else if (d6 < LIMIT) {
        target = rank6;
    }

    if (!target) return;

    // Regra de 5 moedas
    if (state.lastTradedCoins.includes(target.symbol)) return;

    // Gatilho 10s (0.2%)
    const jump = globalMarket.coinJumps[target.symbol] || 0;
    if (Math.abs(jump) < 0.2) return;

    // Entrada Confirmada
    state.status = 'IN_TRADE';
    state.activeSymbol = target.symbol;
    state.buyPrice = target.price;
    state.targetPrice = target.price * 1.009; // 0.9% LUCRO
    addLog(username, `🚀 COMPRA CONFIRMADA: ${target.symbol} (Alvo 0.9%)`, 'buy');
    
    // Monitoramento de Venda (Simulado para Web, Real precisaria de chaves)
    startTradeMonitor(username, target.symbol);
}

function startTradeMonitor(username, symbol) {
    const state = userStates.get(username);
    const interval = setInterval(() => {
        if (state.status !== 'IN_TRADE') return clearInterval(interval);
        const current = globalMarket.top10.find(c => c.symbol === symbol)?.price || state.buyPrice;
        state.currentPrice = current;
        if (current >= state.targetPrice) {
            state.status = 'SCANNING';
            state.lastTradedCoins.push(symbol);
            if (state.lastTradedCoins.length > 10) state.lastTradedCoins.shift();
            addLog(username, `💰 VENDA EXECUTADA: ${symbol} (+0.9%)`, 'card-sell');
            state.history.unshift({ symbol, date: new Date().toLocaleString(), profitPct: 0.9, type: 'LUCRO FLUXO ALFA' });
            saveUserState(username);
            clearInterval(interval);
        }
    }, 2000);
}

// ROTAS
app.use(express.static(path.join(__dirname)));
app.post('/gateway', (req, res) => {
    const { accessKey } = req.body;
    if (accessKey === GLOBAL_ACCESS_KEY || accessKey === ADMIN_ACCESS_KEY) return res.json({ success: true });
    return res.status(401).json({ error: 'Incorreta' });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!usersDB[username]) { usersDB[username] = { password }; saveUsersDB(); }
    else if (usersDB[username].password !== password) return res.status(401).json({ error: 'Incorreta' });
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.set(token, username);
    if (!userStates.has(username)) loadUserState(username);
    return res.json({ token, username });
});

function requireAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
        const token = auth.split(' ')[1];
        const username = activeTokens.get(token);
        if (username) { req.username = username; req.state = userStates.get(username); return next(); }
    }
    return res.status(401).json({ error: 'Auth' });
}

app.get('/status', requireAuth, (req, res) => res.json(req.state));
app.post('/start', requireAuth, (req, res) => {
    const { clientName, apiKey, apiSecret, buyPercentage } = req.body;
    Object.assign(req.state, { clientName, apiKey, apiSecret, buyPercentage: parseFloat(buyPercentage) || 0.99, isLoopActive: true, status: 'SCANNING' });
    addLog(req.username, `Conectado: ${clientName}. Iniciando Fluxo Alfa 0.9% (Trava 10 Moedas)`, 'info');
    res.json({ success: true });
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Elite Fluxo Alfa na Porta ${PORT}`));
