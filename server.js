const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(cors());

// GLOBAL ERROR HANDLERS (DEBUG RAILWAY)
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Senhas de Acesso
const GLOBAL_ACCESS_KEY = 'alfa777';
const ADMIN_ACCESS_KEY = 'admin2026@'; // ATUALIZADO CONFORME SOLICITAÇÃO
const GMAIL_REGEX = /^[a-z0-9._%+-]+@gmail\.com$/;

// CONFIGURAÇÃO E PERSISTÊNCIA
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users_db.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'session_tokens.json'); // NOVO: Persistência de sessões

let usersDB = {}; 
if (fs.existsSync(USERS_FILE)) {
    try { usersDB = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
}
function saveUsersDB() { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2)); }

const activeTokens = new Map();
// Carregar sessões persistentes
if (fs.existsSync(SESSIONS_FILE)) {
    try {
        const savedSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        Object.keys(savedSessions).forEach(t => activeTokens.set(t, savedSessions[t]));
        console.log(`[SYSTEM] ${activeTokens.size} sessões recuperadas do disco.`);
    } catch (e) {}
}

function saveSessions() {
    const obj = {};
    activeTokens.forEach((v, k) => obj[k] = v);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
}

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
        isApproved: false, // BLOQUEIO INICIAL: Requer ativação do administrador
        // NOVO: Sistema de repetição — 2x seguidas OK, bloqueia por 2 ops
        lastSymbol: null,           // Última moeda comprada
        consecutiveCount: 0,        // Quantas vezes seguidas essa moeda foi comprada
        blockedSymbols: {},         // { symbol: opsRestantes } para desbloquear
        history: [], logs: [], balanceUSDT: 0,
        dashboardData: { topRanking: [], pivotInfo: null, volatilityMetrics: null, triggerProfitAnim: false },
        isLoopActive: false, activeSymbol: null, buyPrice: 0, targetPrice: 0, currentPrice: 0, buyQty: 0,
        buyPercentage: 0.99, pauseUntil: null, tradePauseUntil: null, recoveryMode: false, recoveryThreshold: -4.0,
        profitPoolUSDT: 0, realizedProfitBRL: 0
    };
}

async function binanceFetchBalance(username) {
    const account = await binanceRequest(username, '/api/v3/account');
    if (account && account.balances) {
        const usdt = account.balances.find(b => b.asset === 'USDT');
        if (usdt) return parseFloat(usdt.free);
    }
    return 0;
}

function loadUserState(username) {
    let state = userStates.get(username);
    const isNew = !state;
    if (isNew) state = createInitialState(username);
    
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    
    // MIGRATION: Se não existe minúsculo, procura por qualquer versão case-insensitive
    if (!fs.existsSync(userFile)) {
        const files = fs.readdirSync(DATA_DIR);
        const legacyFile = files.find(f => f.toLowerCase() === `trade_${username.toLowerCase()}.json`);
        if (legacyFile) {
            const oldPath = path.join(DATA_DIR, legacyFile);
            fs.renameSync(oldPath, userFile);
            console.log(`[SYSTEM] Migrado arquivo legado: ${legacyFile} -> ${path.basename(userFile)}`);
        }
    }

    if (fs.existsSync(userFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
            // Removemos logs do overwrite para não duplicar se já houver em memória
            const incomingLogs = data.logs || [];
            delete data.logs; 
            Object.assign(state, data);
            if (state.logs.length === 0) state.logs = incomingLogs;
            
            console.log(`[USER] Estado carregado para ${username}. Status: ${state.status} | Loop: ${state.isLoopActive}`);
        } catch (e) {}
    }
    if (!state.blockedSymbols || typeof state.blockedSymbols !== 'object') state.blockedSymbols = {};
    if (state.lastSymbol === undefined) state.lastSymbol = null;
    if (state.consecutiveCount === undefined) state.consecutiveCount = 0;
    if (!Array.isArray(state.logs)) state.logs = [];
    
    if (isNew) userStates.set(username, state);
    return state;
}

