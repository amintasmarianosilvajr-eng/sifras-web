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
app.use(express.urlencoded({ extended: true }));
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
            const isMonitoring = s.tags?.includes('monitoring') || s.tags?.includes('seed');
            const isFanToken = ['PSG','BAR','ACM','CITY','ASR','LAZIO','PORTO','SANTOS','ALPINE','OG','JUV','LAZIO'].some(t => s.symbol.startsWith(t));
            const isDelisting = s.status !== 'TRADING' || s.tags?.includes('delisting') || s.tags?.includes('break');
            
            const lot = s.filters.find(f => f.filterType === 'LOT_SIZE');
            const notional = s.filters.find(f => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL' || f.filterType === 'QUOTE_ORDER_QTY_MARKET_ALLOWED');

            if (lot) {
                const stepSize = parseFloat(lot.stepSize);
                symbolRules[s.symbol] = {
                    stepSize: stepSize,
                    precision: Math.max(0, Math.round(Math.log10(1 / stepSize))),
                    minNotional: notional ? parseFloat(notional.minNotional || notional.notional || 10) : 10,
                    blacklisted: isMonitoring || isFanToken || isDelisting
                };
            }
        });
        console.log("✅ Filtros Sniper: Seed/Monitoring/Fans/Delist (100% Spot Pair)");
    } catch (e) {
        console.error("❌ Erro ExchangeInfo:", e.message);
    }
}
fetchExchangeInfo();

function startBinanceWS() {
    if (binanceWS) binanceWS.terminate();
    binanceWS = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');

    binanceWS.on('message', (data) => {
        const tickers = JSON.parse(data);
        const now = Date.now();
        
        // PAREAMENTO FIEL AO RANKING SPOT BINANCE (Sincronia com App/Web)
        const usdtValid = tickers
            .filter(t => t.s.endsWith('USDT'))
            .map(t => ({
                symbol: t.s,
                price: parseFloat(t.c),
                change: parseFloat(t.P),
                volume: parseFloat(t.q)
            }))
            .filter(t => t.volume >= 1000000 && !symbolRules[t.symbol]?.blacklisted) // 1M+ Vol para capturar Top Gainers
            .filter(t => !['USDC','FDUSD','TUSD','DAI','EUR','TRY','BRL','PAXG'].some(stable => t.symbol.includes(stable)))
            .sort((a,b) => b.change - a.change); 

        
        // Cache de Preço Global (Para redundância de venda)
        globalMarket.allTickersMap = new Map();
        usdtValid.forEach(c => globalMarket.allTickersMap.set(c.symbol, c.price));

        globalMarket.top10 = usdtValid.slice(0, 50);

        const symbolsToMonitor = new Set(globalMarket.top10.map(c => c.symbol));
        for (const state of userStates.values()) {
            state.activePositions.forEach(p => symbolsToMonitor.add(p.symbol));
        }
        
        tickers.forEach(t => {
            const symbol = t.s;
            if (symbolsToMonitor.has(symbol)) {
                const price = parseFloat(t.c);
                if (!tickerHistory[symbol]) tickerHistory[symbol] = [];
                tickerHistory[symbol].push({ t: now, p: price });
                if (tickerHistory[symbol].length > 40) tickerHistory[symbol] = tickerHistory[symbol].filter(h => now - h.t <= 20000);
                checkTriggers(symbol, price, now);
            }
        });


    });


    binanceWS.on('error', () => setTimeout(startBinanceWS, 5000));
    binanceWS.on('close', () => setTimeout(startBinanceWS, 5000));
}

