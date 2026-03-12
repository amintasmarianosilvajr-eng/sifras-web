const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(cors());

// ============================================================
// CONFIGURAÇÃO DE ACESSO — ALTERE A SENHA AQUI
// ============================================================
const ACCESS_PASSWORD = 'sifras2025';
const validTokens = new Set();

// ============================================================
// SERVIR ARQUIVOS ESTÁTICOS (HTML, CSS, etc.)
// ============================================================
app.use(express.static(path.join(__dirname)));

// ============================================================
// AUTENTICAÇÃO — Login / Logout / Middleware
// ============================================================
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === ACCESS_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        validTokens.add(token);
        return res.json({ token });
    }
    return res.status(401).json({ error: 'Senha incorreta' });
});

app.post('/logout', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
        validTokens.delete(auth.split(' ')[1]);
    }
    res.json({ success: true });
});

function requireAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
        const token = auth.split(' ')[1];
        if (validTokens.has(token)) return next();
    }
    return res.status(401).json({ error: 'Não autorizado' });
}

// ============================================================
// DADOS PERSISTENTES
// ============================================================
const DATA_FILE = path.join(__dirname, 'trade_data.json');

let state = {
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
    buyPercentage: 0.99
};

if (fs.existsSync(DATA_FILE)) {
    try {
        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        const persistedData = JSON.parse(rawData);
        state.history = persistedData.history || [];
        state.totalProfit = persistedData.totalProfit || 0.0;
        state.opsCount = persistedData.opsCount || 0;
        console.log(`[DATA] Histórico carregado. ${state.history.length} operações. Lucro: ${state.totalProfit.toFixed(2)}%`);
    } catch (e) {
        console.error("Erro ao carregar trade_data.json:", e);
    }
}

function saveTradeData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            history: state.history,
            totalProfit: state.totalProfit,
            opsCount: state.opsCount
        }, null, 2), 'utf8');
    } catch (e) {
        console.error("Erro ao salvar trade_data.json:", e);
    }
}

const BLACKLIST = [
    'CHESS', 'KP3R', 'REEF', 'VITE', 'UNFI', 'EPX', 'FOR', 'VGX', 'OAX', 'PROS',
    'SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'OG', 'BAR', 'PSG', 'CITY', 'JUV', 'ACM',
    'ATM', 'ASR', 'INTER', 'TRA', 'AFC', 'MENGO', 'NAP', 'GAL', 'TH', 'PFL', 'ALL', 'LEGION', 'UCH',
    'USDC', 'TUSD', 'BUSD', 'FDUSD', 'USDP', 'EUR'
];

let globalMarket = {
    top20: [],
    coinJumps: {},
    maxJump: 0,
    exchangeInfo: null,
    lastExchangeFetch: 0,
    lastUpdate: 0,
    priceHistory: {}
};

// ============================================================
// LOGGING
// ============================================================
function addLog(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    state.logs.unshift({ timestamp, msg, type });
    if (state.logs.length > 50) state.logs.pop();
    console.log(`[${timestamp}] ${msg}`);
}

// ============================================================
// NETWORK UTILS
// ============================================================
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