function saveUserState(username) {
    const state = userStates.get(username);
    if (!state) return;
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    fs.writeFileSync(userFile, JSON.stringify({ 
        clientName: state.clientName, history: state.history, opsCount: state.opsCount, 
        apiKey: state.apiKey, apiSecret: state.apiSecret, 
        buyPercentage: state.buyPercentage,
        lastSymbol: state.lastSymbol, consecutiveCount: state.consecutiveCount, blockedSymbols: state.blockedSymbols || {},
        status: state.status, isLoopActive: state.isLoopActive,
        activeSymbol: state.activeSymbol, buyPrice: state.buyPrice, buyQty: state.buyQty,
        targetPrice: state.targetPrice, currentPrice: state.currentPrice,
        pauseUntil: state.pauseUntil, logs: state.logs.slice(0, 30),
        profitPoolUSDT: state.profitPoolUSDT, realizedProfitBRL: state.realizedProfitBRL,
        isApproved: state.isApproved // Persistir status de aprovação
    }, null, 2));
}

function addLog(username, msg, type = 'info') {
    const state = userStates.get(username);
    if (!state) return;
    const timestamp = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    state.logs.unshift({ timestamp, msg, type });
    if (state.logs.length > 50) state.logs.pop();
    console.log(`[${username}] ${msg}`);
    
    // Salva logs importantes imediatamente
    if (type === 'buy' || type === 'card-sell' || type === 'error' || type === 'warn') {
        saveUserState(username);
    }
}

function sum24hProfit(history) {
    if (!history || history.length === 0) return 0;
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    return history
        .filter(h => {
             // Aceita formatos de data "15/03/2026, 09:30:00" ou timestamps ISO
             const hDate = new Date(h.date).getTime();
             return (now - hDate) < oneDay;
        })
        .reduce((sum, h) => sum + (h.profitPct || 0), 0);
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
setInterval(async () => { // OTIMIZAÇÃO: intervalo reduzido de 3000ms → 1500ms para menor latência no gatilho
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
            // PARÂMETRO OFICIAL: janela de 15s para cálculo preciso do gatilho
            if (now - globalMarket.priceHistory[coin.symbol].time >= 15000) {
                globalMarket.priceHistory[coin.symbol] = { old: coin.price, time: now };
            }
        }
        globalMarket.lastUpdate = now;

        for (const [username, state] of userStates) {
            // Sincronizar Pivô para todos (mesmo em trade)
            if (globalMarket.top10.length >= 6) {
                const r2 = globalMarket.top10[1];
                const r4 = globalMarket.top10[3];
                const r6 = globalMarket.top10[5];
                state.dashboardData.pivotInfo = { 
                    pivot: r4.symbol, 
                    d2: Math.abs(r2.vol24h - r4.vol24h).toFixed(2), 
                    d6: Math.abs(r6.vol24h - r4.vol24h).toFixed(2), 
                    t2: r2.symbol, t6: r6.symbol 
                };
            }

            // Atualizar Saldo USDT a cada ~30s
            if (now % 30000 < 3000) {
                binanceFetchBalance(username).then(bal => state.balanceUSDT = bal);
            }
            
            if (state.isLoopActive && (state.status === 'SCANNING' || state.status === 'PAUSED')) {
                await runFluxoAlfaScanner(username);
            }
        }
        } catch (e) {
            console.error("[MARKET ERROR] Falha ao buscar ranking Binance:", e.message);
        }
    }, 1500);

// --- NOVO: FUNÇÃO DE BOOTSTRAP PARA AUTO-RESUME ---
async function bootstrapRobots() {
    console.log("[SYSTEM] Verificando robôs para Auto-Resume...");
    if (!fs.existsSync(DATA_DIR)) return;

    const files = fs.readdirSync(DATA_DIR);
    const tradeFiles = files.filter(f => f.startsWith('trade_') && f.endsWith('.json'));

    for (const file of tradeFiles) {
        const username = file.replace('trade_', '').replace('.json', '');
        const state = loadUserState(username);

        // Se o robô estava em operação real, retomar o monitoramento
        if (state.isLoopActive && state.status === 'IN_TRADE' && state.activeSymbol) {
            console.log(`[RESUME] Retomando monitoramento de ${state.activeSymbol} para ${username}`);
            addLog(username, `🔄 Servidor Reiniciado. Retomando monitoramento de ${state.activeSymbol}...`, 'info');
            startTradeMonitor(username, state.activeSymbol);
        } else if (state.isLoopActive && (state.status === 'SCANNING' || state.status === 'PAUSED')) {
             console.log(`[RESUME] Reativando Radar para ${username}`);
        }
    }
}

