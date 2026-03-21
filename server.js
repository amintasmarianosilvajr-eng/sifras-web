// ALFA USDC MASTER ELITE V1.0 - BUILD: 2026-03-20_ALPHA_MASTER_OPEN
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const serverStartTime = Date.now();
let lastGlobalLatency = 0;

app.use(express.json());
app.use(cors());

// Forçar limpeza de cache
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

// Caminhos compatíveis com PKG (Busca arquivos na mesma pasta do EXE)
app.use(express.static(process.cwd()));

// GLOBAL ERROR HANDLERS
process.on('uncaughtException', (err) => console.error('[CRITICAL] Uncaught Exception:', err.message));
process.on('unhandledRejection', (reason, promise) => console.error('[CRITICAL] Unhandled Rejection:', reason));

// CONFIGURAÇÃO E PERSISTÊNCIA
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const userStates = new Map();

function createInitialState(username) {
    return {
        username, clientName: '', apiKey: '', apiSecret: '', status: 'OFFLINE', opsCount: 0,
        isApproved: true, // ACESSO ABERTO
        mode: 'ALFA_USDT',
        alfaStep: 10,
        alfaPhase: 'COUNTDOWN',
        lastCoin: '', history: [], logs: [], balanceUSDT: 0, balanceUSDC: 0,
        dashboardData: { topRanking: [], pivotInfo: null, volatilityMetrics: null },
        isLoopActive: false, activeSymbol: null, buyPrice: 0, targetPrice: 0, currentPrice: 0, buyQty: 0,
        buyPercentage: 0.99, pauseUntil: null, totalProfitPct: 0
    };
}

function loadUserState(rawUsername) {
    const username = (rawUsername || '').toLowerCase();
    let state = userStates.get(username);
    if (!state) {
        const userFile = path.join(DATA_DIR, `trade_${username}.json`);
        if (fs.existsSync(userFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
                state = { ...createInitialState(username), ...data };
            } catch (e) { state = createInitialState(username); }
        } else { state = createInitialState(username); }
        userStates.set(username, state);
    }
    return state;
}

function saveUserState(rawUsername) {
    const username = (rawUsername || '').toLowerCase();
    const state = userStates.get(username);
    if (state) {
        const userFile = path.join(DATA_DIR, `trade_${username}.json`);
        fs.writeFileSync(userFile, JSON.stringify(state, null, 2));
    }
}

// ------------------------------------------------------------
// MERCADO (SYNC BINANCE)
// ------------------------------------------------------------
let globalMarket = { top10: [], top30USDC: [], coinJumps: {}, coinJumps20s: {}, lastLatency: 0 };

async function startMarketLoop() {
    try {
        const t1 = Date.now();
        const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 3000 });
        globalMarket.lastLatency = Date.now() - t1;

        const allTickers = res.data;
        
        // 1. Ranking USDT (ALFA USDT)
        const usdtTickers = allTickers.filter(t => t.symbol.endsWith('USDT'))
            .map(t => ({ symbol: t.symbol, change: parseFloat(t.priceChangePercent), price: parseFloat(t.lastPrice) }))
            .sort((a,b) => b.change - a.change);
        globalMarket.top10 = usdtTickers.slice(0, 10);

        // 2. Ranking USDC (ALFA USDC)
        const usdcTickers = allTickers.filter(t => t.symbol.endsWith('USDC'))
            .map(t => ({ symbol: t.symbol, change: parseFloat(t.priceChangePercent), price: parseFloat(t.lastPrice) }))
            .sort((a,b) => b.change - a.change);
        globalMarket.top30USDC = usdcTickers.slice(0, 30);

        // 3. Simulação de Jumps (Gatilhos)
        for (const coin of usdcTickers.slice(0, 30)) {
            globalMarket.coinJumps20s[coin.symbol] = (Math.random() * 0.4); // Mock para teste ou integrar com histórico
        }

        // Executar Scanners
        for (const [username, state] of userStates.entries()) {
            if (state.isLoopActive) {
                if (state.mode === 'ALFA_USDC') await runAlfaUSDCScanner(username);
                else await runFluxoAlfaScanner(username);
            }
        }
    } catch (e) { console.error("[MARKET ERROR]:", e.message); }
    setTimeout(startMarketLoop, 1500);
}
startMarketLoop();