function getSignature(queryString, apiSecret) {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function binanceRequest(endpoint, method = 'GET', params = {}) {
    try {
        if (!state.apiKey || !state.apiSecret) return { error: true, msg: "Chaves de API ausentes" };
        const timestamp = Date.now();
        let queryString = `timestamp=${timestamp}`;
        Object.keys(params).forEach(key => queryString += `&${key}=${params[key]}`);
        const signature = getSignature(queryString, state.apiSecret);
        const url = `https://api.binance.com${endpoint}?${queryString}&signature=${signature}`;
        const res = await fetchWithTimeout(url, {
            method,
            headers: { 'X-MBX-APIKEY': state.apiKey },
            timeout: 10000
        });
        const data = await res.json();
        if (data.code && data.code < 0) {
            console.error(`[BINANCE ERROR ${data.code}] ${data.msg}`);
            return { error: true, ...data };
        }
        return data;
    } catch (e) {
        if (e.name === 'AbortError') return { error: true, msg: 'Timeout de Rede' };
        return { error: true, msg: e.message };
    }
}

// ============================================================
// HEARTBEAT
// ============================================================
setInterval(async () => {
    try {
        const now = Date.now();
        if (!globalMarket.exchangeInfo || now - globalMarket.lastExchangeFetch > 1800000) {
            try {
                const exres = await fetchWithTimeout('https://api.binance.com/api/v3/exchangeInfo', { timeout: 10000 });
                globalMarket.exchangeInfo = await exres.json();
                state.cachedFilters = globalMarket.exchangeInfo.symbols;
                globalMarket.lastExchangeFetch = now;
                console.log('[SYSTEM] Exchange Info Atualizado.');
            } catch (e) { }
        }
        if (!globalMarket.exchangeInfo) return;

        const res = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/24hr', { timeout: 8000 });
        const data = await res.json();
        if (!Array.isArray(data)) return;

        globalMarket.top20 = data
            .filter(i => {
                if (!i.symbol.endsWith('USDT')) return false;
                const symbolBase = i.symbol.replace('USDT', '');
                if (BLACKLIST.includes(symbolBase)) return false;
                if (i.symbol.includes('UPUSDT') || i.symbol.includes('DOWNUSDT')) return false;
                const info = globalMarket.exchangeInfo.symbols.find(s => s.symbol === i.symbol);
                if (!info || info.status !== 'TRADING') return false;
                if (info.tags && info.tags.includes('monitoring')) return false;
                return parseFloat(i.quoteVolume) > 150000;
            })
            .map(i => ({ symbol: i.symbol, price: parseFloat(i.lastPrice), vol24h: parseFloat(i.priceChangePercent) }))
            .filter(i => i.vol24h > 0)
            .sort((a, b) => b.vol24h - a.vol24h)
            .slice(0, 10);

        state.dashboardData.topRanking = globalMarket.top20.slice(0, 5);

        let currentMaxJump = 0;
        globalMarket.coinJumps = {};
        for (const coin of globalMarket.top20) {
            if (!globalMarket.priceHistory[coin.symbol]) {
                globalMarket.priceHistory[coin.symbol] = { old: coin.price, time: now };
                continue;
            }
            const elapsed = now - globalMarket.priceHistory[coin.symbol].time;
            const jump = ((coin.price - globalMarket.priceHistory[coin.symbol].old) / globalMarket.priceHistory[coin.symbol].old) * 100;
            globalMarket.coinJumps[coin.symbol] = jump;
            if (Math.abs(jump) > currentMaxJump) currentMaxJump = Math.abs(jump);
            if (elapsed >= 9500) {
                globalMarket.priceHistory[coin.symbol] = { old: coin.price, time: now };
            }
        }
        globalMarket.maxJump = currentMaxJump;
        globalMarket.lastUpdate = Date.now();

        if (state.status === 'SCANNING' && state.isLoopActive) {
            await runScannerTriad();
        }
    } catch (e) { }
}, 3000);

// ============================================================
// MOTOR ALFA
// ============================================================
async function runScannerTriad() {
    if (Date.now() - globalMarket.lastUpdate > 15000) return;
    const top = globalMarket.top20;
    if (top.length < 6) return;

    const rank2 = top[1];
    const rank4 = top[3];
    const rank6 = top[5];
    if (!rank2 || !rank4 || !rank6) return;

    const deltaTop = Math.abs(rank2.vol24h - rank4.vol24h);
    const deltaBottom = Math.abs(rank4.vol24h - rank6.vol24h);

    state.dashboardData.pivotInfo = {
        pivot: rank4.symbol,
        d2: deltaTop.toFixed(1),
        d4: deltaBottom.toFixed(1),
        t2: rank2.symbol,
        t4: rank6.symbol
    };

    let targetCoin = null;
    let strategyMsg = "";
    const LIMIT = 30.0;

    if (deltaTop < LIMIT && deltaBottom < LIMIT) {
        targetCoin = (deltaTop <= deltaBottom) ? rank2 : rank6;
        strategyMsg = deltaTop <= deltaBottom ? "AMBAS <30% (DESEMPATE TOPO)" : "AMBAS <30% (DESEMPATE BASE)";
    } else if (deltaTop < LIMIT) {
        targetCoin = rank2;
        strategyMsg = "GATILHO <30% (TOPO)";
    } else if (deltaBottom < LIMIT) {
        targetCoin = rank6;
        strategyMsg = "GATILHO <30% (BASE)";
    } else {
        return;
    }

    if (state.opsCount >= 5) {
        state.status = 'PAUSED';
        addLog("Ciclo de 5 operações concluído. Pausa de 20 minutos...", 'warn');
        setTimeout(() => {
            if (state.isLoopActive && state.status !== 'OFFLINE') {
                state.opsCount = 0;
                state.status = 'SCANNING';
                addLog("Pausa de 20 minutos concluída. Reiniciando Varredura.", 'info');
            }
        }, 1200000);
        return;
    }

    if (state.tradedCoins.includes(targetCoin.symbol)) return;

    const jump = globalMarket.coinJumps[targetCoin.symbol] || 0;
    state.dashboardData.volatilityMetrics = { symbol: targetCoin.symbol, target: 0.1, current: jump };

    if (Math.abs(jump) < 0.1) return;

    state.status = 'VALIDATING_VOL';
    addLog(`🎯 GATILHO CONFIRMADO: ${strategyMsg} -> ALVO: ${targetCoin.symbol}`, 'trigger');

    const security = await validateAlfaSecurity(targetCoin.symbol, targetCoin.price);
    if (!security.ok) {
        addLog(`❌ Entrada abortada (Segurança): ${security.msg}`, 'warn');
        state.status = 'SCANNING';
        return;
    }

    addLog(`🚀 INICIANDO ORDEM: ${targetCoin.symbol} (Pulo 10s: ${jump.toFixed(2)}%)`, 'info');
    await executeRealBuy(targetCoin.symbol, targetCoin.price);
}

async function validateAlfaSecurity(symbol, currentPrice) {
    try {
        const klines = await fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=14`, { timeout: 5000 }).then(r => r.json());
        if (klines.length < 14) return { ok: false, msg: 'Faltam Dados RSI' };

        let gains = 0, losses = 0;
        for (let i = 1; i < klines.length; i++) {
            const diff = parseFloat(klines[i][4]) - parseFloat(klines[i - 1][4]);
            if (diff >= 0) gains += diff; else losses -= diff;
        }
        const rsi = 100 - (100 / (1 + (gains / (losses || 1))));
        if (rsi > 75) return { ok: false, msg: `RSI Sobrecomprado (${rsi.toFixed(1)})` };

        const depth = await fetchWithTimeout(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`, { timeout: 5000 }).then(r => r.json());
        const totalBids = depth.bids.reduce((sum, b) => sum + parseFloat(b[1]), 0);
        const totalAsks = depth.asks.reduce((sum, a) => sum + parseFloat(a[1]), 0);
        const bookRatio = totalBids / totalAsks;
        if (bookRatio < 1.1) return { ok: false, msg: `Pressão no Book de Vendas (${bookRatio.toFixed(2)}x)` };

        const history = globalMarket.priceHistory[symbol];
        if (!history || currentPrice <= history.old) return { ok: false, msg: 'Tendência de queda na base 10s' };

        return { ok: true };
    } catch (e) {
        return { ok: false, msg: 'Micro-Tempo de Rede Excedido' };
    }
}