// Iniciar bootstrap após o primeiro sync de mercado (3s depois)
setTimeout(bootstrapRobots, 5000);

async function runFluxoAlfaScanner(username) {
    const state = userStates.get(username);
    if (!state || globalMarket.top10.length < 6) return;

    // Verificação de Resumo de Pausa (Geral)
    if (state.status === 'PAUSED' && state.pauseUntil) {
        if (Date.now() < state.pauseUntil) return;
        state.status = 'SCANNING';
        state.pauseUntil = null;
        if (state.opsCount >= 5) state.opsCount = 0;
        addLog(username, "🔄 Pausa encerrada. Retomando radar...", 'info');
        saveUserState(username);
    }

    // PARÂMETRO OFICIAL: Pivô = rank4 | Monitorados = rank2, rank3, rank5, rank6
    const rank2 = globalMarket.top10[1];
    const rank3 = globalMarket.top10[2];
    const rank4 = globalMarket.top10[3]; // PIVÔ
    const rank5 = globalMarket.top10[4];
    const rank6 = globalMarket.top10[5];

    const d2 = Math.abs(rank2.vol24h - rank4.vol24h);
    const d3 = Math.abs(rank3.vol24h - rank4.vol24h);
    state.dashboardData.pivotInfo = { pivot: rank4.symbol, d2: d2.toFixed(2), d6: d3.toFixed(2), t2: rank2.symbol, t6: rank3.symbol };

    // Logs de Varredura a cada ~15s
    if (!state._lastLogTime || Date.now() - state._lastLogTime > 15000) {
        addLog(username, `🔍 VARREDURA: Pivô (4ª) ${rank4.symbol} [${rank4.vol24h.toFixed(2)}%]`, 'info');
        addLog(username, `📏 Radar: R2:${rank2.symbol} | R3:${rank3.symbol} | R5:${rank5.symbol} | R6:${rank6.symbol}`, 'info');
        state._lastLogTime = Date.now();
    }

    // PARÂMETRO OFICIAL: primeiro dos 4 candidatos que atingir +0.3% em 15s é comprado
    const candidates = [rank2, rank3, rank5, rank6];
    let target = null;
    let triggerJump = 0;
    let triggerRank = '';

    for (let i = 0; i < candidates.length; i++) {
        const coin = candidates[i];
        const jump = globalMarket.coinJumps[coin.symbol] || 0;
        if (jump >= 0.3) {
            target = coin;
            triggerJump = jump;
            triggerRank = [2, 3, 5, 6][i];
            break;
        }
    }

    if (!target) return;

    // PARÂMETRO OFICIAL: Filtro de Repetição — 2x seguidas OK, bloqueia por 2 ops
    if (state.blockedSymbols[target.symbol] > 0) {
        if (!state._lastRepLog || state._lastRepLog !== target.symbol) {
            addLog(username, `🛡️ Filtro: ${target.symbol} bloqueada (${state.blockedSymbols[target.symbol]} op(s) restantes).`, 'warn');
            state._lastRepLog = target.symbol;
        }
        return;
    }

    // Reset logs repetitivos ao encontrar gatilho real
    state._lastVolLog = null;
    state._lastRepLog = null;

    addLog(username, `🎯 GATILHO RANK ${triggerRank}: ${target.symbol} (+${triggerJump.toFixed(2)}% em 15s)`, 'trigger');

    // Acionamento de Pausa por Ciclo (5 ops / 10min)
    if (state.opsCount >= 5 && state.isLoopActive && !state.pauseUntil) {
        state.pauseUntil = Date.now() + 10 * 60000;
        state.status = 'PAUSED';
        addLog(username, "🛑 Ciclo de 5 concluído. Pausa de 10min ativada.", 'warn');
        saveUserState(username);
        return;
    }

    await executeRealBuy(username, target.symbol, target.price);
}

