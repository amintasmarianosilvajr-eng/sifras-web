const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(cors());

// Senha de Acesso Global (Gateway)
const GLOBAL_ACCESS_KEY = 'alfa777';

// ============================================================
// CONFIGURAÇÃO E PERSISTÊNCIA
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users_db.json');
let usersDB = {}; // { username: { password, tradeDataFile } }

if (fs.existsSync(USERS_FILE)) {
    try {
        usersDB = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) { console.error("Erro ao carregar users_db.json", e); }
}

function saveUsersDB() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2));
}

// Em memória: { token: username } e { username: state }
const activeTokens = new Map();
const userStates = new Map();

function createInitialState(username) {
    return {
        username,
        apiKey: '',
        apiSecret: '',
        status: 'OFFLINE',
        opsCount: 0,
        cooldownList: [],
        history: [],
        logs: [],
        dashboardData: {
            topRanking: [],
            pivotInfo: null,
            volatilityMetrics: null,
            triggerProfitAnim: false
        },
        isLoopActive: false,
        activeSymbol: null,
        buyPrice: 0,
        targetPrice: 0,
        currentPrice: 0,
        buyQty: 0,
        cachedFilters: null,
        totalProfit: 0.0,
        tradedCoins: [],
        buyPercentage: 0.99,
        buyAmountUSDT: 0.0,
        currentStep: 'OFFLINE'
    };
}

function loadUserState(username) {
    const state = createInitialState(username);
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    if (fs.existsSync(userFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
            Object.assign(state, data);
            // Reset status-related volatile fields
            state.status = 'OFFLINE';
            state.isLoopActive = false;
        } catch (e) { console.error(`Erro ao carregar dados de ${username}`, e); }
    }
    userStates.set(username, state);
    return state;
}

function saveUserState(username) {
    const state = userStates.get(username);
    if (!state) return;
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    const dataToSave = {
        history: state.history,
        totalProfit: state.totalProfit,
        opsCount: state.opsCount,
        apiKey: state.apiKey,
        apiSecret: state.apiSecret,
        buyPercentage: state.buyPercentage
    };
    fs.writeFileSync(userFile, JSON.stringify(dataToSave, null, 2));
}

// ============================================================
// SERVIR ARQUIVOS ESTÁTICOS
// ============================================================
app.use(express.static(path.join(__dirname)));

// ============================================================
// AUTENTICAÇÃO E REGISTRO
// ============================================================
app.post('/gateway', (req, res) => {
    const { accessKey } = req.body;
    if (accessKey === GLOBAL_ACCESS_KEY) {
        return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Chave de acesso inválida' });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username e senha obrigatórios' });

    // Login ou Registro Automático
    if (!usersDB[username]) {
        // Primeiro acesso: registra
        usersDB[username] = { password }; // Idealmente usar hash aqui, mas mantendo simples para o usuário
        saveUsersDB();
        console.log(`[AUTH] Novo usuário registrado: ${username}`);
    } else {
        // Verifica senha
        if (usersDB[username].password !== password) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }
    }

    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.set(token, username);

    // Carrega o estado se ainda não estiver na memória
    if (!userStates.has(username)) loadUserState(username);

    return res.json({ token, username });
});

app.post('/logout', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
        const token = auth.split(' ')[1];
        activeTokens.delete(token);
    }
    res.json({ success: true });
});

function requireAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
        const token = auth.split(' ')[1];
        const username = activeTokens.get(token);
        if (username) {
            req.username = username;
            req.state = userStates.get(username) || loadUserState(username);
            return next();
        }
    }
    return res.status(401).json({ error: 'Não autorizado' });
}

// ============================================================
// LOGGING POR USUÁRIO
// ============================================================
function addLog(state, msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    state.logs.unshift({ timestamp, msg, type });
    if (state.logs.length > 50) state.logs.pop();
    console.log(`[${state.username}][${timestamp}] ${msg}`);
}