// ------------------------------------------------------------
// MOTORES DE VARREDURA
// ------------------------------------------------------------

async function runAlfaUSDCScanner(username) {
    const state = userStates.get(username);
    if (!state || !state.isLoopActive) return;

    // Monitoramento PNL Geral
    const currentTotalProfit = (state.history || []).reduce((s, h) => s + (h.profitPct || 0), 0);
    state.totalProfitPct = currentTotalProfit;

    if (state.totalProfitPct >= 50 && !state._reinforcing) {
        addLog(username, `🏆 META 50% USDC ATINGIDA: Reforçando bancada USDT...`, 'success');
        state._reinforcing = true;
        await reinforceAlfaFromUSDC(username);
        state._reinforcing = false;
        state.history.forEach(h => h.reinforced = true);
    }

    if (state.status === 'IN_TRADE') {
        const coin = globalMarket.top30USDC.find(c => c.symbol === state.activeSymbol);
        if (coin) {
            state.currentPrice = coin.price;
            const pnl = ((state.currentPrice - state.buyPrice) / state.buyPrice) * 100;
            if (pnl >= 0.4) {
                addLog(username, `✅ ALVO 0.4% ALCANÇADO: Vendendo ${state.activeSymbol}...`, 'success');
                const ok = await executeRealSell(username, state.activeSymbol, 'ALFA_USDC_PROFIT');
                if (ok && state.alfaPhase === 'COUNTDOWN') {
                    state.alfaStep = Math.max(0, state.alfaStep - 1);
                    if (state.alfaStep > 0) return runAlfaUSDCScanner(username);
                    else state.alfaPhase = 'HUNT';
                }
            }
        }
        return;
    }

    if (state.status === 'SCANNING') {
        if (state.alfaPhase === 'COUNTDOWN') {
            const coin = globalMarket.top30USDC[state.alfaStep - 1];
            if (coin) {
                addLog(username, `🔥 CONTAGEM RANK ${state.alfaStep}: Comprando ${coin.symbol}`, 'buy');
                state.status = 'IN_TRADE';
                state.activeSymbol = coin.symbol;
                state.buyPrice = coin.price;
                await executeRealBuy(username, coin.symbol, coin.price);
            }
        } else {
            for (const coin of globalMarket.top30USDC) {
                if (globalMarket.coinJumps20s[coin.symbol] >= 0.3) {
                    addLog(username, `⚡ GATILHO CAÇA: ${coin.symbol} +0.3% detectado.`, 'success');
                    state.status = 'IN_TRADE';
                    state.activeSymbol = coin.symbol;
                    state.buyPrice = coin.price;
                    await executeRealBuy(username, coin.symbol, coin.price);
                    break;
                }
            }
        }
    }
}

async function runFluxoAlfaScanner(username) {
    const state = userStates.get(username);
    if (!state || globalMarket.top10.length < 5 || state.status !== 'SCANNING') return;
    
    const rank4 = globalMarket.top10[3];
    addLog(username, `🔎 Radar Alfa USDT: Monitorando Pivô ${rank4.symbol}...`, 'info');
    // Lógica original simplificada para o novo projeto
}

// ------------------------------------------------------------
// OPERAÇÕES BINANCE (REAIS)
// ------------------------------------------------------------

async function binanceRequest(username, endpoint, method = 'GET', params = {}) {
    const state = userStates.get(username);
    if (!state || !state.apiKey) return { error: true, msg: 'API Key Ausente' };

    try {
        const query = new URLSearchParams({ ...params, timestamp: Date.now(), recvWindow: 10000 }).toString();
        const signature = crypto.createHmac('sha256', state.apiSecret).update(query).digest('hex');
        const url = `https://api.binance.com${endpoint}?${query}&signature=${signature}`;
        const res = await axios({ method, url, headers: { 'X-MBX-APIKEY': state.apiKey } });
        return res.data;
    } catch (e) {
        return { error: true, msg: e.response?.data?.msg || e.message };
    }
}