async function executeRealBuy(username, symbol, price) {
    const state = userStates.get(username);
    state.status = 'IN_TRADE';
    state.activeSymbol = symbol;

    // OTIMIZAÇÃO: usar saldo cacheado para evitar chamada serial à Binance antes de cada compra
    // Se o cache estiver zerado, busca uma vez como fallback
    let usdt = state.balanceUSDT || 0;
    if (usdt < 11) {
        addLog(username, `⏳ Cache de saldo baixo ($${usdt.toFixed(2)}). Buscando saldo atualizado...`, 'info');
        const account = await binanceRequest(username, '/api/v3/account');
        if (account.error) {
            addLog(username, `Erro Saldo: ${account.msg}`, 'error');
            return resetTradeState(username);
        }
        usdt = parseFloat(account.balances.find(b => b.asset === 'USDT')?.free || 0);
        state.balanceUSDT = usdt; // Atualizar cache
    }

    addLog(username, `🎯 GATILHO: ${symbol}. Saldo: $${usdt.toFixed(2)} (cache)`, 'trigger');

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
    state.buyQty = qty;            state.targetPrice = realPrice * 1.006; // PARÂMETRO OFICIAL: META 0.6%
    addLog(username, `🚀 COMPRA EXECUTADA: ${symbol} @ $${realPrice.toFixed(6)}`, 'buy');
    
    startTradeMonitor(username, symbol);
}

function startTradeMonitor(username, symbol) {
    const state = userStates.get(username);
    const interval = setInterval(async () => {
        if (state.status !== 'IN_TRADE') return clearInterval(interval);
        
        // Se estiver num período de congelamento da operação (Recovery), não consulta preço
        if (state.tradePauseUntil && Date.now() < state.tradePauseUntil) return;

        try {
            const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            const current = parseFloat(res.data.price);
            state.currentPrice = current;

            const roi = ((current - state.buyPrice) / state.buyPrice) * 100;

            // RECUPERAÇÃO INICIAL: Bateu -5%
            if (roi <= -5.0 && !state.recoveryMode) {
                state.recoveryMode = true;
                state.recoveryThreshold = -4.0; // Próximo degrau de avanço
                state.tradePauseUntil = Date.now() + 10 * 60000;
                addLog(username, `🧊 OP CONGELADA: -5% atingido na operação. Congelando por 10min.`, 'warn');
                saveUserState(username);
                return;
            }

            // DURANTE A RECUPERAÇÃO
            if (state.recoveryMode) {
                // Avançou um degrau (ex: voltou pra -4%)
                if (roi >= state.recoveryThreshold && roi < 0) {
                    state.tradePauseUntil = Date.now() + 2 * 60000;
                    addLog(username, `🧊 RECUPERAÇÃO: Avançou para ${roi.toFixed(2)}%. Congelando operação por +2min.`, 'warn');
                    state.recoveryThreshold += 1.0; 
                    saveUserState(username);
                    return;
                }

                // Recuperou os 5% (voltou ao zero a zero original)
                if (roi >= 0) {
                    clearInterval(interval);
                    state.recoveryMode = false;
                    state.tradePauseUntil = null;
                    addLog(username, `✅ RECUPERAÇÃO CONCLUÍDA: Vendendo no 0 a 0 e retomando radar normal.`, 'buy');
                    await executeRealSell(username, symbol, 'RECUPERACAO');
                    return;
                }
            } else {
                // OPERAÇÃO NORMAL SE NÃO ESTIVER EM RECUPERAÇÃO
                if (current >= state.targetPrice) {
                    clearInterval(interval);
                    await executeRealSell(username, symbol, 'LUCRO');
                }
            }
        } catch (e) {}
    }, 2000);
}

