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
            const notional = s.filters.find(f => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL' || f.filterType === 'QUOTE_ORDER_QTY_MARKET_ALLOWED');
            
            const isMonitoring = s.permissions?.includes('LEVERAGED') === false && s.tags?.includes('monitoring');
            const isFanToken = ['PSG','BAR','ACM','CITY','ASR','LAZIO','PORTO','SANTOS','ALPINE','OG','JUV'].some(t => s.symbol.startsWith(t));
            const isDelisting = s.status !== 'TRADING' || s.tags?.includes('delisting');

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
        console.log("✅ Filtros de Segurança Mapeados (Monitoring/Fans/Delist)");
    } catch (e) {
        console.error("❌ Erro ExchangeInfo:", e.message);
    }
}
fetchExchangeInfo();

function startBinanceWS() {
    if (binanceWS) binanceWS.terminate();
    // !ticker@arr fornece volume e variação 24h em tempo real
    binanceWS = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');

    binanceWS.on('message', (data) => {
        const tickers = JSON.parse(data);
        const now = Date.now();
        
        // 1. Atualiza Rank Global Interno para Gatilhos (Performance: Filtro Rápido)
        const usdtValid = tickers
            .filter(t => t.s.endsWith('USDT'))
            .map(t => ({
                symbol: t.s,
                price: parseFloat(t.c),
                change: parseFloat(t.P),
                volume: parseFloat(t.q) // Quote volume (USDT)
            }))
            .filter(t => t.volume >= 30000000 && !symbolRules[t.symbol]?.blacklisted) // Volume > 30M e sem Monitoring/Fans
            .sort((a,b) => b.change - a.change);
        
        globalMarket.top10 = usdtValid.slice(0, 50); // Mantemos até o 50 para garantir margem
        
        // 2. Processa Gatilhos Individuais
        tickers.forEach(t => {
            const symbol = t.s;
            const price = parseFloat(t.c);
            
            // Somente moedas no Top 50 interessam ao motor
            if (globalMarket.top10.some(c => c.symbol === symbol)) {
                if (!tickerHistory[symbol]) tickerHistory[symbol] = [];
                tickerHistory[symbol].push({ t: now, p: price });
                
                // Cleanup apenas se necessário (intervalado ou por tamanho)
                if (tickerHistory[symbol].length > 40) {
                    tickerHistory[symbol] = tickerHistory[symbol].filter(h => now - h.t <= 20000);
                }
                
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
        // Apenas ping de latência e monitoramento de saúde, o ranking agora é WS real-time
        await axios.get('https://api.binance.com/api/v3/ping', { timeout: 2000 });
        globalMarket.lastLatency = Date.now() - t1;

        // Executar Scanners
        for (const [username, state] of userStates.entries()) {
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

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ALFA MASTER PRO na Porta ${PORT}`));