// ============================================================
// MARKET GLOBAL (Compartilhado para economizar banda/API)
// ============================================================
let globalMarket = {
    top20: [],
    coinJumps: {},
    maxJump: 0,
    exchangeInfo: null,
    lastExchangeFetch: 0,
    lastUpdate: 0,
    priceHistory: {}
};

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// Monitor Global do Mercado
setInterval(async () => {
    try {
        const now = Date.now();
        if (!globalMarket.exchangeInfo || now - globalMarket.lastExchangeFetch > 1800000) {
            const exres = await fetchWithTimeout('https://api.binance.com/api/v3/exchangeInfo', { timeout: 10000 });
            globalMarket.exchangeInfo = await exres.json();
            globalMarket.lastExchangeFetch = now;
        }

        const res = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/24hr', { timeout: 8000 });
        const data = await res.json();
        if (!Array.isArray(data)) return;

        globalMarket.top20 = data
            .filter(i => {
                if (!i.symbol.endsWith('USDT')) return false;
                const info = globalMarket.exchangeInfo.symbols.find(s => s.symbol === i.symbol);
                if (!info || info.status !== 'TRADING') return false;
                return parseFloat(i.quoteVolume) > 150000;
            })
            .map(i => ({ symbol: i.symbol, price: parseFloat(i.lastPrice), vol24h: parseFloat(i.priceChangePercent) }))
            .filter(i => i.vol24h > 0)
            .sort((a, b) => b.vol24h - a.vol24h)
            .slice(0, 10);

        // Atualizar Saltos 10s
        for (const coin of globalMarket.top20) {
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

        // --- RODAR MOTOR PARA CADA USUÁRIO ATIVO ---
        for (const [username, state] of userStates) {
            if (state.status === 'SCANNING' && state.isLoopActive) {
                state.currentStep = 'SCANNING';
                state.dashboardData.topRanking = globalMarket.top20.slice(0, 5);
                await runScannerTriad(state);
            }
        }
    } catch (e) { }
}, 3000);

// ============================================================
// MOTOR ALFA (Multi-User)
// ============================================================
async function runScannerTriad(state) {
    if (Date.now() - globalMarket.lastUpdate > 15000) return;
    const top = globalMarket.top20;
    if (top.length < 6) return;

    const rank2 = top[1], rank4 = top[3], rank6 = top[5];
    const deltaTop = Math.abs(rank2.vol24h - rank4.vol24h);
    const deltaBottom = Math.abs(rank4.vol24h - rank6.vol24h);

    state.dashboardData.pivotInfo = {
        pivot: rank4.symbol, d2: deltaTop.toFixed(1), d4: deltaBottom.toFixed(1),
        t2: rank2.symbol, t4: rank6.symbol
    };

    let targetCoin = null;
    const LIMIT = 30.0;
    if (deltaTop < LIMIT) targetCoin = rank2;
    else if (deltaBottom < LIMIT) targetCoin = rank6;
    else return;

    if (state.opsCount >= 5) {
        state.status = 'PAUSED';
        state.currentStep = 'Ciclo Completo - Pausa 20min';
        addLog(state, "Pausa de 20 min...", 'warn');
        setTimeout(() => { if (state.isLoopActive) { state.opsCount = 0; state.status = 'SCANNING'; state.currentStep = 'SCANNING'; } }, 1200000);
        return;
    }

    if (state.tradedCoins.includes(targetCoin.symbol)) return;
    const jump = globalMarket.coinJumps[targetCoin.symbol] || 0;
    if (Math.abs(jump) < 0.1) return;

    state.status = 'VALIDATING_VOL';
    state.currentStep = `Validando ${targetCoin.symbol} (RSI/Vol)`;
    const security = await validateAlfaSecurity(targetCoin.symbol, targetCoin.price);
    if (!security.ok) {
        state.status = 'SCANNING';
        state.currentStep = 'SCANNING';
        return;
    }

    addLog(state, `🚀 INICIANDO ORDEM: ${targetCoin.symbol}`, 'info');
    await executeRealBuy(state, targetCoin.symbol, targetCoin.price);
}

async function validateAlfaSecurity(symbol, currentPrice) {
    try {
        const klines = await fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=14`, { timeout: 5000 }).then(r => r.json());
        if (klines.length < 14) return { ok: false };
        let gains = 0, losses = 0;
        for (let i = 1; i < klines.length; i++) {
            const diff = parseFloat(klines[i][4]) - parseFloat(klines[i - 1][4]);
            if (diff >= 0) gains += diff; else losses -= diff;
        }
        const rsi = 100 - (100 / (1 + (gains / (losses || 1))));
        if (rsi > 75) return { ok: false };
        return { ok: true };
    } catch (e) { return { ok: false }; }
}

async function executeRealBuy(state, symbol, currentPrice) {
    state.status = 'IN_TRADE';
    state.activeSymbol = symbol;
    try {
        const account = await binanceRequest(state, '/api/v3/account');
        if (account.error) { addLog(state, `Erro saldo: ${account.msg}`, 'error'); resetTradeState(state); return; }
        const usdt = account.balances.find(b => b.asset === 'USDT');
        const balance = parseFloat(usdt?.free || 0);
        if (balance < 11) { addLog(state, "Saldo insuficiente para operar", 'error'); resetTradeState(state); return; }

        const amount = balance * (state.buyPercentage || 0.99);
        const buyOrder = await binanceRequest(state, '/api/v3/order', 'POST', {
            symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: amount.toFixed(6)
        });

        if (buyOrder.error) { addLog(state, `Erro Compra: ${buyOrder.msg}`, 'error'); resetTradeState(state); return; }

        state.buyAmountUSDT = amount;
        state.currentStep = `Comprado em ${symbol}`;
        state.buyPrice = currentPrice;
        state.targetPrice = currentPrice * (1 + (0.8 / 100));
        addLog(state, `COMPRA EXECUTADA EM ${symbol}`, 'buy');
        startTradeMonitor(state, symbol);
    } catch (e) { resetTradeState(state); }
}

function startTradeMonitor(state, symbol) {
    const monitor = setInterval(async () => {
        if (state.status !== 'IN_TRADE') return clearInterval(monitor);
        try {
            const ticker = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`).then(r => r.json());
            const current = parseFloat(ticker.price);
            state.currentPrice = current;
            if (current >= state.targetPrice) {
                state.currentStep = `Vendendo ${symbol} (Alvo Atingido)`;
                clearInterval(monitor);
                await executeRealSell(state, symbol, 'LUCRO_ALVO');
            }
        } catch (e) { }
    }, 1500);
}

