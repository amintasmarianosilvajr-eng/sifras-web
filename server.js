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
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users_db.json');
let usersDB = {}; 
if (fs.existsSync(USERS_FILE)) {
    try { usersDB = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
}
function saveUsersDB() { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2)); }

const activeTokens = new Map();
const userStates = new Map();

// Blacklist Expandida (Times, Estáveis, Suspeitas)
const BLACKLIST = ['CHESS', 'KP3R', 'REEF', 'VITE', 'UNFI', 'EPX', 'FOR', 'VGX', 'OAX', 'PROS', 'SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'OG', 'BAR', 'PSG', 'CITY', 'JUV', 'ACM', 'ATM', 'ASR', 'INTER', 'TRA', 'AFC', 'MENGO', 'NAP', 'GAL', 'TH', 'PFL', 'ALL', 'LEGION', 'UCH', 'USDC', 'TUSD', 'BUSD', 'FDUSD', 'USDP', 'EUR'];

let globalMarket = {
    top10: [],
    coinJumps: {},
    exchangeInfo: null,
    lastExchangeFetch: 0,
    lastUpdate: 0,
    priceHistory: {}
};

function createInitialState(username) {
    return {
        username, clientName: '', apiKey: '', apiSecret: '', status: 'OFFLINE', opsCount: 0, 
        lastTradedCoins: [], // Para regra de 10 moedas
        history: [], logs: [],
        dashboardData: { topRanking: [], pivotInfo: null, volatilityMetrics: null, triggerProfitAnim: false },
        isLoopActive: false, activeSymbol: null, buyPrice: 0, targetPrice: 0, currentPrice: 0, buyQty: 0,
        buyPercentage: 0.99, pauseUntil: null
    };
}

function loadUserState(username) {
    const state = createInitialState(username);
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    if (fs.existsSync(userFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
            Object.assign(state, data);
            console.log(`[USER] Estado carregado para ${username}. Status: ${state.status} | Loop: ${state.isLoopActive}`);
        } catch (e) {}
    }
    if (!Array.isArray(state.lastTradedCoins)) state.lastTradedCoins = [];
    userStates.set(username, state);
    return state;
}

function saveUserState(username) {
    const state = userStates.get(username);
    if (!state) return;
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    fs.writeFileSync(userFile, JSON.stringify({ 
        clientName: state.clientName, history: state.history, opsCount: state.opsCount, 
        apiKey: state.apiKey, apiSecret: state.apiSecret, 
        buyPercentage: state.buyPercentage, lastTradedCoins: state.lastTradedCoins,
        status: state.status, isLoopActive: state.isLoopActive,
        pauseUntil: state.pauseUntil
    }, null, 2));
}

function addLog(username, msg, type = 'info') {
    const state = userStates.get(username);
    if (!state) return;
    const timestamp = new Date().toLocaleTimeString();
    state.logs.unshift({ timestamp, msg, type });
    if (state.logs.length > 50) state.logs.pop();
    console.log(`[${username}] ${msg}`);
}

// ------------------------------------------------------------
// BINANCE REQUEST UTILS (REAL)
// ------------------------------------------------------------
let binanceTimeOffset = 0;

async function syncBinanceTime() {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/time');
        binanceTimeOffset = res.data.serverTime - Date.now();
        
        // Descobrir IP do Servidor para o usuário
        const ipRes = await axios.get('https://api.ipify.org?format=json').catch(() => ({ data: { ip: 'N/A' } }));
        globalMarket.serverIp = ipRes.data.ip;
        console.log(`[SYSTEM] Horário Sincronizado. Offset: ${binanceTimeOffset}ms | IP Servidor: ${globalMarket.serverIp}`);
    } catch (e) {
        console.error("Erro ao sincronizar horário:", e.message);
    }
}
syncBinanceTime(); // Sync inicial
setInterval(syncBinanceTime, 600000); // Sync a cada 10min