async function executeRealSell(username, symbol, reason) {
    const state = userStates.get(username);
    if (state._isSelling) return; // BLOQUEIO DE CONCORRÊNCIA
    state._isSelling = true;

    try {
        const coinBase = symbol.replace('USDT', '');
    
    addLog(username, `💰 VENDENDO: ${symbol} (${reason})`, 'info');

    const account = await binanceRequest(username, '/api/v3/account');
    if (account.error) return addLog(username, `Erro Venda (Account): ${account.msg}`, 'error');

    const balance = parseFloat(account.balances.find(b => b.asset === coinBase)?.free || 0);
    if (balance <= 0) return resetTradeState(username);

    // Filtro Matemático Blindado de Precisão (LOT_SIZE)
    let stepPrecision = 0;
    let stepSizeNum = 0;
    if (globalMarket.exchangeInfo) {
        const sInfo = globalMarket.exchangeInfo.symbols.find(s => s.symbol === symbol);
        const lot = sInfo?.filters.find(f => f.filterType === 'LOT_SIZE');
        if (lot) {
            stepSizeNum = parseFloat(lot.stepSize);
            const stepStr = stepSizeNum.toString();
            if (stepStr.includes('.')) {
                stepPrecision = stepStr.split('.')[1].length;
            }
        }
    }

    let truncatedBalance = balance;
    if (stepSizeNum > 0) {
        // Trunca exatamente no múltiplo do stepSize permitido pela Binance
        truncatedBalance = Math.floor((balance + 1e-9) / stepSizeNum) * stepSizeNum;
    } else {
        truncatedBalance = Math.floor(balance);
    }
    
    if (truncatedBalance <= 0) {
        if (balance > 0) {
            addLog(username, `Sobra de poeira ignorada (${balance} ${coinBase})`, 'info');
        }
        state._isSelling = false;
        return resetTradeState(username);
    }
    
    const quantityString = stepPrecision > 0 ? truncatedBalance.toFixed(stepPrecision) : truncatedBalance.toString();

    const order = await binanceRequest(username, '/api/v3/order', 'POST', {
        symbol, side: 'SELL', type: 'MARKET', quantity: quantityString
    });

    if (order.error) {
        addLog(username, `Erro Venda: ${order.msg}`, 'error');
        state._isSelling = false;
        return; 
    }

    let realSellPrice = state.currentPrice;
    if (order.fills && order.fills.length > 0) {
        let totalQtyFilled = 0;
        let totalCost = 0;
        order.fills.forEach(f => {
            let p = parseFloat(f.price);
            let q = parseFloat(f.qty);
            totalQtyFilled += q;
            totalCost += (p * q);
        });
        if (totalQtyFilled > 0) realSellPrice = totalCost / totalQtyFilled;
    }

    const profit = ((realSellPrice - state.buyPrice) / state.buyPrice) * 100; // Porcentagem real
    const histType = reason === 'ANTI-RESTART' ? 'ANTI-RESTART (AUTO)' : (reason === 'LUCRO' ? 'LUCRO ELITE' : reason);
    state.history.unshift({ symbol, date: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), profitPct: parseFloat(profit.toFixed(2)), type: histType });

    // PARÂMETRO OFICIAL: Atualizar controle de repetição de moeda
    if (!state.blockedSymbols) state.blockedSymbols = {};
    if (symbol === state.lastSymbol) {
        state.consecutiveCount = (state.consecutiveCount || 0) + 1;
        if (state.consecutiveCount >= 2) {
            // Bloqueada por 2 operações após 2x seguidas
            state.blockedSymbols[symbol] = 2;
            state.consecutiveCount = 0;
            addLog(username, `🔒 ${symbol} bloqueada por 2 operações (comprada 2x consecutivas).`, 'warn');
        }
    } else {
        // Nova moeda: decrementar bloqueios e resetar consecutivos
        state.consecutiveCount = 1;
        Object.keys(state.blockedSymbols).forEach(s => {
            state.blockedSymbols[s]--;
            if (state.blockedSymbols[s] <= 0) delete state.blockedSymbols[s];
        });
    }
    state.lastSymbol = symbol;
    state.opsCount++;

    // Lógica de Acúmulo para Realização em BRL (USANDO VALORES REAIS DA BINANCE)
    const tradeProfitUSDT = (truncatedBalance * realSellPrice) - (truncatedBalance * state.buyPrice);
    if (tradeProfitUSDT > 0) {
        state.profitPoolUSDT += tradeProfitUSDT;
        addLog(username, `💵 Lucro Real (sobre ${truncatedBalance} moedas): +$${tradeProfitUSDT.toFixed(2)}. Acumulado BRL: $${state.profitPoolUSDT.toFixed(2)} / $20.00`, 'info');
    }

    // ATIVAR SUPER CARD NO MEIO DA TELA
    state.dashboardData.triggerProfitAnim = true;
    setTimeout(() => {
        const s = userStates.get(username);
        if (s) s.dashboardData.triggerProfitAnim = false;
    }, 5000);

    addLog(username, `💰✅ SUCESSO ABSOLUTO: ${symbol} Vendido com +${profit.toFixed(2)}% de Lucro!`, 'card-sell');
    state._isSelling = false;
    resetTradeState(username);
    saveUserState(username);

    // Verificar se atingiu a meta de $20 para converter BRL
    if (state.profitPoolUSDT >= 20) {
        realizeProfitToBRL(username);
    }
} catch (e) {
    console.error("Erro Crítico na Venda:", e);
    state._isSelling = false;
}
}