async function checkTriggers(symbol, currentPrice, now) {
    for (const [username, state] of userStates.entries()) {
        if (!state.isLoopActive) continue;

        // Lógica de Compra: REGULARIDADE COM CADÊNCIA (Max 5 slots, Delay 30s)
        const canBuyMore = state.activePositions.length < 5;
        const cooldownOk = !state.lastBuyTime || (now - state.lastBuyTime > 30000);

        if (canBuyMore && cooldownOk && !state.isBuying) {
            // Ranks permitidos: #2, #4, #6, #8, #10
            const allowedIndices = [1, 3, 5, 7, 9];
            const targetSymbols = allowedIndices.map(i => globalMarket.top10[i]?.symbol).filter(Boolean);
            
            const alreadyOpen = state.activePositions.some(p => p.symbol === symbol);
            if (!alreadyOpen && targetSymbols.includes(symbol)) {
                if (symbolRules[symbol]?.blacklisted) continue;

                const history = tickerHistory[symbol] || [];
                if (history.length > 5) {
                    const targetTime = now - 15000; 
                    let lp = history[0];
                    for (let i = 1; i < history.length; i++) {
                        if (Math.abs(targetTime - history[i].t) < Math.abs(targetTime - lp.t)) lp = history[i];
                    }
                    const change = ((currentPrice - lp.p) / lp.p) * 100;

                    if (change >= 0.15) { 
                        state.isBuying = true;
                        state.lastBuyTime = now;
                        const rankPos = globalMarket.top10.findIndex(c => c.symbol === symbol) + 1;
                        addLog(username, `🔥 Sniper: GATILHO Rank #${rankPos} -> [${symbol}] (+${change.toFixed(2)}%)`, 'success');
                        
                        const target = currentPrice * 1.004;
                        addLog(username, `🔍 Audit: Alvo Venda $${target.toFixed(6)}`, 'info');
                        
                        state.activePositions.push({ symbol, buyPrice: currentPrice, pending: true, targetPrice: target });
                        executeRealBuy(username, symbol, currentPrice).finally(() => {
                            state.isBuying = false;
                        });
                    }
                }
            }
        }

        // Lógica de Venda Individual: Alvo 0.4%
        const positionIndex = state.activePositions.findIndex(p => p.symbol === symbol && !p.pending && !p.selling);
        if (positionIndex !== -1) {
            const pos = state.activePositions[positionIndex];
            const target = pos.buyPrice * 1.004;
            if (currentPrice >= target) {
                pos.selling = true;
                addLog(username, `🎯 Sniper: ALVO 0.40% ATINGIDO -> [${symbol}]`, 'sell');
                await executeRealSell(username, symbol, 'TAKE_PROF_0.4');
            }
        }
    }
}

startBinanceWS();