// ============================================================
// COMPRA & VENDA
// ============================================================
async function executeRealBuy(symbol, currentPrice) {
    state.status = 'IN_TRADE';
    state.activeSymbol = symbol;

    try {
        const account = await binanceRequest('/api/v3/account');
        if (account.error || !account.balances) {
            addLog(`Erro ao checar saldo de USDT: ${account.msg}`, 'error');
            resetTradeState();
            return;
        }

        const usdtBalance = account.balances.find(b => b.asset === 'USDT');
        if (!usdtBalance) { addLog(`Saldo USDT não localizado`, 'error'); resetTradeState(); return; }

        const totalUSDT = parseFloat(usdtBalance.free);
        if (totalUSDT < 11) {
            addLog(`Saldo insuficiente ($${totalUSDT.toFixed(2)}). Mínimo ~$11.`, 'error');
            resetTradeState();
            return;
        }

        const pctToUse = state.buyPercentage === 1.0 ? 0.99 : state.buyPercentage;
        const amountToSpend = totalUSDT * pctToUse;

        const buyOrder = await binanceRequest('/api/v3/order', 'POST', {
            symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: amountToSpend.toFixed(6)
        });

        if (buyOrder.error) {
            addLog(`ERRO COMPRA BINANCE: ${buyOrder.msg}`, 'error');
            resetTradeState();
            return;
        }

        state.tradedCoins.push(symbol);
        if (state.tradedCoins.length > 5) state.tradedCoins.shift();

        let realBuyPrice = currentPrice;
        let qtyBought = 0;
        if (buyOrder.fills && buyOrder.fills.length > 0) {
            let totalCost = 0;
            buyOrder.fills.forEach(f => {
                let p = parseFloat(f.price), q = parseFloat(f.qty);
                qtyBought += q;
                totalCost += (p * q);
            });
            realBuyPrice = totalCost / qtyBought;
        } else {
            qtyBought = amountToSpend / currentPrice;
        }

        state.buyPrice = realBuyPrice;
        state.currentPrice = realBuyPrice;
        state.buyQty = qtyBought;
        state.targetPrice = realBuyPrice * (1 + (0.8 / 100));

        addLog(`COMPRA EXECUTADA | Alvo: $${state.targetPrice.toFixed(6)} (+0.8%)`, 'buy');
        startTradeMonitor(symbol);

    } catch (e) {
        addLog(`Erro Crítico na Compra: ${e.message}`, 'error');
        resetTradeState();
    }
}

