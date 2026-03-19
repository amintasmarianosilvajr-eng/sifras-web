const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(cors());

// Forçar limpeza de cache em todas as requisições
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

app.use(express.static(__dirname)); // Serve arquivos estáticos da raiz (logo, etc)

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

// MIGRAÇÃO RADICAL: Garantir que tudo no DB e Arquivos seja MINÚSCULO
function migrateToLowercase() {
    let changed = false;
    const newDB = {};
    for (const k of Object.keys(usersDB)) {
        if (k !== k.toLowerCase()) {
            newDB[k.toLowerCase()] = usersDB[k];
            changed = true;
        } else {
            newDB[k] = usersDB[k];
        }
    }
    if (changed) {
        usersDB = newDB;
        saveUsersDB();
        console.log("[SYSTEM] Database migrado para lowercase.");
    }
    
    // Migrar Arquivos Físicos
    if (fs.existsSync(DATA_DIR)) {
        const files = fs.readdirSync(DATA_DIR);
        files.forEach(f => {
            if (f.startsWith('trade_') && f.endsWith('.json')) {
                const lower = f.toLowerCase();
                if (f !== lower) {
                    try { fs.renameSync(path.join(DATA_DIR, f), path.join(DATA_DIR, lower)); } catch(e){}
                }
            }
        });
    }
}
migrateToLowercase();

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
        lastCoin: '',
        consecutiveCount: 0,
        cooldownCoins: {}, // { symbol: opsRemaining }
        liquidPnlPool: 0,   // NOVO: PNL Alfa Líquido (Somatório de lucros reais líq.)
        history: [], logs: [], balanceUSDT: 0, lastCoins: [],
        dashboardData: { topRanking: [], pivotInfo: null, volatilityMetrics: null, triggerProfitAnim: false },
        isLoopActive: false, activeSymbol: null, buyPrice: 0, targetPrice: 0, currentPrice: 0, buyQty: 0,
        buyPercentage: 0.99, pauseUntil: null, recoveryMode: false, recoveryThreshold: -4.0,
        profitPoolUSDT: 0, realizedProfitBRL: 0,
        salesCount: 0, initialDayBalance: 0, initialDayTimestamp: 0,
        lastSearchLogTime: 0
    };
}

async function binanceFetchBalance(username) {
    const state = userStates.get(username);
    if (!state) return 0;
    
    // Se não tem chaves, não consegue buscar
    if (!state.apiKey || !state.apiSecret) return state.balanceUSDT || 0;

    try {
        const account = await binanceRequest(username, '/api/v3/account');
        if (account && account.balances) {
            const usdt = account.balances.find(b => b.asset === 'USDT');
            if (usdt) {
                const balance = parseFloat(usdt.free);
                state.balanceUSDT = balance;
                return balance;
            }
        }
    } catch (e) {
        console.error(`[BALANCE ERROR] ${username}:`, e.message);
    }
    return state.balanceUSDT || 0;
}

function loadUserState(rawUsername) {
    const username = rawUsername.toLowerCase();
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
    if (!state.cooldownCoins || typeof state.cooldownCoins !== 'object') state.cooldownCoins = {};
    if (state.lastCoin === undefined) state.lastCoin = '';
    if (state.consecutiveCount === undefined) state.consecutiveCount = 0;
    if (!Array.isArray(state.logs)) state.logs = [];
    
    if (isNew) userStates.set(username, state);
    return state;
}