async function startMarketLoop() {
    try {
        const t1 = Date.now();
        await axios.get('https://api.binance.com/api/v3/ping', { timeout: 2000 });
        globalMarket.lastLatency = Date.now() - t1;

        // Loop Redundante de Venda (Segurança Alfa)
        for (const [username, state] of userStates.entries()) {
            if (state.isLoopActive && state.activePositions.length > 0) {
                // Cria cópia [ ... ] para evitar bugs de mutação durante iteração
                const positionsToProcess = [...state.activePositions];
                for (const pos of positionsToProcess) {
                    if (pos.pending || pos.selling) continue;
                    
                    // Busca preço ultra-fresco no cache global de TODAS as moedas (Garante venda absoluta)
                    const currentPrice = globalMarket.allTickersMap?.get(pos.symbol);
                    if (currentPrice) {
                        const target = pos.targetPrice || (pos.buyPrice * 1.004); // Usa alvo salvo ou calcula
                        if (currentPrice >= target) {
                            pos.selling = true;
                            addLog(username, `🎯 Sniper RE-CHECK: Alvo 0.4% em [${pos.symbol}] ($${currentPrice} >= $${target.toFixed(6)})`, 'sell');
                            await executeRealSell(username, pos.symbol, 'REDUNDANT_LOOP_SELL');
                        }
                    }
                }
            }


            if (state.isLoopActive) {
                if (state.mode === 'ALFA_USDC') await runAlfaUSDCScanner(username);
                else await runFluxoAlfaScanner(username);
            }
        }
    } catch (e) { console.error("[MARKET SYNC]:", e.message); }
    setTimeout(startMarketLoop, 2000);
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
    
    // Verifica saldo real de USDT antes da compra
    const account = await binanceRequest(username, '/api/v3/account');
    if (account.error) {
        addLog(username, `❌ Erro ao consultar saldo para compra: ${account.msg}`, 'error');
        state.activePositions = state.activePositions.filter(p => p.symbol !== symbol);
        return;
    }

    const usdtBal = parseFloat(account.balances.find(b => b.asset === 'USDT')?.free || 0);
    let amountToBuy = 20; // Padrão

    if (usdtBal < 11) {
        addLog(username, `❌ Saldo insuficiente ($${usdtBal.toFixed(2)} USDT). Mínimo Binance é ~$11.`, 'error');
        state.activePositions = state.activePositions.filter(p => p.symbol !== symbol);
        return;
    }

    if (usdtBal < 20) {
        amountToBuy = usdtBal * 0.98; // Usa 98% do saldo se tiver menos que $20 (margem para taxas)
        addLog(username, `⚠️ Saldo reduzido: Ajustando compra para $${amountToBuy.toFixed(2)} USDT`, 'info');
    }

    addLog(username, `🛒 Sniper: COMPRA EXECUTADA [${symbol}] | Valor: $${amountToBuy.toFixed(2)}`, 'buy');
    
    const res = await binanceRequest(username, '/api/v3/order', 'POST', { 
        symbol, 
        side: 'BUY', 
        type: 'MARKET', 
        quoteOrderQty: amountToBuy.toFixed(2) 
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
    const state = userStates.get(username);
    if (!state) return false;

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
                const finalQty = parseFloat(sellQty.toFixed(rules.precision)); 
                
                // Validação de MIN_NOTIONAL antes de tentar
                const currentPrice = globalMarket.top10.find(t => t.symbol === symbol)?.price || pos?.buyPrice || 0;
                if (finalQty * currentPrice < rules.minNotional) {
                    addLog(username, `⚠️ Notional Insuficiente para ${symbol} ($${(finalQty * currentPrice).toFixed(2)} < $${rules.minNotional}). Removendo resíduo.`, 'info');
                    state.activePositions = state.activePositions.filter(p => p.symbol !== symbol);
                    return false;
                }

                sellQty = finalQty;
            } else {
                sellQty = rawBalance;
            }
        }
    }

    if (sellQty <= 0) {
        addLog(username, `❌ Erro: Saldo de ${asset} insuficiente.`, 'error');
        state.activePositions = state.activePositions.filter(p => p.symbol !== symbol);
        return false;
    }

    const qtyStr = sellQty.toString().includes('e') ? sellQty.toFixed(8) : sellQty.toString();
    console.log(`[SELL] ${symbol} | Qty: ${qtyStr}`);

    let res = await binanceRequest(username, '/api/v3/order', 'POST', { 
        symbol, side: 'SELL', type: 'MARKET', quantity: qtyStr 
    });

    // TRATATIVA DE ERROS BINANCE (INSIGHT REAL)
    if (res.error) {
        const msg = res.msg?.toLowerCase() || '';
        
        // 1. Saldo Insuficiente (Race condition or Fee impact)
        if (msg.includes('insufficient balance')) {
            addLog(username, `⚠️ Ajustando saldo real (99.7%) em ${symbol}...`, 'info');
            const sync = await binanceRequest(username, '/api/v3/account');
            const b = sync.balances?.find(bal => bal.asset === asset);
            if (b) {
                const freshBal = parseFloat(b.free);
                const rules = symbolRules[symbol];
                let safeQty = freshBal * 0.997; 
                if (rules) {
                    safeQty = Math.floor(safeQty / rules.stepSize + 0.00000001) * rules.stepSize;
                    sellQty = parseFloat(safeQty.toFixed(rules.precision));
                }
                res = await binanceRequest(username, '/api/v3/order', 'POST', { 
                    symbol, side: 'SELL', type: 'MARKET', 
                    quantity: sellQty.toString().includes('e') ? sellQty.toFixed(8) : sellQty.toString() 
                });
            }
        } 
        // 2. Filtros de Lote/Mínimos
        else if (msg.includes('filter failure: lot_size') || msg.includes('min_notional')) {
            addLog(username, `❌ Erro de Filtro Binance (${symbol}): ${res.msg}`, 'error');
            state.activePositions = state.activePositions.filter(p => p.symbol !== symbol);
            return false;
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
    res.json({ ...state, globalLatency: globalMarket.lastLatency, top10: globalMarket.top10 });
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
    const list = Array.from(userStates.entries()).map(([username, state]) => {
        const topPos = state.activePositions?.[0] || {};
        return {
            username,
            status: state.isLoopActive ? (state.activePositions?.length > 0 ? 'IN_TRADE' : 'SCANNING') : 'OFFLINE',
            isApproved: state.isApproved !== false,
            activePositions: state.activePositions || [],
            balanceUSDT: state.balanceUSDT || 0,
            totalProfitPct: state.totalProfitPct || 0,
            liquidPnlPool: state.liquidPnlPool || 0,
            realizedProfitBRL: state.realizedProfitBRL || 0,
            salesCount: state.salesCount || 0,
            activeSymbol: topPos.symbol || '---',
            buyPrice: topPos.buyPrice || 0,
            currentPrice: tickerHistory[topPos.symbol]?.slice(-1)[0]?.p || topPos.buyPrice || 0,
            targetPrice: topPos.targetPrice || 0,
            buyAmountUSDT: topPos.buyAmountUSDT || 0,
            currentStep: state.mode || 'ALFA_USDT',
            isLoopActive: state.isLoopActive
        };
    });
    res.json({ 
        users: list,
        globalLatency: globalMarket.lastLatency,
        serverUptime: Math.floor((Date.now() - serverStartTime) / 1000),
        serverIp: 'Nuclear/Railway'
    });
});