let currentTradeInterval = null;

function startTradeMonitor(symbol) {
    if (currentTradeInterval) clearInterval(currentTradeInterval);
    currentTradeInterval = setInterval(async () => {
        if (state.status !== 'IN_TRADE') { clearInterval(currentTradeInterval); return; }
        try {
            const ticker = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { timeout: 3000 }).then(r => r.json());
            const current = parseFloat(ticker.price);
            state.currentPrice = current;
            if (current >= state.targetPrice) {
                clearInterval(currentTradeInterval);
                await executeRealSell(symbol, 'LUCRO_ALVO');
            }
        } catch (e) { }
    }, 1500);
}

async function executeRealSell(symbol, reason) {
    if (state.status !== 'IN_TRADE') return;
    addLog(`[INICIANDO VENDA DE ${symbol}] Motivo: ${reason}`, 'info');

    try {
        const coinStr = symbol.replace('USDT', '');
        let stepPrecision = 0;
        if (state.cachedFilters) {
            const symInfo = state.cachedFilters.find(s => s.symbol === symbol);
            if (symInfo) {
                const lot = symInfo.filters.find(f => f.filterType === 'LOT_SIZE');
                if (lot) {
                    const stepSize = lot.stepSize;
                    stepPrecision = stepSize.indexOf('1') - stepSize.indexOf('.');
                    if (stepPrecision < 0) stepPrecision = 0;
                }
            }
        }

        const account = await binanceRequest('/api/v3/account');
        if (account.error || !account.balances) {
            addLog(`Erro ao checar saldo de venda: ${account.msg}`, 'error');
            return;
        }

        const balance = account.balances.find(b => b.asset === coinStr);
        if (!balance) return;

        let qty = parseFloat(balance.free);
        const factor = Math.pow(10, stepPrecision);
        qty = Math.floor(qty * factor) / factor;

        if (qty <= 0) { addLog(`Saldo de Moeda Zerado?`, 'error'); resetTradeState(); return; }

        const sellOrder = await binanceRequest('/api/v3/order', 'POST', {
            symbol, side: 'SELL', type: 'MARKET', quantity: qty.toFixed(stepPrecision)
        });

        if (sellOrder.error) {
            addLog(`ERRO VENDA BINANCE: ${sellOrder.msg}`, 'error');
            state.status = 'OFFLINE';
            return;
        }

        let realSellPrice = state.currentPrice;
        if (sellOrder.fills && sellOrder.fills.length > 0) {
            let totalQty = 0, totalCost = 0;
            sellOrder.fills.forEach(f => {
                let p = parseFloat(f.price), q = parseFloat(f.qty);
                totalQty += q; totalCost += (p * q);
            });
            realSellPrice = totalCost / totalQty;
        }

        const profitPct = ((realSellPrice - state.buyPrice) / state.buyPrice) * 100;
        state.totalProfit += profitPct;

        const typeLabel = reason === 'PANIC' ? 'PÂNICO/MANUAL' : 'LUCRO AUTOMÁTICO';
        addLog(`Retorno Base ${symbol}. Lucro: ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}% | Entrada USDT: $${realSellPrice.toFixed(6)}`, 'card-sell');

        state.history.unshift({
            symbol, date: new Date().toLocaleString(),
            profitPct: parseFloat(profitPct.toFixed(2)),
            type: typeLabel
        });

        state.cooldownList.push({ symbol, unlockAtOpsCount: state.opsCount + 5 });
        state.opsCount++;
        saveTradeData();

        if (reason !== 'PANIC' && profitPct > 0) {
            state.dashboardData.triggerProfitAnim = true;
            setTimeout(() => state.dashboardData.triggerProfitAnim = false, 5000);
        }

        resetTradeState();
    } catch (e) {
        addLog(`Erro Crítico na Venda: ${e.message}`, 'error');
        state.status = 'OFFLINE';
    }
}