function getSignature(queryString, apiSecret) {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function binanceRequest(username, endpoint, method = 'GET', params = {}) {
    const state = userStates.get(username);
    if (!state || !state.apiKey || !state.apiSecret) return { error: true, msg: "Chaves ausentes" };

    try {
        const timestamp = Date.now() + binanceTimeOffset;
        let queryString = `timestamp=${timestamp}&recvWindow=10000`; // Janela maior para segurança
        Object.keys(params).forEach(key => queryString += `&${key}=${params[key]}`);
        const signature = getSignature(queryString, state.apiSecret);
        const url = `https://api.binance.com${endpoint}?${queryString}&signature=${signature}`;

        const res = await axios({
            method,
            url,
            headers: { 'X-MBX-APIKEY': state.apiKey },
            timeout: 10000
        });

        return res.data;
    } catch (e) {
        // Log detalhado para o console da Railway
        console.error(`[BINANCE ERROR] ${method} ${endpoint}:`, e.response?.data || e.message);
        return { error: true, msg: e.response?.data?.msg || e.message };
    }
}

// ------------------------------------------------------------
// SINCRONIZAÇÃO MERCADO (3s)
// ------------------------------------------------------------
setInterval(async () => {
    try {
        const now = Date.now();
        
        // Atualizar ExchangeInfo (30min)
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
                if (BLACKLIST.includes(symbolBase)) return false;
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

        for (const [username, state] of userStates) {
            if (state.isLoopActive && state.status === 'SCANNING') {
                await runFluxoAlfaScanner(username);
            }
        }
        } catch (e) {
            console.error("[MARKET ERROR] Falha ao buscar ranking Binance:", e.message);
        }
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
        target = (d2 <= d6) ? rank2 : rank6;
    } else if (d2 < LIMIT) {
        target = rank2;
    } else if (d6 < LIMIT) {
        target = rank6;
    }

    if (!target) return;
    if (state.lastTradedCoins.includes(target.symbol)) return;

    const jump = globalMarket.coinJumps[target.symbol] || 0;
    if (Math.abs(jump) < 0.2) return;

    // Lógica de Ciclo (5 ops e pausa)
    if (state.opsCount >= 5 && state.isLoopActive) {
        if (!state.pauseUntil) {
            state.pauseUntil = Date.now() + 20 * 60000;
            state.status = 'PAUSED';
            addLog(username, "🛑 Ciclo de 5 concluído. Pausa de 20m ativada.", 'warn');
            saveUserState(username);
            return;
        }
        if (Date.now() < state.pauseUntil) {
            state.status = 'PAUSED';
            return;
        } else {
            state.opsCount = 0;
            state.pauseUntil = null;
            state.status = 'SCANNING';
            addLog(username, "🔄 Pausa encerrada. Novo ciclo iniciado.", 'info');
            saveUserState(username);
        }
    }
    await executeRealBuy(username, target.symbol, target.price);
}

async function executeRealBuy(username, symbol, price) {
    const state = userStates.get(username);
    state.status = 'IN_TRADE';
    state.activeSymbol = symbol;

    addLog(username, `🎯 GATILHO: ${symbol}. Checando saldo...`, 'trigger');

    const account = await binanceRequest(username, '/api/v3/account');
    if (account.error) {
        addLog(username, `Erro Saldo: ${account.msg}`, 'error');
        return resetTradeState(username);
    }

    const usdt = parseFloat(account.balances.find(b => b.asset === 'USDT')?.free || 0);
    if (usdt < 11) {
        addLog(username, `Saldo insuficiente: $${usdt.toFixed(2)}`, 'error');
        return resetTradeState(username);
    }

    const amountToUse = usdt * (state.buyPercentage === 1.0 ? 0.99 : state.buyPercentage);
    
    // ORDEM DE COMPRA REAL
    const order = await binanceRequest(username, '/api/v3/order', 'POST', {
        symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: amountToUse.toFixed(6)
    });

    if (order.error) {
        addLog(username, `Erro Compra: ${order.msg}`, 'error');
        return resetTradeState(username);
    }

    let realPrice = price;
    let qty = amountToUse / price;
    if (order.fills?.length > 0) {
        const sumCost = order.fills.reduce((s, f) => s + (parseFloat(f.price) * parseFloat(f.qty)), 0);
        const sumQty = order.fills.reduce((s, f) => s + parseFloat(f.qty), 0);
        realPrice = sumCost / sumQty;
        qty = sumQty;
    }

    state.buyPrice = realPrice;
    state.buyQty = qty;
    state.targetPrice = realPrice * 1.009; // META 0.9%
    addLog(username, `🚀 COMPRA EXECUTADA: ${symbol} @ $${realPrice.toFixed(6)}`, 'buy');
    
    startTradeMonitor(username, symbol);
}

function startTradeMonitor(username, symbol) {
    const state = userStates.get(username);
    const interval = setInterval(async () => {
        if (state.status !== 'IN_TRADE') return clearInterval(interval);
        
        try {
            const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            const current = parseFloat(res.data.price);
            state.currentPrice = current;

            if (current >= state.targetPrice) {
                clearInterval(interval);
                await executeRealSell(username, symbol, 'LUCRO');
            }
        } catch (e) {}
    }, 2000);
}

async function executeRealSell(username, symbol, reason) {
    const state = userStates.get(username);
    const coinBase = symbol.replace('USDT', '');
    
    addLog(username, `💰 VENDENDO: ${symbol} (${reason})`, 'info');

    const account = await binanceRequest(username, '/api/v3/account');
    if (account.error) return addLog(username, `Erro Venda (Account): ${account.msg}`, 'error');

    const balance = parseFloat(account.balances.find(b => b.asset === coinBase)?.free || 0);
    if (balance <= 0) return resetTradeState(username);

    // Filtro de Precisão (LOT_SIZE)
    let precision = 0;
    if (globalMarket.exchangeInfo) {
        const sInfo = globalMarket.exchangeInfo.symbols.find(s => s.symbol === symbol);
        const lot = sInfo?.filters.find(f => f.filterType === 'LOT_SIZE');
        if (lot) {
            const step = lot.stepSize;
            precision = step.indexOf('1') - step.indexOf('.');
            if (precision < 0) precision = 0;
        }
    }

    const order = await binanceRequest(username, '/api/v3/order', 'POST', {
        symbol, side: 'SELL', type: 'MARKET', quantity: balance.toFixed(precision)
    });

    if (order.error) {
        addLog(username, `Erro Venda: ${order.msg}`, 'error');
        return; 
    }

    const profit = 0.9; // Aproximado para o log e histórico
    state.history.unshift({ symbol, date: new Date().toLocaleString(), profitPct: profit, type: 'LUCRO ELITE' });
    state.lastTradedCoins.push(symbol);
    if (state.lastTradedCoins.length > 10) state.lastTradedCoins.shift();
    state.opsCount++;
    addLog(username, `✅ SUCESSO: ${symbol} Vendido.`, 'card-sell');
    saveUserState(username);
    resetTradeState(username);
}

function resetTradeState(username) {
    const state = userStates.get(username);
    if (!state) return;
    state.activeSymbol = null;
    state.status = state.isLoopActive ? 'SCANNING' : 'OFFLINE';
}

// ------------------------------------------------------------
// ROTAS EXPRESS
// ------------------------------------------------------------
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

app.get('/status', requireAuth, async (req, res) => {
    const data = { ...req.state };
    // Adicionar info de diagnóstico
    data.serverIp = globalMarket.serverIp || 'N/A';
    data.binanceClockOk = Math.abs(binanceTimeOffset) < 60000;
    res.json(data);
});

app.post('/start', requireAuth, async (req, res) => {
    const { clientName, apiKey, apiSecret, buyPercentage } = req.body;
    
    // TESTE DE CONEXÃO IMEDIATO COM TIME SYNC
    const timestamp = Date.now() + binanceTimeOffset;
    const queryString = `timestamp=${timestamp}&recvWindow=60000`; // Janela máxima
    const sig = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
    
    try {
        const test = await axios.get(`https://api.binance.com/api/v3/account?${queryString}&signature=${sig}`, {
            headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000
        });
        
        if (test.data && test.data.canTrade !== undefined) {
            Object.assign(req.state, { 
                clientName, apiKey, apiSecret, 
                buyPercentage: parseFloat(buyPercentage) || 0.99, 
                isLoopActive: true, status: 'SCANNING',
                opsCount: req.state.opsCount || 0,
                pauseUntil: null
            });
            addLog(req.username, `✅ Conectado com Sucesso! Radar Elite Ativo.`, 'info');
            saveUserState(req.username);
            return res.json({ success: true });
        }
    } catch (e) {
        let errMsg = e.response?.data?.msg || "Erro de Conexão: O servidor da Binance não respondeu.";
        
        // Logs de suporte
        if (e.response?.status === 403) {
            errMsg = "🔒 BINANCE BLOQUEOU O IP: O servidor da Railway não consegue falar com a Binance. Tente usar o robô exe (desktop) ou mude a região do servidor.";
        } else if (e.response?.status === 401) {
            errMsg = "❌ CHAVES INCORRETAS: Verifique se a API Key e o Secret estão corretos.";
        } else if (e.code === 'ECONNABORTED') {
            errMsg = "⌛ TIMEOUT: A conexão com a Binance demorou demais. Tente novamente.";
        }
        
        console.error(`[CONNECTION TEST FAILED] ${req.username}:`, e.response?.data || e.message);
        addLog(req.username, `Falha no Start: ${errMsg}`, 'error');
        return res.status(400).json({ error: errMsg });
    }
});

app.post('/stop', requireAuth, (req, res) => {
    req.state.isLoopActive = false;
    req.state.status = 'OFFLINE';
    addLog(req.username, "Radar Desligado.", 'warn');
    res.json({ success: true });
});

app.post('/panic', requireAuth, async (req, res) => {
    if (req.state.status === 'IN_TRADE' && req.state.activeSymbol) {
        await executeRealSell(req.username, req.state.activeSymbol, 'PANIC');
    }
    req.state.isLoopActive = false;
    req.state.status = 'OFFLINE';
    res.json({ success: true });
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Elite Fluxo Alfa Real na Porta ${PORT}`));