app.post('/admin/approve-user', (req, res) => {
    const { targetUser } = req.body;
    const state = userStates.get(targetUser);
    if (state) {
        state.isApproved = true;
        saveUserState(targetUser);
        res.json({ success: true });
    } else res.status(404).json({ error: 'Faltando dados' });
});

app.post('/admin/anti-restart', (req, res) => {
    const { targetUser } = req.body;
    const state = userStates.get(targetUser);
    if (state) {
        state.activePositions = [];
        state.status = 'SCANNING';
        saveUserState(targetUser);
        res.json({ success: true });
    } else res.status(404).json({ error: 'Faltando dados' });
});

app.post('/admin/delete-user', (req, res) => {
    const { targetUser } = req.body;
    const userFile = path.join(DATA_DIR, `trade_${targetUser.toLowerCase()}.json`);
    if (fs.existsSync(userFile)) fs.unlinkSync(userFile);
    userStates.delete(targetUser.toLowerCase());
    res.json({ success: true });
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

app.post('/admin/change-password', (req, res) => res.json({ success: true }));

app.post('/check-api', async (req, res) => {
    const { apiKey, apiSecret } = req.body;
    if (!apiKey || !apiSecret) return res.status(400).json({ error: 'Faltando chaves' });

    try {
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
        const response = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        const balances = (response.data.balances || []).filter(b => parseFloat(b.free) > 0);
        res.json({ success: true, balances });
    } catch (e) {
        res.status(401).json({ error: 'Chaves Inválidas ou Sem Permissão Spot' });
    }
});

// --- PNL REAL BINANCE (ASSINATURA BACKEND) ---
app.post('/pnl-real', async (req, res) => {
    const { key, secret } = req.body;
    if (!key || !secret) return res.status(400).json({ error: 'Chaves ausentes' });

    try {
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}&recvWindow=10000`;
        const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
        
        const response = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': key }
        });

        // 1. Calcular Saldo Estimado em USDT
        const balances = response.data.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0);
        let totalUsdt = 0;
        
        // Tese: Usamos os preços globais do cache do WS para converter
        for (const b of balances) {
            const amount = parseFloat(b.free) + parseFloat(b.locked);
            if (b.asset === 'USDT') {
                totalUsdt += amount;
            } else {
                const pair = b.asset + 'USDT';
                const price = globalMarket.allTickersMap ? globalMarket.allTickersMap.get(pair) : null;
                if (price) totalUsdt += amount * price;
            }
        }

        res.json({ totalUsdt, timestamp });
    } catch (error) {
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// --- RANKING DE MOEDAS (TRILHOS DE DADOS) ---
app.get('/moedas-ranking', (req, res) => {
    // Retorna o Top 10 atualizado pelo WebSocket do servidor
    res.json(globalMarket.top10 || []);
});

// --- PROXY BINANCE (FIX CORS, 403 & ORDER PARAMS) ---
app.all('/proxy-binance/*', async (req, res) => {
    try {
        const fullPath = req.originalUrl.split('?')[0].replace('/proxy-binance/', '');
        const query = req.url.split('?')[1] || '';
        const url = `https://api.binance.com/${fullPath}${query ? '?' + query : ''}`;
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        };
        
        if (req.headers['x-mbx-apikey']) headers['X-MBX-APIKEY'] = req.headers['x-mbx-apikey'];
        
        // Se for POST, garantimos que os dados cheguem corretamente à Binance
        const isPost = req.method !== 'GET';
        let postData = undefined;
        
        if (isPost) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            // Se o corpo já for um objeto (parseado pelo express), convertemos de volta para string
            if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
                const searchParams = new URLSearchParams();
                for (const key in req.body) searchParams.append(key, req.body[key]);
                postData = searchParams.toString();
            } else {
                postData = req.body;
            }
        }

        const config = {
            method: req.method,
            url: url,
            headers: headers,
            data: postData,
            timeout: 15000
        };

        const response = await axios(config);
        res.status(response.status).json(response.data);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'Proxy Error', msg: error.message });
        }
    }
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ALFA MASTER PRO na Porta ${PORT}`);
    startBinanceWS(); // Inicia o motor de busca de moedas
});