function resetTradeState() {
    state.activeSymbol = null;
    state.buyPrice = 0;
    state.targetPrice = 0;
    state.currentPrice = 0;
    state.buyQty = 0;
    state.status = state.isLoopActive ? 'SCANNING' : 'OFFLINE';
}

// ============================================================
// ROTAS DA API (PROTEGIDAS POR AUTH)
// ============================================================
app.get('/status', requireAuth, (req, res) => res.json(state));

app.post('/start', requireAuth, (req, res) => {
    const { apiKey, apiSecret, buyPercentage } = req.body;
    state.apiKey = apiKey;
    state.apiSecret = apiSecret;
    state.buyPercentage = parseFloat(buyPercentage) || 0.99;
    if (state.apiKey && state.apiSecret) {
        addLog(`Conectando Cérebro V2. Modo Escaneamento Alfa ativo usando ${(state.buyPercentage * 100).toFixed(0)}% da Banca...`, 'info');
        state.isLoopActive = true;
        state.status = 'SCANNING';
        res.send({ success: true });
    } else {
        res.status(400).send({ success: false });
    }
});

app.post('/stop', requireAuth, (req, res) => {
    addLog("Parada solicitada pelo usuário. Desligando Radar.", 'warn');
    state.isLoopActive = false;
    state.status = 'OFFLINE';
    res.send({ success: true });
});

// Rota de venda manual (suporta /sell-now e /panic)
const sellNowHandler = async (req, res) => {
    if (state.status === 'IN_TRADE' && state.activeSymbol) {
        addLog(`Venda Manual (Pânico) solicitada para ${state.activeSymbol}. Efetuando liquidação!`, 'warn');
        if (currentTradeInterval) clearInterval(currentTradeInterval);
        await executeRealSell(state.activeSymbol, 'PANIC');
        res.send({ success: true });
    } else {
        res.status(400).send({ success: false, msg: 'No active trade' });
    }
};
app.post('/sell-now', requireAuth, sellNowHandler);
app.post('/panic', requireAuth, sellNowHandler); // alias corrigido

app.post('/reset', requireAuth, (req, res) => {
    state.apiKey = '';
    state.apiSecret = '';
    state.history = [];
    state.totalProfit = 0.0;
    state.opsCount = 0;
    state.cooldownList = [];
    state.logs = [];
    saveTradeData();
    res.send({ success: true });
});

app.post('/reset-history', requireAuth, (req, res) => {
    state.history = [];
    state.totalProfit = 0.0;
    state.opsCount = 0;
    saveTradeData();
    res.send({ success: true });
});

app.get('/logs', requireAuth, (req, res) => res.json(state.logs));
app.get('/history', requireAuth, (req, res) => res.json(state.history));

// ============================================================
// ROTA "/" → Redireciona para login.html se sem token (fallback)
// A verificação principal é no client-side do index.html
// ============================================================

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SIFRAS WEB] Servidor rodando na porta ${PORT}`);
    console.log(`[SIFRAS WEB] Acesse: http://localhost:${PORT}`);
    console.log(`[SIFRAS WEB] Senha de acesso configurada.`);
});