function saveUserState(rawUsername) {
    const username = rawUsername.toLowerCase();
    const state = userStates.get(username);
    if (!state) return;
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    fs.writeFileSync(userFile, JSON.stringify({ 
        clientName: state.clientName, history: state.history, opsCount: state.opsCount, 
        apiKey: state.apiKey, apiSecret: state.apiSecret, 
        buyPercentage: state.buyPercentage,
        lastCoin: state.lastCoin, consecutiveCount: state.consecutiveCount, cooldownCoins: state.cooldownCoins || {},
        status: state.status, isLoopActive: state.isLoopActive,
        activeSymbol: state.activeSymbol, buyPrice: state.buyPrice, buyQty: state.buyQty,
        targetPrice: state.targetPrice, currentPrice: state.currentPrice,
        pauseUntil: state.pauseUntil, logs: state.logs.slice(0, 30),
        profitPoolUSDT: state.profitPoolUSDT, realizedProfitBRL: state.realizedProfitBRL,
        salesCount: state.salesCount || 0, initialDayBalance: state.initialDayBalance || 0,
        initialDayTimestamp: state.initialDayTimestamp || 0,
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

function isNewDay(timestamp) {
    if (!timestamp) return true;
    const date = new Date(timestamp);
    const now = new Date();
    const dateStr = date.toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo' });
    const nowStr = now.toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo' });
    return dateStr !== nowStr;
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

async function syncExchangeInfo() {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
        if (res.data && res.data.symbols) {
            globalMarket.exchangeInfo = res.data;
            console.log(`[SYSTEM] ExchangeInfo Sincronizado. ${res.data.symbols.length} símbolos carregados.`);
        }
    } catch (e) {
        console.error("Erro ao sincronizar exchangeInfo:", e.message);
    }
}
syncExchangeInfo();
setInterval(syncExchangeInfo, 3600000); // Sync a cada 1 hora

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
// SINCRONIZAÇÃO MERCADO (Recursivo p/ evitar sobreposição)
// ------------------------------------------------------------
let isMarketLoopRunning = false;
async function startMarketLoop() {
    if (isMarketLoopRunning) return;
    isMarketLoopRunning = true;
    
    try {
        const now = Date.now();
        
        // 1. Atualizar Ticker Completo (50 moedas) para filtragem "Ocultas" (30s)
        if (!globalMarket.lastTickerFetch || now - globalMarket.lastTickerFetch > 30000) {
            const tRes = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
            globalMarket.tickerCache = tRes.data
                .filter(i => i.symbol.endsWith('USDT'))
                .sort((a,b) => b.quoteVolume - a.quoteVolume)
                .slice(0, 50)
                .map(i => i.symbol);
            globalMarket.lastTickerFetch = now;
        }

        // 2. Buscar Ranks do Ticker (Volatilidade/Mudança)
        const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
        const data = res.data;
        
        globalMarket.top10 = data
            .filter(i => i.symbol.endsWith('USDT'))
            .map(i => ({ 
                symbol: i.symbol, 
                price: parseFloat(i.lastPrice), 
                change: parseFloat(i.priceChangePercent) 
            }))
            .sort((a, b) => b.change - a.change)
            .slice(0, 10);
        
        // Atribuir Pivô Global (Rank 4)
        if (globalMarket.top10.length >= 4) {
            globalMarket.pivot = globalMarket.top10[3].symbol;
        }

        // 3. Monitorar Histórico de Preços (Janela Deslizante de 10-15s)
        const tenSecsAgo = now - 10 * 1000;
        const cutoff = now - 15 * 1000; // 2. CLEANUP (Keep 15s for extra margin)

        for (const coin of globalMarket.top10) {
            if (!globalMarket.priceHistory[coin.symbol]) {
                globalMarket.priceHistory[coin.symbol] = [];
                globalMarket.coinJumps[coin.symbol] = 0;
            }
            
            const history = globalMarket.priceHistory[coin.symbol];
            history.push({ price: coin.price, time: now });

            // Encontrar o preço de ~10 segundos atrás (Garantir que tenha pelo menos 10s)
            const oldEnough = history.filter(h => h.time <= tenSecsAgo);
            
            if (oldEnough.length > 0) {
                const refPoint = oldEnough[oldEnough.length - 1]; // O mais próximo de 10s atrás
                const jump = ((coin.price - refPoint.price) / refPoint.price) * 100;
                globalMarket.coinJumps[coin.symbol] = jump;
            } else {
                globalMarket.coinJumps[coin.symbol] = 0; // Aguardando base de 10s
            }

            // Limpar histórico antigo (>15s para garantir margem para o cálculo de 10s)
            globalMarket.priceHistory[coin.symbol] = history.filter(h => now - h.time < 15000);
        }

        // NOVO: Cálculo de Sentimento de Mercado (para narração detalhada)
        const avgGlobalChange = globalMarket.top10.reduce((s, c) => s + c.change, 0) / (globalMarket.top10.length || 1);
        globalMarket.sentiment = avgGlobalChange > 0 ? "ALTA" : "BAIXA";
        globalMarket.marketStrength = Math.abs(avgGlobalChange).toFixed(2);

        // 4. Fluxo por Usuário
        for (const [username, state] of userStates) {
            // Sincronizar Pivô e Telemetria para o Dashboard (mesmo em trade)
            // SINCRONIZAR TELEMETRIA PARA O DASHBOARD (VINCULADO AO MONITORAMENTO DO SCANNER)
            // Removido loop redundante que sobrepunha os dados de R2/R3.

            // ATUALIZAR SALDO PERIODICAMENTE (CADA 30 SEGUNDOS) PARA TODOS CONECTADOS
            if (!state._lastBalanceUpdate || now - state._lastBalanceUpdate > 30000) {
                binanceFetchBalance(username).catch(e => {}); 
                state._lastBalanceUpdate = now;
            }

            if (state.pauseUntil && now < state.pauseUntil) continue;

            // BLOQUEIO DE CONCORRÊNCIA POR USUÁRIO
            if (state._isScanning) continue;
            state._isScanning = true;
            try {
                await runFluxoAlfaScanner(username);
            } finally {
                state._isScanning = false;
            }
        }
    } catch (e) { 
        console.error("[MARKET ERROR]:", e.message); 
    } finally {
        isMarketLoopRunning = false;
        setTimeout(startMarketLoop, 1500); // Agenda a próxima execução APÓS o término desta
    }
}
startMarketLoop(); // Início oficial

function shouldExcludeCoin(symbol) {
    // 1. Blacklist Permanente (Fan Tokens, Stables, Suspeitas)
    if (BLACKLIST.some(kw => symbol.includes(kw))) return true;

    // 2. Filtro de Volume/Visibilidade (Top 50 por Volume Quote)
    if (globalMarket.tickerCache && !globalMarket.tickerCache.includes(symbol)) return true;

    // 3. Filtro de Tags de Risco e Status (Monitoramento, Seed, Deslistagem)
    if (globalMarket.exchangeInfo) {
        const sInfo = globalMarket.exchangeInfo.symbols.find(s => s.symbol === symbol);
        if (sInfo) {
            if (sInfo.status !== 'TRADING') return true;
            const tags = sInfo.tags || [];
            if (tags.includes('monitoring') || tags.includes('seed')) return true;
        }
    }
    return false;
}

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
             // Garantir saldo atualizado no início
             binanceFetchBalance(username).catch(() => {});
        }
    }
}

// Iniciar bootstrap após o primeiro sync de mercado (3s depois)
setTimeout(bootstrapRobots, 5000);

async function runFluxoAlfaScanner(username) {
    const state = userStates.get(username);
    if (!state || globalMarket.top10.length < 6) return;

    // BLOQUEIO TOTAL: O scanner só age se estiver em modo SCANNING ou se precisar sair de PAUSA
    if (state.status !== 'SCANNING' && state.status !== 'PAUSED') return;

    // Verificação de Resumo de Pausa (Geral)
    if (state.status === 'PAUSED' && state.pauseUntil) {
        if (Date.now() < state.pauseUntil) return;
        state.status = 'SCANNING';
        state.pauseUntil = null;
        // Update cooldowns for other coins
        if (state.cooldownCoins) {
            for (let c in state.cooldownCoins) {
                if (state.cooldownCoins[c] > 0) state.cooldownCoins[c]--;
            }
        }
        if (state.opsCount >= 5) state.opsCount = 0;
        addLog(username, "🔄 Pausa encerrada. Retomando radar...", 'info');
        saveUserState(username);
    }

    const rank2 = globalMarket.top10[1];
    const rank3 = globalMarket.top10[2];
    const rank4 = globalMarket.top10[3]; // PIVÔ E CANDIDATO

    // ATUALIZAR PIXEL INFO NO DASHBOARD (R2, R3 e R4)
    const d2 = Math.abs(rank2.change - rank4.change);
    const d3 = Math.abs(rank3.change - rank4.change);
    state.dashboardData.pivotInfo = { 
        pivot: rank4.symbol, 
        d2: d2.toFixed(2), 
        d3: d3.toFixed(2), 
        t2: rank2.symbol, t3: rank3.symbol, t4: rank4.symbol,
        j2: (globalMarket.coinJumps[rank2.symbol] || 0).toFixed(2),
        j3: (globalMarket.coinJumps[rank3.symbol] || 0).toFixed(2),
        j4: (globalMarket.coinJumps[rank4.symbol] || 0).toFixed(2)
    };

    // LOGS DE VARREDURA NARRADOS
    // LOG INTERVAL: Apenas a cada 10 segundos
    const now = Date.now();
    const lastLog = state.lastScannerLog || 0;
    const shouldLog = (now - lastLog) >= 10000;
    if (shouldLog) state.lastScannerLog = now;

    if (shouldLog) {
        // Encontrar maior movimento na piscina de 50 moedas para "narração"
        const movers = Object.keys(globalMarket.coinJumps)
            .map(s => ({ s, j: globalMarket.coinJumps[s] }))
            .sort((a,b) => b.j - a.j);
        const topMover = movers[0] || { s: '---', j: 0 };
        
        addLog(username, `🌊 FLUXO ALFA: Mercado em tendência de ${globalMarket.sentiment} (${globalMarket.marketStrength}%).`, 'info');
        addLog(username, `💡 DESTAQUE RADAR: ${topMover.s} é a moeda mais agressiva (+${topMover.j.toFixed(2)}% jump em 10s).`, 'info');
        addLog(username, `🔍 BUSCANDO EM: R2:${rank2.symbol} | R3:${rank3.symbol} | R4:${rank4.symbol}`, 'info');
        
        if (topMover.s !== rank2.symbol && topMover.s !== rank3.symbol && topMover.s !== rank4.symbol && topMover.j >= 0.1) {
            addLog(username, `💡 INFO: ${topMover.s} está em ALTA (+${topMover.j.toFixed(2)}%), mas não pertence ao RANK 2, 3 ou 4 para gatilho.`, 'info');
        }
        // LOG DIAGNÓSTICO (Apenas Console)
        console.log(`[SCANNER] ${username} | TOP4: R1:${globalMarket.top10[0].symbol} R2:${rank2.symbol} R3:${rank3.symbol} R4:${rank4.symbol} (Pivot)`);
    }

    // MONITORAR TENDÊNCIA E GATILHO (Foco R2, R3 e R4)
    const candidates = [rank2, rank3, rank4];
    let target = null;
    let triggerJump = 0;
    let triggerRank = '';

    for (let i = 0; i < candidates.length; i++) {
        const coin = candidates[i];

        // CHECK EXCLUSION RULES (Fan Tokens, Monitored, Delisting, etc.)
        if (shouldExcludeCoin(coin.symbol)) continue;

        // RULE: 2 TIMES SEQUENTIAL, THEN 2 OPS COOLDOWN
        if (state.cooldownCoins && state.cooldownCoins[coin.symbol] > 0) {
            if (shouldLog) addLog(username, `⏳ ${coin.symbol} em cooldown por mais ${state.cooldownCoins[coin.symbol]} op.`, 'info');
            continue;
        }
        
        const jump = globalMarket.coinJumps[coin.symbol] || 0;
        
        // Log de Aproximação (Interativo)
        if (jump >= 0.1 && jump < 0.2) {
            if (!state._lastTendency || state._lastTendency.symbol !== coin.symbol || Date.now() - state._lastTendency.time > 10000) {
                const approx = (jump / 0.2) * 100;
                addLog(username, `⚡ TENDÊNCIA PARA ${coin.symbol}: ${approx.toFixed(0)}% de aproximação do gatilho 0.2%`, 'info');
                state._lastTendency = { symbol: coin.symbol, time: Date.now() };
            }
        }

        if (jump >= 0.2) {
            const rankLabel = (i === 0) ? 'RANK 2' : (i === 1) ? 'RANK 3' : 'RANK 4';
            addLog(username, `🎯 GATILHO DETECTADO: ${coin.symbol} (${rankLabel}) subiu +${jump.toFixed(2)}% em 10s!`, 'buy');
            target = coin;
            triggerJump = jump;
            triggerRank = (i === 0) ? '2' : (i === 1 ? '3' : '4');
            break;
        }
    }

    // Fim da Verificação de Gatilho Diário
    if (!target) return;

    // DIAGNÓSTICO: Se chegou aqui, VAI COMPRAR. Logar imediatamente.
    console.log(`[TRIGGER SUCCESS] ${username} buying ${target.symbol} at ${triggerJump.toFixed(3)}% jump`);
    
    // Reset logs repetitivos ao encontrar gatilho real
    state._lastVolLog = null;
    state._lastRepLog = null;

    addLog(username, `🎯 GATILHO RANK ${triggerRank}: ${target.symbol} (+${triggerJump.toFixed(2)}% REAL-TIME)`, 'trigger');

    // ATOMICIDADE: Mudar status IMEDIATAMENTE antes da requisição Binance
    state.status = 'IN_TRADE';
    state.activeSymbol = target.symbol;

    await executeRealBuy(username, target.symbol, target.price);
}

async function executeRealBuy(username, symbol, price) {
    const state = userStates.get(username);

    // OTIMIZAÇÃO: usar saldo cacheado para evitar chamada serial à Binance antes de cada compra
    // Se o cache estiver zerado, busca uma vez como fallback
    let usdt = state.balanceUSDT || 0;
    if (usdt < 11) {
        addLog(username, `⏳ Cache de saldo baixo ($${usdt.toFixed(2)}). Buscando saldo atualizado...`, 'info');
        try {
            if (state.apiKey && state.apiSecret) {
                const account = await binanceRequest(username, '/api/v3/account');
                if (account.error) {
                    addLog(username, `Erro Saldo: ${account.msg}`, 'error');
                    return resetTradeState(username);
                }
                usdt = parseFloat(account.balances.find(b => b.asset === 'USDT')?.free || 0);
                state.balanceUSDT = usdt; // Atualizar cache
                if (!state._lastBalanceLog || Date.now() - state._lastBalanceLog > 300000) {
                    addLog(username, `✅ Saldo Atualizado: $${usdt.toFixed(2)} USDT`, 'info');
                    state._lastBalanceLog = Date.now();
                }
            }
        } catch (e) {
            console.error(`[BALANCE ERROR] ${username}:`, e.message);
            if (e.response?.status === 401 || e.response?.status === 403) {
                addLog(username, "⚠️ Erro de Autenticação na Binance. Verifique API Key/Secret.", 'error');
            }
            return resetTradeState(username); // Reset if there's an error fetching balance
        }
    }

    addLog(username, `🎯 GATILHO: ${symbol}. Saldo: $${usdt.toFixed(2)} (cache)`, 'trigger');

    if (usdt < 11) {
        addLog(username, `⏳ Saldo insuficiente ($${usdt.toFixed(2)}). Tentando RESGATE de trade órfão...`, 'warn');
        const rescued = await rescueTradeState(username);
        if (rescued) {
            addLog(username, `✅ SUCESSO! Trade órfão identificado e monitoramento retomado.`, 'buy');
            return;
        }
        addLog(username, `Saldo insuficiente: $${usdt.toFixed(2)}`, 'error');
        return resetTradeState(username);
    }

    // REFERÊNCIA DIÁRIA: Captura o saldo da primeira operação do dia (America/Sao_Paulo)
    if (isNewDay(state.initialDayTimestamp)) {
        state.initialDayBalance = usdt; 
        state.initialDayTimestamp = Date.now();
        addLog(username, `📅 NOVO DIA: Saldo de Referência definido em $${usdt.toFixed(2)}`, 'info');
    }

    const amountToUse = usdt * (state.buyPercentage === 1.0 ? 0.99 : state.buyPercentage);
    
    // REVISÃO ELITE: Se o valor for menor que $12, ignorar (Anti-Fragmento)
    if (amountToUse < 12) {
        addLog(username, `⚠️ SALDO INSUFICIENTE/FRAGMENTADO ($${amountToUse.toFixed(2)}). Mínimo $12 para Operação Elite.`, 'warn');
        return resetTradeState(username);
    }

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
    state.targetPrice = realPrice * 1.008; // ALVO ELITE 0.8% (para ~0.6% líquido)
    state.status = 'IN_TRADE';
    addLog(username, `🚀 COMPRA EXECUTADA: ${symbol} @ $${realPrice.toFixed(6)}`, 'buy');
    addLog(username, `🎯 ALVO DEFINIDO: Venda programada para $${state.targetPrice.toFixed(6)} (+0.6% líquido)`, 'info');
    
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
            const roi = ((current - state.buyPrice) / state.buyPrice) * 100;

            // 1. MONITORAMENTO CONTÍNUO (Sem Stop Loss / Sem Pausa)

            // 2. META ALVO: 0.6% LÍQUIDO
            if (roi >= 0.6) {
                addLog(username, `🎯 ALVO ALCANÇADO: +${roi.toFixed(2)}% @ $${current.toFixed(6)}. Iniciando Liquidação...`, 'info');
                const success = await executeRealSell(username, symbol, 'LUCRO');
                if (success) {
                    clearInterval(interval);
                    return;
                }
            }

            // NARRATIVA DE MONITORAMENTO (A cada ~30s)
            if (!state._lastTradeLog || Date.now() - state._lastTradeLog > 30000) {
                addLog(username, `🔄 MONITORANDO: ${symbol} @ $${current.toFixed(6)} (ROI: ${roi.toFixed(2)}%). Alvo: $${state.targetPrice.toFixed(6)}`, 'info');
                state._lastTradeLog = Date.now();
            }
        } catch (e) {
            console.error(`[MONITOR] ${username}:`, e.message);
        }
    }, 1500); // 1.5s entre verificações de preço trade
}