async function executeRealSell(state, symbol, reason) {
    if (state.status !== 'IN_TRADE') return;
    try {
        const account = await binanceRequest(state, '/api/v3/account');
        const coin = symbol.replace('USDT', '');
        const balance = account.balances.find(b => b.asset === coin);
        let qty = parseFloat(balance?.free || 0);
        if (qty <= 0) { resetTradeState(state); return; }

        const sellOrder = await binanceRequest(state, '/api/v3/order', 'POST', {
            symbol, side: 'SELL', type: 'MARKET', quantity: qty.toFixed(6) // Simplificado: Ideal usar LOT_SIZE filters
        });

        const profit = ((state.currentPrice - state.buyPrice) / state.buyPrice) * 100;
        state.totalProfit += profit;
        state.history.unshift({ symbol, date: new Date().toLocaleString(), profitPct: profit.toFixed(2), type: reason });
        addLog(state, `VENDA ${symbol} | Lucro: ${profit.toFixed(2)}%`, 'card-sell');
        state.opsCount++;
        saveUserState(state.username);
        resetTradeState(state);
    } catch (e) { state.status = 'OFFLINE'; }
}

function resetTradeState(state) {
    state.activeSymbol = null;
    state.buyAmountUSDT = 0;
    state.currentStep = state.isLoopActive ? 'SCANNING' : 'OFFLINE';
    state.status = state.isLoopActive ? 'SCANNING' : 'OFFLINE';
}

function getSignature(queryString, apiSecret) {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function binanceRequest(state, endpoint, method = 'GET', params = {}) {
    if (!state.apiKey || !state.apiSecret) return { error: true, msg: "Configuração incompleta" };
    try {
        const timestamp = Date.now();
        let query = `timestamp=${timestamp}`;
        Object.keys(params).forEach(k => query += `&${k}=${params[k]}`);
        const sig = getSignature(query, state.apiSecret);
        const url = `https://api.binance.com${endpoint}?${query}&signature=${sig}`;
        const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': state.apiKey } });
        return await res.json();
    } catch (e) { return { error: true, msg: e.message }; }
}

// ============================================================
// ROTAS DA API
// ============================================================
app.get('/status', requireAuth, (req, res) => res.json(req.state));

app.post('/start', requireAuth, (req, res) => {
    const { apiKey, apiSecret, buyPercentage } = req.body;
    req.state.apiKey = apiKey;
    req.state.apiSecret = apiSecret;
    req.state.buyPercentage = parseFloat(buyPercentage) || 0.99;
    req.state.isLoopActive = true;
    req.state.status = 'SCANNING';
    req.state.currentStep = 'SCANNING';
    addLog(req.state, "Motor Alfa Iniciado", 'info');
    saveUserState(req.username);
    res.send({ success: true });
});

app.post('/stop', requireAuth, (req, res) => {
    req.state.isLoopActive = false;
    req.state.status = 'OFFLINE';
    req.state.currentStep = 'OFFLINE';
    saveUserState(req.username);
    res.send({ success: true });
});

app.post('/panic', requireAuth, async (req, res) => {
    if (req.state.status === 'IN_TRADE' && req.state.activeSymbol) {
        await executeRealSell(req.state, req.state.activeSymbol, 'PANIC');
        res.send({ success: true });
    } else res.status(400).send({ success: false });
});

app.post('/reset-history', requireAuth, (req, res) => {
    req.state.history = [];
    req.state.totalProfit = 0.0;
    req.state.opsCount = 0;
    saveUserState(req.username);
    res.send({ success: true });
});

// ============================================================
// MONITORAMENTO ADMINISTRATIVO
// ============================================================
// Endpoint para servir o Dashboard Admin em um link secreto
app.get('/painel_alfa', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin/overview', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth === `Bearer ${GLOBAL_ACCESS_KEY}` || auth === GLOBAL_ACCESS_KEY) {
        const overview = [];
        for (const [username, state] of userStates) {
            overview.push({
                username,
                status: state.status,
                activeSymbol: state.activeSymbol,
                currentStep: state.currentStep,
                buyAmountUSDT: state.buyAmountUSDT || 0,
                currentPrice: state.currentPrice,
                buyPrice: state.buyPrice,
                totalProfit: state.totalProfit,
                opsCount: state.opsCount,
                lastUpdate: new Date().toLocaleTimeString()
            });
        }
        return res.json(overview);
    }
    return res.status(401).json({ error: 'Acesso Administrativo Negado' });
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SIFRAS MULTI-USER] Rodando na porta ${PORT}`);
});