async function realizeProfitToBRL(username) {
    const state = userStates.get(username);
    if (!state) return;

    addLog(username, `🇧🇷 ALVO ATINGIDO: Convertendo $20.00 de lucro para BRL...`, 'warn');

    try {
        // Vender 20 USDT pelo par USDTBRL (Compra BRL a mercado)
        const order = await binanceRequest(username, '/api/v3/order', 'POST', {
            symbol: 'USDTBRL',
            side: 'SELL',
            type: 'MARKET',
            quantity: "20.00"
        });

        if (order.error) {
            addLog(username, `Erro na conversão BRL: ${order.msg}`, 'error');
            return;
        }

        let brlReceived = 0;
        if (order.fills?.length > 0) {
            brlReceived = order.fills.reduce((sum, f) => sum + parseFloat(f.quoteQty), 0);
        }

        state.realizedProfitBRL += brlReceived;
        state.profitPoolUSDT -= 20;
        
        // Pausa de 10 minutos conforme solicitado
        state.pauseUntil = Date.now() + 10 * 60000;
        state.status = 'PAUSED';

        addLog(username, `✅ LUCRO PROTEGIDO: R$ ${brlReceived.toFixed(2)} adicionados à sua carteira. O robô entrará em pausa de 10 minutos.`, 'buy');
        saveUserState(username);

    } catch (e) {
        addLog(username, `Erro crítico BRL: ${e.message}`, 'error');
    }
}

async function startFluxoAlfa(username) {
    const state = userStates.get(username);
    if (!state) return;

    addLog(username, "⚡ Verificando integridade e buscando posições abertas...", 'info');
    
    // Tentar resgatar trade se o arquivo foi perdido mas a conta tem moedas
    const rescued = await rescueTradeState(username);
    if (rescued) return; // Se resgatou, o startTradeMonitor já foi lançado

    state.isLoopActive = true;
    state.status = 'SCANNING';
    saveUserState(username);
    addLog(username, "🔍 Radar Alfa iniciado. Aguardando sinal de entrada...", 'info');
}