async function executeRealSell(username, symbol, reason) {
    const state = userStates.get(username);
    if (!state || state._isSelling) return false; 
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
        resetTradeState(username);
        return true; // Consideramos sucesso se não há nada para vender
    }
    
    const quantityString = stepPrecision > 0 ? truncatedBalance.toFixed(stepPrecision) : truncatedBalance.toString();

    const order = await binanceRequest(username, '/api/v3/order', 'POST', {
        symbol, side: 'SELL', type: 'MARKET', quantity: quantityString
    });

    if (order.error) {
        addLog(username, `Erro Venda: ${order.msg}. Tentando novamente em breve...`, 'error');
        state._isSelling = false;
        return false; 
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

    // Lógica PNL ALFA LÍQUIDO (Net Profit Realizado)
    const buyCost = state.buyPrice * state.buyQty;
    const sellRevenue = realSellPrice * totalQtyFilled;
    const totalFees = (buyCost * 0.001) + (sellRevenue * 0.001); // 0.1% na compra e 0.1% na venda
    const tradeNetProfit = sellRevenue - buyCost - totalFees;
    
    state.liquidPnlPool = (state.liquidPnlPool || 0) + tradeNetProfit;
    
    // Antigo dayGain para compatibilidade visual no Dashboard
    const currentTotal = await binanceFetchBalance(username);
    const dayGain = currentTotal - (state.initialDayBalance || currentTotal);
    
    addLog(username, `📊 PNL ALFA LÍQUIDO: +$${tradeNetProfit.toFixed(2)} nesta operação. Acumulado: $${state.liquidPnlPool.toFixed(2)}`, 'info');
    
    addLog(username, `📊 DESEMPENHO DIÁRIO: Ganho de $${dayGain.toFixed(2)} vs Alvo $20.00`, 'info');

    const profit = ((realSellPrice - state.buyPrice) / state.buyPrice) * 100;
    state.history.unshift({ symbol, date: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), profitPct: parseFloat(profit.toFixed(2)), type: 'LUCRO ELITE' });

    // ATIVAR SUPER CARD NO MEIO DA TELA
    state.dashboardData.triggerProfitAnim = profit > 0;
    setTimeout(() => {
        const s = userStates.get(username);
        if (s) s.dashboardData.triggerProfitAnim = false;
    }, 8000);

    if (profit >= 0) {
        addLog(username, `💰✅ SUCESSO: ${symbol} Vendido com +${profit.toFixed(2)}% de Lucro!`, 'card-sell');
    } else {
        addLog(username, `📉 PROTEÇÃO: ${symbol} liquidado com ${profit.toFixed(2)}% de oscilação.`, 'error');
    }
    
    // Gestão de Repetição (Quarentena 2 ciclos)
    state.lastCoins.push(symbol);
    if (state.lastCoins.length > 10) state.lastCoins.shift();

    // Reduzir cooldowns de outras moedas
    Object.keys(state.cooldownCoins).forEach(s => {
        if (state.cooldownCoins[s] > 0) state.cooldownCoins[s]--;
        if (state.cooldownCoins[s] <= 0) delete state.cooldownCoins[s];
    });

    // Se é a 2ª vez seguida desta moeda, bloqueia por 2 trades
    if (state.lastCoin === symbol) {
        state.consecutiveCount++;
    } else {
        state.lastCoin = symbol;
        state.consecutiveCount = 1;
    }

    if (state.consecutiveCount >= 2) {
        if (!state.cooldownCoins) state.cooldownCoins = {};
        state.cooldownCoins[symbol] = 2; // Bloqueia por 2 operações
        state.consecutiveCount = 0; // Reseta para a próxima
        addLog(username, `⚠️ LIMITE DE REPETIÇÃO: ${symbol} bloqueada pelas próximas 2 operações.`, 'warn');
    }

    // Ciclo de Trades (Sem Pausa)
    state.opsCount++;

    state._isSelling = false;
    resetTradeState(username);
    saveUserState(username);

    // Gestão de BRL ($20 atingidos no PNL Alfa Líquido)
    if (state.liquidPnlPool >= 20) {
        await realizeProfitToBRL(username);
        // O liquidPnlPool pode ser resetado ou reduzido de 20. 
        // Para manter a transparência do "Ganho do Dia", vamos zerar após a conversão.
        state.liquidPnlPool = 0; 
    }

    // Lógica de Pausa por Ciclo de VENDAS (A cada 5 Vendas -> 5 Min)
    state.salesCount = (state.salesCount || 0) + 1;
    if (state.salesCount >= 5) {
        state.salesCount = 0;
        state.pauseUntil = Date.now() + 5 * 60 * 1000;
        state.status = 'PAUSED';
        addLog(username, `🛑 CICLO DE VENDAS: 5 sucessos atingidos. Pausa de 5 minutos ativada.`, 'warn');
    }

    return true;
} catch (e) {
    console.error("Erro Crítico na Venda:", e);
    state._isSelling = false;
    return false;
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
        
        // Pausa de 10 minutos após "guardar" o lucro
        state.pauseUntil = Date.now() + 10 * 60 * 1000;
        state.status = 'PAUSED';

        addLog(username, `✅ LUCRO PROTEGIDO: R$ ${brlReceived.toFixed(2)} guardados. Pausa de 10 min ativada.`, 'buy');
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
    state.buyPrice = 0;
    state.targetPrice = 0;
    state.currentPrice = 0;
    state.buyQty = 0;
    state.status = (state.isLoopActive && state.status !== 'OFFLINE') ? 'SCANNING' : 'OFFLINE';
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
    const MASTER_KEY = ADMIN_ACCESS_KEY.toLowerCase();

    // CASO 1: ADMINISTRADOR (ENTRADA DIRETA - SEM SENSIBILIDADE A MAIÚSCULAS)
    const masterTest = MASTER_KEY.toLowerCase();
    if (entry.toLowerCase() === masterTest || (password || '').toLowerCase() === masterTest) {
        const token = ADMIN_ACCESS_KEY;
        activeTokens.set(token, 'ADMIN_CONTROL');
        return res.json({ token, username: 'ADMIN', isAdmin: true });
    }

    if (!email || !password) return res.status(400).json({ error: 'Preencha E-mail e Senha' });

    // CASO 2: CLIENTE
    const username = email.trim().toLowerCase();
    const secret = password.trim(); // SENHA AGORA É CASE-SENSITIVE PARA SEGURANÇA E CONSISTÊNCIA

    // REGISTRO OU LOGIN
    if (!usersDB[username]) {
        usersDB[username] = { password: secret, registeredAt: new Date().toISOString(), isApproved: false };
        saveUsersDB();
        return res.status(403).json({ error: 'Cadastro realizado! Aguarde ativação do suporte.' });
    }

    if (usersDB[username].password !== secret) {
        return res.status(401).json({ error: 'Senha incorreta.' });
    }

    if (!usersDB[username].isApproved) {
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

// Admin endpoint: Alterar senha do usuário
app.post('/admin/change-password', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${ADMIN_ACCESS_KEY}`) return res.status(401).send();
    
    const { targetUser, newPassword } = req.body;
    if (!usersDB[targetUser]) return res.status(404).json({ error: 'Não encontrado' });
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Senha muito curta' });

    usersDB[targetUser].password = newPassword;
    saveUsersDB();
    
    console.log(`[ADMIN] Senha de ${targetUser} alterada com sucesso.`);
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
        // PRIORIDADES: Memória (Live) -> Disco (Cache)
        const state = userStates.get(username) || loadUserState(username);
        const dbUser = usersDB[username] || {};
        
        overview.push({
            username: state.username,
            clientName: state.clientName || '---',
            status: state.status || 'OFFLINE',
            isLoopActive: state.isLoopActive || false,
            isApproved: !!dbUser.isApproved, // Garantir booleano estrito
            activeSymbol: state.activeSymbol || '---',
            buyPrice: state.buyPrice || 0,
            currentPrice: state.currentPrice || 0,
            targetPrice: state.targetPrice || 0,
            buyAmountUSDT: (state.buyQty || 0) * (state.buyPrice || 0),
            balanceUSDT: Number(state.balanceUSDT || 0),
            realizedProfitBRL: Number(state.realizedProfitBRL || 0),
            profit24h: Number(sum24hProfit(state.history) || 0),
            totalProfitPct: Number((state.history || []).reduce((s, h) => s + (h.profitPct || 0), 0) || 0),
            dailyGain: Number(state.profitPoolUSDT || 0),
            salesCount: Number(state.salesCount || 0),
            liquidPnlPool: Number(state.liquidPnlPool || 0), // Novo: PNL Realizado Líquido
            currentStep: state.status === 'IN_TRADE' ? 'MONITORANDO TRADE' : (state.status === 'PAUSED' ? 'EM PAUSA (CICLO)' : 'BUSCANDO RADAR'),
            password: dbUser.password || '---'
        });
    }
    res.json({ users: overview, globalPivot: globalMarket.pivot || '---' });
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
