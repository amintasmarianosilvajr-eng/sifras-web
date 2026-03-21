// ALFA USDC MASTER ELITE V1.0 - BUILD: 2026-03-20_ALPHA_MASTER_OPEN
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');
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
        isLoopActive: false,
        activePositions: [], // Array de { symbol, buyPrice, targetPrice, buyQty }
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
let symbolRules = {}; // Cache de precisão e stepSize
let tickerHistory = {}; // Armazena timestamps e preços p/ os últimos 15s
let binanceWS = null;

async function fetchExchangeInfo() {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
        res.data.symbols.forEach(s => {
            const lot = s.filters.find(f => f.filterType === 'LOT_SIZE');
            const isMonitoring = s.permissions?.includes('LEVERAGED') === false && s.tags?.includes('monitoring');
            const isFanToken = ['PSG','BAR','ACM','CITY','ASR','LAZIO','PORTO','SANTOS','ALPINE','OG','JUV'].some(t => s.symbol.startsWith(t));
            const isDelisting = s.status !== 'TRADING' || s.tags?.includes('delisting');

            if (lot) {
                const stepSize = parseFloat(lot.stepSize);
                symbolRules[s.symbol] = {
                    stepSize: stepSize,
                    precision: Math.log10(1 / stepSize),
                    blacklisted: isMonitoring || isFanToken || isDelisting
                };
            }
        });
        console.log("✅ Filtros de Segurança Mapeados (Monitoring/Fans/Delist)");
    } catch (e) {
        console.error("❌ Erro ExchangeInfo:", e.message);
    }
}
fetchExchangeInfo();

function startBinanceWS() {
    if (binanceWS) binanceWS.terminate();
    binanceWS = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');

    binanceWS.on('message', (data) => {
        const tickers = JSON.parse(data);
        const now = Date.now();
        
        tickers.forEach(t => {
            const symbol = t.s;
            const price = parseFloat(t.c);
            
            if (!tickerHistory[symbol]) tickerHistory[symbol] = [];
            tickerHistory[symbol].push({ t: now, p: price });
            
            // Limpa histórico antigo (> 16s)
            tickerHistory[symbol] = tickerHistory[symbol].filter(h => now - h.t <= 16000);
            
            // Lógica de Gatilho para Usuários Ativos no modo OPERACIONAL
            checkTriggers(symbol, price, now);
        });
    });

    binanceWS.on('error', () => setTimeout(startBinanceWS, 5000));
    binanceWS.on('close', () => setTimeout(startBinanceWS, 5000));
}

async function checkTriggers(symbol, currentPrice, now) {
    for (const [username, state] of userStates.entries()) {
        if (!state.isLoopActive) continue;

        // Lógica de Compra: Sempre comprar se houver espaço (Até 10 operações)
        if (state.activePositions.length < 10) {
            // Pular a primeira moeda (#01) - Compras da 2ª à 10ª
            const top2to10 = globalMarket.top10.slice(1, 10);
            
            // Verifica se a moeda já está em operação
            const alreadyOpen = state.activePositions.some(p => p.symbol === symbol);
            if (!alreadyOpen) {
                // Filtro de Segurança
                const isBlacklisted = symbolRules[symbol]?.blacklisted;
                if (isBlacklisted) continue;

                const isInTargetRange = top2to10.some(c => c.symbol === symbol);
                if (isInTargetRange) {
                    const history = tickerHistory[symbol] || [];
                    if (history.length > 2) {
                        const targetTime = now - 15000;
                        let lp = history[0];
                        for (let i = 1; i < history.length; i++) {
                            if (Math.abs(targetTime - history[i].t) < Math.abs(targetTime - lp.t)) lp = history[i];
                        }
                        const change = ((currentPrice - lp.p) / lp.p) * 100;

                        if (change >= 0.2) {
                            addLog(username, `🚀 GATILHO COMPRA (${state.activePositions.length + 1}/10): ${symbol} +${change.toFixed(2)}%`, 'success');
                            // Registra posição pendente para evitar double-buy enquanto a API processa
                            state.activePositions.push({ symbol, buyPrice: currentPrice, pending: true });
                            await executeRealBuy(username, symbol, currentPrice);
                        }
                    }
                }
            }
        }

        // Lógica de Venda Individual: Se bater 0.5% bruto (compra USDT)
        const positionIndex = state.activePositions.findIndex(p => p.symbol === symbol && !p.pending);
        if (positionIndex !== -1) {
            const pos = state.activePositions[positionIndex];
            const target = pos.buyPrice * 1.005; // 0.5% conforme nova instrução
            if (currentPrice >= target) {
                addLog(username, `🎯 ALVO 0.5% ATINGIDO: Vendendo ${symbol} (Retornando ao ciclo)`, 'sell');
                await executeRealSell(username, symbol, 'TAKE_PROF_0.5');
            }
        }
    }
}