async function rescueTradeState(username) {
    try {
        const account = await binanceRequest(username, '/api/v3/account');
        if (account.error) return false;

        // 1. Filtrar todos os saldos significativos (que não sejam moedas base/estáveis)
        const candidates = account.balances.filter(b => 
            !['USDT', 'FDUSD', 'BNB', 'USDC', 'ETH', 'BTC'].includes(b.asset) && 
            parseFloat(b.free) > 0
        );

        if (candidates.length === 0) return false;

        console.log(`[RESCUE] Candidatos encontrados: ${candidates.map(c => c.asset).join(', ')}`);

        // 2. Tentar encontrar o trade real (o que tem histórico de compra mais recente)
        for (const balance of candidates) {
            const symbol = balance.asset + 'USDT';
            
            // Verificar se o par existe e está ativo
            const sInfo = globalMarket.exchangeInfo?.symbols.find(s => s.symbol === symbol);
            if (!sInfo || sInfo.status !== 'TRADING') continue;

            const qty = parseFloat(balance.free);
            
            // Buscar histórico de ordens para este símbolo
            const orders = await binanceRequest(username, '/api/v3/allOrders', 'GET', { symbol, limit: 10 });
            if (orders.error) continue;

            // Encontrar a última COMPRA preenchida
            const lastBuy = [...orders].reverse().find(o => o.side === 'BUY' && o.status === 'FILLED');
            
            if (lastBuy) {
                // Verificar se a quantidade atual é compatível com a compra (para não pegar dust antigo)
                const boughtQty = parseFloat(lastBuy.origQty);
                if (qty < boughtQty * 0.9) continue; // Se sobrou menos de 90%, provavelmente é sobra de um trade antigo

                const state = userStates.get(username);
                state.status = 'IN_TRADE';
                state.activeSymbol = symbol;
                state.buyPrice = parseFloat(lastBuy.price) || parseFloat(lastBuy.cummulativeQuoteQty) / parseFloat(lastBuy.executedQty) || 0;
                state.buyQty = qty;
                state.targetPrice = state.buyPrice * 1.009;
                state.isLoopActive = true;
                
                addLog(username, `♻️ POSIÇÃO RESGATADA: ${symbol} comprada a $${state.buyPrice.toFixed(6)}. Retomando monitoramento de lucro.`, 'buy');
                saveUserState(username);
                startTradeMonitor(username, symbol);
                return true;
            }
        }
    } catch (e) {
        console.error(`[RESCUE] Erro crítico ao resgatar trade para ${username}:`, e.message);
    }
    return false;
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

// --- SISTEMA DE LOGIN SIMPLIFICADO ---
app.post('/login', (req, res) => {
    let { email, password } = req.body;
    const entry = (email || '').trim().toLowerCase();
    const secret = (password || '').trim().toLowerCase();
    const MASTER_KEY = ADMIN_ACCESS_KEY.toLowerCase();

    // CASO 1: ADMINISTRADOR (ENTRADA DIRETA - SEM SENSIBILIDADE A MAIÚSCULAS)
    if (entry === MASTER_KEY || secret === MASTER_KEY) {
        const token = ADMIN_ACCESS_KEY; // A PRÓPRIA SENHA É O TOKEN DO ADMIN
        activeTokens.set(token, 'ADMIN_CONTROL');
        return res.json({ token, username: 'ADMIN', isAdmin: true });
    }

    if (!entry || !secret) return res.status(400).json({ error: 'Preencha E-mail e Senha' });

    // CASO 2: CLIENTE
    if (!GMAIL_REGEX.test(entry.toLowerCase())) {
        return res.status(400).json({ error: 'Use um e-mail @gmail.com válido.' });
    }

    const username = entry.toLowerCase();

    // REGISTRO OU LOGIN
    if (!usersDB[username]) {
        usersDB[username] = { password: secret, registeredAt: new Date().toISOString(), isApproved: false };
        saveUsersDB();
        return res.status(403).json({ error: 'Cadastro realizado! Aguarde ativação do suporte.' });
    }

    if (usersDB[username].password !== secret) {
        return res.status(401).json({ error: 'Senha incorreta.' });
    }

    if (usersDB[username].isApproved === false) {
        return res.status(403).json({ error: 'Aguardando ativação pelo administrador.' });
    }

    loadUserState(username);
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.set(token, username);
    saveSessions();
    return res.json({ token, username });
});

// Admin endpoint: Aprovar usuário
app.post('/admin/approve-user', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${ADMIN_ACCESS_KEY}`) return res.status(401).send();
    
    const { targetUser } = req.body;
    if (!usersDB[targetUser]) return res.status(404).json({ error: 'Não encontrado' });
    
    usersDB[targetUser].isApproved = true;
    saveUsersDB();
    
    const state = loadUserState(targetUser);
    state.isApproved = true;
    saveUserState(targetUser);

    console.log(`[ADMIN] Usuário ${targetUser} APROVADO.`);
    res.json({ success: true });
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
    data.profit24h = sum24hProfit(req.state.history);
    data.profitPoolUSDT = req.state.profitPoolUSDT || 0;
    data.realizedProfitBRL = req.state.realizedProfitBRL || 0;
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
                opsCount: req.state.opsCount || 0,
                pauseUntil: null
            });
            saveUserState(req.username);
            
            // Inicia o Radar ou Resgata Operação Ativa
            startFluxoAlfa(req.username);
            
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

// ROTA ADMIN
app.get('/painel_alfa', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin/overview', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${GLOBAL_ACCESS_KEY}` && auth !== `Bearer ${ADMIN_ACCESS_KEY}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    const overview = [];
    // 1. Unificar todos os usuários (DB e Memória)
    const allUsernames = new Set([...Object.keys(usersDB), ...userStates.keys()]);
    
    for (const username of allUsernames) {
        const state = loadUserState(username);
        const dbUser = usersDB[username] || {};
        
        overview.push({
            username,
            status: state.status,
            isApproved: dbUser.isApproved !== false, // Antigos são true por padrão
            activeSymbol: state.activeSymbol || '---',
            balanceUSDT: state.balanceUSDT || 0,
            buyAmountUSDT: state.buyQty * state.buyPrice || 0,
            buyPrice: state.buyPrice || 0,
            targetPrice: state.targetPrice || 0,
            currentPrice: state.currentPrice || 0,
            totalProfit: state.history.reduce((sum, h) => sum + (h.profitPct || 0), 0),
            profit24h: sum24hProfit(state.history),
            realizedProfitBRL: state.realizedProfitBRL || 0,
            currentStep: state.status === 'SCANNING' ? 'Monitorando Radar' : (state.status === 'IN_TRADE' ? 'Em Trade (Alvo 0.9%)' : 'Aguardando Start')
        });
    }
    res.json(overview);
});

app.post('/admin/stop-all', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${GLOBAL_ACCESS_KEY}` && auth !== `Bearer ${ADMIN_ACCESS_KEY}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    for (const [username, state] of userStates.entries()) {
        state.isLoopActive = false;
        state.status = 'OFFLINE';
        addLog(username, "🚨 EMERGÊNCIA: Todos os robôs desligados via Stop Global.", 'error');
        saveUserState(username);
    }
    res.json({ success: true, count: userStates.size });
});

app.post('/admin/stop-user', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${GLOBAL_ACCESS_KEY}` && auth !== `Bearer ${ADMIN_ACCESS_KEY}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    const { targetUser } = req.body;
    const state = userStates.get(targetUser);
    if (state) {
        state.isLoopActive = false;
        state.status = 'OFFLINE';
        addLog(targetUser, "🛑 INTERRUPÇÃO ADMINISTRATIVA: Robô desligado via Painel Admin.", 'warn');
        saveUserState(targetUser);
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Usuário não encontrado' });
});

app.post('/admin/anti-restart', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${GLOBAL_ACCESS_KEY}` && auth !== `Bearer ${ADMIN_ACCESS_KEY}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    const { targetUser } = req.body;
    const state = userStates.get(targetUser);
    if (state) {
        if (state.status === 'IN_TRADE' && state.activeSymbol) {
            addLog(targetUser, "⚡ ANTI-RESTART MANUAL: Forçando venda e retomada via Admin.", 'warn');
            await executeRealSell(targetUser, state.activeSymbol, 'ANTI-RESTART');
        } else {
            state.status = 'SCANNING';
        }
        state.isLoopActive = true;
        saveUserState(targetUser);
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Usuário não encontrado' });
});

app.post('/admin/delete-user', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${GLOBAL_ACCESS_KEY}` && auth !== `Bearer ${ADMIN_ACCESS_KEY}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    const { targetUser } = req.body;
    if (!targetUser) return res.status(400).json({ error: 'Usuário não especificado' });

    console.log(`[ADMIN] Tentando deletar usuário: ${targetUser}`);

    // 1. Parar robô se estiver ativo
    const state = userStates.get(targetUser);
    if (state) {
        state.isLoopActive = false;
        state.status = 'OFFLINE';
    }

    // 2. Remover da Memória
    userStates.delete(targetUser);

    // 3. Remover do DB de Usuários
    if (usersDB[targetUser]) {
        delete usersDB[targetUser];
        saveUsersDB();
    }

    // 4. Deletar Arquivo Físico
    const userFile = path.join(DATA_DIR, `trade_${targetUser}.json`);
    if (fs.existsSync(userFile)) {
        try {
            fs.unlinkSync(userFile);
            console.log(`[ADMIN] Arquivo deletado: ${userFile}`);
        } catch (e) {
            console.error(`[ADMIN] Erro ao deletar arquivo trade de ${targetUser}:`, e.message);
        }
    }

    res.json({ success: true, message: `Usuário ${targetUser} removido permanentemente.` });
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Elite Fluxo Alfa Real na Porta ${PORT}`));