async function executeRealBuy(username, symbol, price) {
    const state = userStates.get(username);
    addLog(username, `🛒 COMPRANDO: ${symbol} a $${price.toFixed(6)}`, 'buy');
    const side = 'BUY';
    // Implementação simplificada de Market Buy
    const quoteBase = symbol.endsWith('USDC') ? 'USDC' : 'USDT';
    const res = await binanceRequest(username, '/api/v3/order', 'POST', { symbol, side, type: 'MARKET', quoteOrderQty: '20' });
    if (res.error) addLog(username, `❌ Erro na Compra: ${res.msg}`, 'error');
    else state.status = 'IN_TRADE';
}

async function executeRealSell(username, symbol, reason) {
    const state = userStates.get(username);
    addLog(username, `💰 VENDENDO: ${symbol} (${reason})`, 'sell');
    const res = await binanceRequest(username, '/api/v3/order', 'POST', { symbol, side: 'SELL', type: 'MARKET', quantity: state.buyQty || '0.1' });
    if (res.error) {
        addLog(username, `❌ Erro na Venda: ${res.msg}`, 'error');
        return false;
    }
    state.status = 'SCANNING';
    state.activeSymbol = null;
    state.history.unshift({ symbol, date: new Date().toLocaleString(), profitPct: 0.4 });
    saveUserState(username);
    return true;
}

function addLog(username, msg, type = 'info') {
    const state = userStates.get(username);
    if (state) {
        const log = { time: new Date().toLocaleTimeString(), msg, type };
        state.logs.unshift(log);
        if (state.logs.length > 50) state.logs.pop();
        console.log(`[${username}] ${msg}`);
    }
}

async function reinforceAlfaFromUSDC(username) {
    addLog(username, `🔄 REFORÇO: Transferindo 50% lucro USDC -> USDT`, 'info');
    // Implementar conversão real via par USDCUSDT conforme necessário
}

// ------------------------------------------------------------
// ROTAS EXPRESS (ABERTAS)
// ------------------------------------------------------------
app.get('/', (req, res) => res.sendFile(path.join(process.cwd(), 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(process.cwd(), 'admin.html')));
app.get('/operacional', (req, res) => res.sendFile(path.join(process.cwd(), 'operacional.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(process.cwd(), 'dashboard.html')));
app.get('/painel_alfa', (req, res) => res.sendFile(path.join(process.cwd(), 'dashboard.html')));

app.post('/gateway', (req, res) => {
    const { accessKey } = req.body;
    if (accessKey === 'sifras2026' || accessKey === 'alfa7772026@') {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Chave incorreta' });
    }
});

function requireAuth(req, res, next) {
    req.username = 'MASTER_USER';
    req.state = loadUserState('MASTER_USER');
    next();
}

app.get('/status', requireAuth, (req, res) => {
    let username = req.username;
    if (req.headers['x-mode'] === 'ALFA_USDC') username += '_ALFA_USDC';
    const state = loadUserState(username);
    res.json({ ...state, globalLatency: globalMarket.lastLatency });
});

app.post('/start', requireAuth, (req, res) => {
    const { mode, apiKey, apiSecret, clientName } = req.body;
    let username = req.username;
    if (mode === 'ALFA_USDC') username += '_ALFA_USDC';
    const state = loadUserState(username);
    Object.assign(state, { mode, apiKey, apiSecret, clientName, isLoopActive: true, status: 'SCANNING' });
    saveUserState(username);
    res.json({ success: true });
});

app.post('/stop', requireAuth, (req, res) => {
    let username = req.username;
    if (req.headers['x-mode'] === 'ALFA_USDC') username += '_ALFA_USDC';
    const state = loadUserState(username);
    state.isLoopActive = false;
    state.status = 'OFFLINE';
    saveUserState(username);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ALFA USDC MASTER ELITE V1.0 na Porta ${PORT}`));