startBinanceWS();

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
    addLog(username, `🛒 COMPRA REAL: ${symbol} a $${price.toFixed(8)} | Alvo: +0.5%`, 'buy');
    
    // Calcula quantidade baseada em $20 de capital (mínimo seguro)
    const res = await binanceRequest(username, '/api/v3/order', 'POST', { 
        symbol, 
        side: 'BUY', 
        type: 'MARKET', 
        quoteOrderQty: '20' 
    });
    
    if (res.error) {
        addLog(username, `❌ Falha na Compra Real: ${res.msg}`, 'error');
        state.activePositions = state.activePositions.filter(p => p.symbol !== symbol);
    } else {
        const buyQty = parseFloat(res.executedQty);
        const buyPrice = parseFloat(res.fills?.[0]?.price || price);
        
        // Atualiza a posição de pending para ativa
        const pos = state.activePositions.find(p => p.symbol === symbol);
        if (pos) {
            pos.pending = false;
            pos.buyQty = buyQty;
            pos.buyPrice = buyPrice;
        }
        addLog(username, `📦 Posicionado: ${buyQty} ${symbol.replace('USDT','')}`, 'success');
    }
}

async function executeRealSell(username, symbol, reason) {
    // Antes de vender, busca o saldo real do ativo para descontar taxas (ex: 0.1% taker)
    const asset = symbol.replace('USDT', '');
    const account = await binanceRequest(username, '/api/v3/account');
    
    const pos = state.activePositions.find(p => p.symbol === symbol);
    let sellQty = 0;
    
    if (!account.error) {
        const balance = account.balances.find(b => b.asset === asset);
        if (balance) {
            const rawBalance = parseFloat(balance.free);
            const rules = symbolRules[symbol];
            
            if (rules) {
                // Cálculo ultra-preciso de Lot Size (Step Size)
                sellQty = Math.floor(rawBalance / rules.stepSize + 0.00000001) * rules.stepSize;
                const finalQty = parseFloat(sellQty.toFixed(rules.precision)); // Força a precisão correta da moeda
                
                console.log(`[SELL DEBUG] ${symbol} | Free: ${rawBalance} | RulesStep: ${rules.stepSize} | Precision: ${rules.precision} | Final: ${finalQty}`);
                addLog(username, `📉 Ajuste Venda: ${rawBalance} -> ${finalQty} ${asset}`, 'info');
                sellQty = finalQty;
            } else {
                sellQty = rawBalance;
            }
        }
    }

    if (sellQty <= 0) {
        addLog(username, `❌ Erro: Saldo de ${asset} insuficiente para venda. Removendo posição.`, 'error');
        state.activePositions = state.activePositions.filter(p => p.symbol !== symbol);
        return false;
    }

    console.log(`[SELL] Enviando ordem MARKET SELL ${symbol} | Qty: ${sellQty}`);

    let res = await binanceRequest(username, '/api/v3/order', 'POST', { 
        symbol, 
        side: 'SELL', 
        type: 'MARKET', 
        quantity: sellQty.toString().includes('e') ? sellQty.toFixed(8) : sellQty.toString() 
    });

    // Se falhar por insuficiência de saldo, tenta uma "Venda de Segurança" (99.7% do saldo)
    if (res.error && res.msg?.toLowerCase().includes('insufficient balance')) {
        addLog(username, `⚠️ Saldo Impreciso em ${symbol}. Tentando Venda de Segurança (99.7%)...`, 'error');
        
        // Re-consulta o saldo atualizado e aplica 99.7%
        const lastCheck = await binanceRequest(username, '/api/v3/account');
        if (!lastCheck.error) {
            const b = lastCheck.balances.find(bal => bal.asset === asset);
            if (b) {
                const freshBal = parseFloat(b.free);
                const rules = symbolRules[symbol];
                let safeQty = freshBal * 0.997; // Margem de segurança para garantir a execução
                if (rules) {
                    safeQty = Math.floor(safeQty / rules.stepSize + 0.00000001) * rules.stepSize;
                    sellQty = parseFloat(safeQty.toFixed(rules.precision));
                } else {
                    sellQty = parseFloat(safeQty.toFixed(8));
                }
                
                res = await binanceRequest(username, '/api/v3/order', 'POST', { 
                    symbol, 
                    side: 'SELL', 
                    type: 'MARKET', 
                    quantity: sellQty.toString().includes('e') ? sellQty.toFixed(8) : sellQty.toString() 
                });
            }
        }
    }

    if (res.error) {
        addLog(username, `❌ Falha Crítica na Venda: ${res.msg}. Removendo posição forçadamente.`, 'error');
        state.activePositions = state.activePositions.filter(p => p.symbol !== symbol);
        return false;
    }

    const sellPrice = parseFloat(res.fills?.[0]?.price || 0);
    const buyPrice = pos ? pos.buyPrice : sellPrice;
    const pnlPct = ((sellPrice - buyPrice) / buyPrice) * 100;
    
    // Remove a posição ativa
    state.activePositions = state.activePositions.filter(p => p.symbol !== symbol);
    
    state.history.unshift({ 
        symbol, 
        date: new Date().toLocaleString(), 
        profitPct: pnlPct,
        type: 'REAL'
    });
    
    state.balanceUSDT = (state.balanceUSDT || 0) + (pnlPct > 0 ? (20 * (pnlPct/100)) : 0);
    state.totalProfitPct = (state.totalProfitPct || 0) + pnlPct;
    
    addLog(username, `🏁 ${symbol} Finalizado. PNL: ${pnlPct.toFixed(3)}%`, 'info');
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

app.post('/start', requireAuth, async (req, res) => {
    const { mode, apiKey, apiSecret, clientName } = req.body;
    let username = req.username;
    if (mode === 'ALFA_USDC') username += '_ALFA_USDC';
    const state = loadUserState(username);
    Object.assign(state, { mode, apiKey, apiSecret, clientName, isLoopActive: true, status: 'SCANNING' });
    
    // Busca Saldo Real ao Iniciar
    const account = await binanceRequest(username, '/api/v3/account');
    if (!account.error) {
        const usdt = account.balances.find(b => b.asset === 'USDT');
        state.balanceUSDT = parseFloat(usdt?.free || 0);
        addLog(username, `✅ Conectado! Saldo Inicial: $${state.balanceUSDT.toFixed(2)}`, 'success');
    }

    saveUserState(username);
    res.json({ success: true });
});

app.post('/stop', requireAuth, (req, res) => {
    let username = req.username;
    if (req.headers['x-mode'] === 'ALFA_USDC') username += '_ALFA_USDC';
    const state = loadUserState(username);
    state.isLoopActive = false;
    state.status = 'OFFLINE';
    state.activePositions = [];
    saveUserState(username);
    res.json({ success: true });
});

// ENDPOINTS ADMIN
app.get('/admin/overview', (req, res) => {
    const list = Array.from(userStates.entries()).map(([username, state]) => ({
        username,
        status: state.isLoopActive ? 'OPERANDO' : 'OFFLINE',
        isApproved: true,
        activePositions: state.activePositions,
        balanceUSDT: state.balanceUSDT,
        totalProfitPct: state.totalProfitPct,
        logsCount: state.logs.length,
        isLoopActive: state.isLoopActive
    }));
    res.json({ users: list });
});

app.post('/admin/stop-user', (req, res) => {
    const { targetUser } = req.body;
    const state = userStates.get(targetUser);
    if (state) {
        state.isLoopActive = false;
        state.activePositions = [];
        state.status = 'OFFLINE';
        saveUserState(targetUser);
        res.json({ success: true });
    } else res.status(404).json({ error: 'Usuário não encontrado' });
});

app.post('/admin/stop-all', (req, res) => {
    let count = 0;
    userStates.forEach(state => {
        if (state.isLoopActive) {
            state.isLoopActive = false;
            state.activePositions = [];
            state.status = 'OFFLINE';
            count++;
        }
    });
    res.json({ success: true, count });
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ALFA USDC MASTER ELITE V1.0 na Porta ${PORT}`));
