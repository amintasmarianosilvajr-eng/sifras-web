/**
 * SIFRAS ALFA v4.6.3 - UNIFICAÇÃO DE INSTRUMENTOS & SNIPER ENGINE
 * Sistema de Sincronia de Cronometria, Latência e PNL.
 */

const CONFIG = {
    UPDATE_INTERVAL: 1000, // Ciclo base de 1s para cromometria
    LOG_INTERVAL: 5000,   
    TARGET_PROFIT: 0.8,
    VOLATILITY_WINDOW: 10000,
    MIN_VOLATILITY_TRIGGER: 0.15, // 0.15% em 10 segundos
    MAX_CYCLES: 10,
    COOLDOWN_TIME: 1800000,
    BLACKLIST: ['SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV'],
    WITHDRAW_THRESHOLD: 15,
    WITHDRAW_ENABLED: true
};

// State Variables
let activeSlots = { 1: { key: '', secret: '', name: 'OPERADOR MASTER', monitoring: false } };
let currentTrade = null;
let globalSystemPower = false;
let isCooldownActive = false;
let tradeSocket = null;
let lastRankingHash = "";
let lastLogMsg = "";
let completedCycles = 0;
let sessionStartBalance = parseFloat(localStorage.getItem('alfa_session_start') || '0');
let syncCountdown = 10;
let tradeStartTime = null;

// Sniper Analyzer Variables
let isAnalyzingVolatility = false;
let analysisStartTime = 0;
let volatilityBuffer = {};
let instantBlacklist = [];
let tradeHistory = []; // Memória das últimas 10 moedas operadas (objetos)

// --- BOOTSTRAP ---

document.addEventListener('DOMContentLoaded', () => {
    console.log("[ALFA v4.6.3] Inicializando Instrumentos...");
    // Inicialização Imediata + Loop Contínuo
    setTimeout(() => {
        loadSavedState();
        syncBalance();
        pushNetworkHeartbeat();
    }, 500);

    setInterval(updateHeartbeatUI, 1000);
    setInterval(pushNetworkHeartbeat, 5000);
    
    const nameInput = document.getElementById('slot-1-name');
    if (nameInput) nameInput.addEventListener('blur', () => syncExistingProfile(nameInput.value));
});

// --- UNIFIED UI HEARTBEAT (1s) ---

async function updateHeartbeatUI() {
    if (!globalSystemPower) {
        updateChronometryStatic();
        return;
    }

    // 1. Cronometria de Sincronização (10s)
    syncCountdown--;
    if (syncCountdown <= 0) {
        syncCountdown = 10;
        await loadSavedState(); // Busca estado REAL do servidor
        await syncBalance();    // Atualiza saldo
    }

    // 1.5 Safety Reset para LENS (Anti-Travamento)
    if (isAnalyzingVolatility && (Date.now() - analysisStartTime > CONFIG.VOLATILITY_WINDOW + 5000)) {
        isAnalyzingVolatility = false;
        console.warn("[ALFA] LENS Reset de Segurança acionado.");
    }

    // 2. Atualiza Círculos e Contadores
    updateChronometryActive();
    
    // 3. Atualiza PNL e Status Financeiro
    updateSessionStats();
}

function updateChronometryStatic() {
    const syncVal = document.getElementById('sync-timer-val');
    if (syncVal) syncVal.innerText = "OFF";
    const elCycle = document.getElementById('cycle-counter');
    if (elCycle) elCycle.textContent = "OFFLINE";
    updateLatencyUI(0);
}

function updateChronometryActive() {
    // Ciclo de Sincronia
    const syncCircle = document.getElementById('sync-circle');
    const syncVal = document.getElementById('sync-timer-val');
    if (syncCircle && syncVal) {
        const offset = 283 - (syncCountdown / 10) * 283;
        syncCircle.style.strokeDashoffset = offset;
        syncVal.innerText = `${syncCountdown}s`;
    }

    // Ciclos Completos
    let elCycle = document.getElementById('cycle-counter');
    if (elCycle) {
        if (isCooldownActive) {
            elCycle.textContent = `PAUSA: 30M (${completedCycles}/10)`;
        } else if (isAnalyzingVolatility) {
            const elapsed = Math.floor((Date.now() - analysisStartTime) / 1000);
            elCycle.textContent = `${completedCycles} / 10 (SCAN: ${elapsed}s)`;
        } else {
            elCycle.textContent = `${completedCycles} / 10`;
        }
    }

    // Duração do Trade
    const tradeCircle = document.getElementById('trade-circle');
    const tradeVal = document.getElementById('trade-timer-val');
    if (currentTrade && tradeStartTime && tradeVal) {
        const elapsed = Math.floor((Date.now() - tradeStartTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        tradeVal.innerText = `${mins}:${secs}`;
        const tradeOffset = 283 - ((elapsed % 60) / 60) * 283;
        if (tradeCircle) tradeCircle.style.strokeDashoffset = tradeOffset;
    } else if (tradeVal) {
        tradeVal.innerText = "00:00";
        if (tradeCircle) tradeCircle.style.strokeDashoffset = 283;
    }
}

// --- DATA SYNC (TRIGERRED EVERY 10s) ---

async function triggerDataSync() {
    // 1. Fetch Ranking
    const rankingData = await fetchRanking(); 
    if (rankingData && rankingData.ranking) {
        window.lastRankingData = rankingData.ranking; 
        renderRanking(rankingData.ranking);
        renderOpportunityHub(rankingData.ranking);
        // analyzeAlfa removido daqui - agora é processado no servidor 24/7
    }
}

async function fetchRanking() { 
    try { 
        const tStart = performance.now();
        const r = await fetch('/moedas-ranking'); 
        const data = await r.json(); 
        const latency = Math.round(performance.now() - tStart);
        updateLatencyUI(latency);
        return data;
    } catch(e) { return null; } 
}

async function syncBalance() {
    if (!activeSlots[1].key) return;
    try {
        const tStart = performance.now();
        const r = await fetch('/pnl-real', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: activeSlots[1].key, secret: activeSlots[1].secret })
        });
        const d = await r.json();
        const latency = Math.round(performance.now() - tStart);
        updateLatencyUI(latency);

        if (d.totalUsdt !== undefined) {
            window.currentBalance = d.totalUsdt;
            if (!sessionStartBalance || isNaN(sessionStartBalance) || sessionStartBalance <= 0) {
                sessionStartBalance = d.totalUsdt;
                localStorage.setItem('alfa_session_start', sessionStartBalance);
                addLog(`🎯 CAPITAL INICIAL FIXADO: $${sessionStartBalance.toFixed(2)}`, 'system');
            }
            const el = document.getElementById('cabinet-total-balance');
            if (el) el.innerHTML = `$ ${d.totalUsdt.toFixed(2)} <span style="font-size:1.5rem; opacity:0.5;">USDT</span>`;
        }
    } catch(e) {}
}

// --- UI HELPERS ---

function updateLatencyUI(ms) {
    const el = document.getElementById('header-latency');
    if (!el) return;
    if (ms === 0) { el.textContent = "-- ms"; el.style.color = "var(--text-muted)"; return; }
    el.textContent = `${ms} ms`;
    el.classList.remove('waiting');
    el.style.color = ms < 300 ? 'var(--accent-green)' : (ms < 1000 ? '#f1c40f' : 'var(--danger-neon)');
}

function updateSessionStats() {
    const pnlHeader = document.getElementById('header-realtime-pnl');
    const pnlCabinet = document.getElementById('cabinet-realtime-pnl');
    if (!window.currentBalance || !sessionStartBalance) return;

    const profit = window.currentBalance - sessionStartBalance;
    const pct = (profit / sessionStartBalance) * 100;
    const color = profit >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
    const sign = profit >= 0 ? '+' : '';

    if (pnlHeader) {
        pnlHeader.textContent = `${sign}$${profit.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
        pnlHeader.style.color = color;
        pnlHeader.classList.remove('waiting');
    }
    if (pnlCabinet) {
        pnlCabinet.innerHTML = `SESSION: <span style="color:${color}">${sign}$${profit.toFixed(2)}</span>`;
    }
}

// --- ENGINE LOGIC (SNIPER 10S) ---

function analyzeAlfa(ranking) {
    // Lógica movida para TradingService.js (Backend) para autonomia 24/7.
    // O Frontend apenas exibe o status de Rastreamento.
}

async function executeTrade(coin) {
    if (instantBlacklist.includes(coin.symbol)) return;
    const tp = coin.price * 1.008; // 0.8% Fixed Target
    currentTrade = { 
        symbol: coin.symbol.replace('USDT', ''), 
        fullSymbol: coin.symbol, 
        buyPrice: coin.price, 
        targetPrice: tp, 
        qty: 0 
    };
    tradeStartTime = Date.now();
    updateTradeUI(true);
    
    try {
        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: activeSlots[1].key, secret: activeSlots[1].secret, symbol: currentTrade.fullSymbol, side: 'BUY', buyPercentage: 100 })
        });
        const d = await r.json();
        if (d.orderId) {
            currentTrade.qty = parseFloat(d.executedQty || 0);
            addLog(`✅ ATIVO EM CARTEIRA: ${currentTrade.symbol}`, 'buy');
            initPriceSocket(currentTrade.fullSymbol);
        } else throw new Error(d.error || "Execution Rejected");
    } catch (e) {
        addLog(`🛑 ERRO: ${e.message}. Blacklisting ${currentTrade.symbol}.`, 'error');
        instantBlacklist.push(currentTrade.fullSymbol);
        setTimeout(() => { instantBlacklist = instantBlacklist.filter(s => s !== currentTrade.fullSymbol); }, 600000);
        resetTrade();
        isAnalyzingVolatility = false;
    } finally {
        pushStateToServer();
    }
}

function initPriceSocket(symbol) {
    if(tradeSocket) tradeSocket.close();
    tradeSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
    tradeSocket.onmessage = (e) => {
        const d = JSON.parse(e.data);
        const price = parseFloat(d.c);
        window.lastSocketPrice = price; // Captura para telemetria admin
        updateTradePrice(price);
    };
}

function updateTradePrice(price) {
    if(!currentTrade) return;
    document.getElementById('monitoring-current-price').textContent = `$${price.toFixed(4)}`;
    const pl = ((price - currentTrade.buyPrice) / currentTrade.buyPrice) * 100;
    const plEl = document.getElementById('monitoring-pl');
    plEl.textContent = `${pl >= 0 ? '+' : ''}${pl.toFixed(2)}%`;
    plEl.style.color = pl >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
    const progress = Math.min((pl / CONFIG.TARGET_PROFIT) * 100, 100);
    document.getElementById('trade-progress-fill').style.width = `${Math.max(progress, 0)}%`;
    // A venda agora é disparada via Backend no TradingService.js
}

async function executeSell() {
    if (!currentTrade) return;
    try {
        addLog(`🎯 ALVO ALCANÇADO! Liquidando ${currentTrade.symbol}...`, 'sell');
        const info = await (await fetch(`/info-par?symbol=${currentTrade.fullSymbol}`)).json();
        let qtyToSell = currentTrade.qty;
        if (info && info.symbols) {
            const lot = info.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE');
            const step = parseFloat(lot.stepSize);
            qtyToSell = (Math.floor(qtyToSell / step) * step).toFixed(8).replace(/\.?0+$/, "");
        }
        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: activeSlots[1].key, secret: activeSlots[1].secret, symbol: currentTrade.fullSymbol, side: 'SELL', qty: qtyToSell })
        });
        const d = await r.json();
        if (d.orderId) {
            addLog(`🚀 VENDA CONCLUÍDA! Lucro Garantido em ${currentTrade.symbol}.`, 'sell');
            
            // ADICIONA À MEMÓRIA PARA NÃO REPETIR (LIMITE 10)
            const historyEntry = {
                symbol: currentTrade.symbol,
                fullSymbol: currentTrade.fullSymbol,
                sellPrice: d.price || window.lastSocketPrice || currentTrade.targetPrice,
                time: Date.now()
            };
            tradeHistory.unshift(historyEntry);
            if (tradeHistory.length > 10) tradeHistory.pop();
            
            resetTrade();
            isAnalyzingVolatility = false;
            completedCycles++;
            if (completedCycles >= CONFIG.MAX_CYCLES) triggerCooldown();
            if (CONFIG.WITHDRAW_ENABLED) checkAndWithdrawProfit();
            pushStateToServer();
            renderOpportunityHub(window.lastRankingData || []);
        } else throw new Error(d.error || "Sell Rejected");
    } catch (e) { addLog(`❌ ERRO NA VENDA: ${e.message}`, 'error'); }
}

function triggerCooldown() {
    completedCycles = 0;
    isCooldownActive = true;
    addLog(`🛑 SEGURANÇA: 10 Ciclos. Pausa de 30 minutos (Proteção Anti-Retomada).`, 'system');
    pushStateToServer();
    setTimeout(() => { 
        isCooldownActive = false; 
        addLog(`✅ RETOMANDO: Radar ativado!`, 'system'); 
        pushStateToServer();
    }, CONFIG.COOLDOWN_TIME);
}

async function checkAndWithdrawProfit() {
    const profit = window.currentBalance - sessionStartBalance;
    if (profit >= CONFIG.WITHDRAW_THRESHOLD) {
        try {
            addLog(`💰 SAQUE SEGURO: Convertendo $${CONFIG.WITHDRAW_THRESHOLD} para BRL...`, 'system');
            const r = await fetch('/executar-ordem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: activeSlots[1].key, secret: activeSlots[1].secret, symbol: 'USDTBRL', side: 'SELL', qty: CONFIG.WITHDRAW_THRESHOLD })
            });
            const d = await r.json();
            if (d.orderId) addLog(`✅ LUCRO NO BOLSO! $${CONFIG.WITHDRAW_THRESHOLD} transferidos para REAL (BRL).`, 'buy');
        } catch (e) { addLog(`⚠️ FALHA NO SAQUE: ${e.message}`, 'error'); }
    }
}

// --- CORE UTILS ---

function renderRanking(ranking) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    
    if (!ranking || ranking.length === 0) {
        grid.innerHTML = `<div class="empty-msg" style="height: 50px; font-size:0.6rem; color:var(--text-muted);">Sincronizando Radar com a Nuvem...</div>`;
        return;
    }

    const currentHash = ranking.slice(0, 30).map(c => c.symbol).join('|');
    if (currentHash === lastRankingHash) return;
    lastRankingHash = currentHash;

    grid.innerHTML = ranking.slice(0, 30).map((c, i) => `
        <div class="log-card" style="margin-bottom:8px; padding:10px; display:flex; justify-content:space-between; ${isAnalyzingVolatility && volatilityBuffer[c.symbol] ? 'border:1px solid var(--primary-neon); background:rgba(0,245,255,0.05);' : ''}">
            <span style="font-weight:900; opacity:0.5;">#${i + 1}</span>
            <span style="font-weight:800;">${c.symbol.replace('USDT', '')}</span>
            <span class="coin-vol" style="font-weight:900; color:var(--accent-green);">${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%</span>
        </div>
    `).join('');
}

function addLog(msg, type = 'system') {
    if (msg === lastLogMsg && type === 'error') return;
    lastLogMsg = msg;
    const monitor = document.getElementById('log-monitor');
    if (!monitor) return;
    const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const html = `<div class="log-entry ${type}"><span class="log-timestamp">[${time}]</span> ${msg}</div>`;
    monitor.innerHTML = html + monitor.innerHTML;
    if (monitor.children.length > 30) monitor.removeChild(monitor.lastChild);
}

function updateTradeUI(active) {
    document.getElementById('active-trade-container').classList.toggle('hidden', !active);
    document.getElementById('no-trade-msg').classList.toggle('hidden', active);
    if (active && currentTrade) {
        document.getElementById('monitoring-symbol').textContent = currentTrade.symbol;
        
        // Ajuste de precisão dinâmico para moedas de baixo valor
        const precision = currentTrade.buyPrice < 0.1 ? 6 : 4;
        
        document.getElementById('monitoring-buy-price').textContent = `$${currentTrade.buyPrice.toFixed(precision)}`;
        
        // CORREÇÃO: Alvo sempre calculado sobre o preço de compra (0.8% FIXO)
        const displayTarget = currentTrade.buyPrice * 1.008;
        document.getElementById('monitoring-target-price').textContent = `$${displayTarget.toFixed(precision)}`;
        
        document.getElementById('system-status-pill').textContent = 'TRADE ATIVO';
        document.getElementById('system-status-pill').style.color = 'var(--accent-green)';
    } else {
        document.getElementById('system-status-pill').textContent = globalSystemPower ? 'RASTREAMENTO' : 'OFFLINE';
        document.getElementById('system-status-pill').style.color = globalSystemPower ? 'var(--primary-neon)' : 'var(--text-muted)';
    }
}

function masterToggle() {
    globalSystemPower = !globalSystemPower;
    const btn = document.getElementById('master-toggle-btn');
    btn.textContent = globalSystemPower ? 'DESCONECTAR MASTER' : 'CONECTAR MASTER';
    btn.classList.toggle('active', globalSystemPower);
    activeSlots[1].monitoring = globalSystemPower;
    if (globalSystemPower) {
        addLog("✅ MOTOR MASTER LIGADO NO SERVIDOR (24/7).", "system");
        syncBalance();
        syncCountdown = 1; 
    } else {
        addLog("🛑 COMANDO ENVIADO: PARAR MOTOR MASTER.", "system");
        updateChronometryStatic();
    }
    updateTradeUI(currentTrade ? true : false);
    pushStateToServer(); // Notifica o servidor imediatamente da mudança de ON/OFF
}

function recalibrateCapital() {
    if (window.currentBalance) {
        sessionStartBalance = window.currentBalance;
        localStorage.setItem('alfa_session_start', sessionStartBalance);
        addLog(`🔄 CALIBRADO: $${sessionStartBalance.toFixed(2)} definido como ponto zero.`, 'system');
        updateSessionStats();
        pushStateToServer();
    } else addLog(`⚠️ ERRO: Aguarde o carregamento do saldo.`, 'error');
}

function saveSlot() {
    const s = { name: document.getElementById('slot-1-name').value.trim(), key: document.getElementById('slot-1-key').value.trim(), secret: document.getElementById('slot-1-secret').value.trim() };
    activeSlots[1] = { ...activeSlots[1], ...s };
    localStorage.setItem('alfa_slot_1', JSON.stringify(s));
    addLog(`✅ OPERADOR COMPATIBILIZADO.`, "system");
    syncBalance();
}

async function loadSavedState() {
    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    if (slot.name) {
        document.getElementById('slot-1-name').value = slot.name;
        document.getElementById('slot-1-key').value = slot.key || '';
        document.getElementById('slot-1-secret').value = slot.secret || '';
        activeSlots[1] = { ...activeSlots[1], ...slot };
    }
    const sessionUser = localStorage.getItem('alfa_session_user');
    if (sessionUser && !slot.name) {
        document.getElementById('slot-1-name').value = sessionUser;
        activeSlots[1].name = sessionUser;
    }

    // RESTAURAÇÃO VIA NUVEM (CLOUD PERSISTENCE)
    const currentName = document.getElementById('slot-1-name').value;
    if (currentName && currentName !== 'OPERADOR MASTER') {
        try {
            const res = await fetch('/get-alfa-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: currentName })
            });
            const { state } = await res.json();
            
            if (state && state.lastUpdated) {
                console.log("[ALFA] Restaurando estado da nuvem...", state);
                completedCycles = state.cycleCount || 0;
                sessionStartBalance = state.sessionStartBalance || 0;
                window.currentBalance = state.currentBalance || 0;
                tradeHistory = state.tradeHistory || [];
                
                // Migração de formato: se for o histórico antigo (apenas strings), reseta para o novo padrão
                if (tradeHistory.length > 0 && typeof tradeHistory[0] === 'string') {
                    tradeHistory = [];
                }

                isCooldownActive = state.isCooldownActive || false;

                if (state.currentTrade) {
                    currentTrade = state.currentTrade;
                    tradeStartTime = state.tradeStartTime;
                    updateTradeUI(true);
                    initPriceSocket(currentTrade.fullSymbol);
                }

                if (state.monitoring && !globalSystemPower) {
                    console.log("[ALFA] Sincronizando com motor de autonomia da nuvem...");
                    globalSystemPower = true;
                    activeSlots[1].monitoring = true;
                    
                    const btn = document.getElementById('master-toggle-btn');
                    if (btn) {
                        btn.textContent = 'DESCONECTAR MASTER';
                        btn.classList.add('active');
                    }
                    updateTradeUI(currentTrade ? true : false);
                }
            }
        } catch (e) {
            console.error("[ALFA] Erro ao restaurar estado da nuvem:", e);
        }
    }

    // Refresh UI instantâneo
    updateSessionStats();
    updateTradeUI(currentTrade ? true : false);
}

async function pushStateToServer() {
    const username = activeSlots[1].name;
    if (!username || username === 'OPERADOR MASTER') return;

    const state = {
        monitoring: globalSystemPower,
        cycleCount: completedCycles,
        currentTrade,
        tradeStartTime,
        sessionStartBalance,
        currentBalance: window.currentBalance || 0,
        currentPrice: currentTrade ? (window.lastSocketPrice || currentTrade.buyPrice) : 0,
        sessionProfitUsdt: (window.currentBalance && sessionStartBalance) ? (window.currentBalance - sessionStartBalance) : 0,
        isCooldownActive,
        tradeHistory,
        lastUpdated: Date.now()
    };

    try {
        await fetch('/save-alfa-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username, 
                state,
                keys: {
                    key: activeSlots[1].key || '',
                    secret: activeSlots[1].secret || ''
                }
            })
        });
    } catch (e) {
        console.error("[ALFA] Erro ao salvar estado:", e);
    }
}

async function pushNetworkHeartbeat() {
    const username = activeSlots[1].name || 'OPERADOR';
    
    // TELEMETRIA EXPANDIDA PARA ADMIN
    const buyPrice = currentTrade ? currentTrade.buyPrice : 0;
    const targetPrice = currentTrade ? currentTrade.targetPrice : 0;
    const currentPrice = currentTrade ? (window.lastSocketPrice || buyPrice) : 0;
    const pnlPerc = (currentTrade && buyPrice > 0) ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;
    const liquidPnlPool = (window.currentBalance && sessionStartBalance) ? (window.currentBalance - sessionStartBalance) : 0;

    const state = { 
        status: currentTrade ? 'IN_TRADE' : (globalSystemPower ? 'SCANNING' : 'OFFLINE'), 
        activeSymbol: currentTrade ? currentTrade.fullSymbol : '---', 
        balanceUSDT: window.currentBalance || 0,
        buyPrice,
        targetPrice,
        currentPrice,
        pnlPerc,
        liquidPnlPool,
        staircaseIndex: completedCycles + 1
    };

    try {
        const r = await fetch('/heartbeat', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ username, state, keys: { key: activeSlots[1].key, secret: activeSlots[1].secret } }) 
        });
        const d = await r.json();
        if (d.command === 'STOP' && globalSystemPower) masterToggle();
         
         // SINCRONIA BLINDADA: Realidade da Nuvem -> Interface do Usuário
         if (d.serverState && (d.serverState.lastUpdated || d.serverState.monitoring)) {
             const s = d.serverState;
             
             // Se o servidor está monitorando mas o navegador não, force a sincronia
             if (s.monitoring && !globalSystemPower) {
                 globalSystemPower = true;
                 activeSlots[1].monitoring = true;
                 const btn = document.getElementById('master-toggle-btn');
                 if (btn) {
                     btn.textContent = 'DESCONECTAR MASTER';
                     btn.classList.add('active');
                 }
                 console.log("[SYNC] Robô Master Reconectado via Nuvem.");
             }

             // Sincroniza Ciclos, Saldo e PNL
             if (s.cycleCount !== undefined) completedCycles = s.cycleCount;
             if (s.sessionStartBalance > 0) sessionStartBalance = s.sessionStartBalance;
             if (s.currentBalance > 0) window.currentBalance = s.currentBalance;
             if (s.tradeHistory) tradeHistory = s.tradeHistory;
             isCooldownActive = s.isCooldownActive || false;

             // Sincroniza Trade Ativo (A Fonte da Verdade é o Servidor)
             if (s.currentTrade) {
                 if (!currentTrade || currentTrade.fullSymbol !== s.currentTrade.fullSymbol) {
                    addLog(`📡 MEMÓRIA RECUPERADA: ${s.currentTrade.symbol} ativo na nuvem.`, 'system');
                    currentTrade = s.currentTrade;
                    tradeStartTime = s.tradeStartTime;
                    updateTradeUI(true);
                    initPriceSocket(currentTrade.fullSymbol);
                 }
             } else if (currentTrade) {
                 // Servidor diz que não há trade, mas navegador acha que sim (venda já ocorreu)
                 addLog(`⛳ SINCRONIA: Venda realizada na nuvem. Resetando monitor.`, 'system');
                 resetTrade();
             }
         }
    } catch (e) {
         console.warn("[ALFA-SYNC] Pulso de rede instável.");
    }
}

async function syncExistingProfile(name) {
    if (!name || name.length < 3) return;
    try {
        const r = await fetch('/sync-profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name }) });
        const d = await r.json();
        if (d.found) {
            addLog(`🔄 PERFIL RECUPERADO: ${name.toUpperCase()}`, 'system');
            document.getElementById('slot-1-key').value = d.keys.key;
            document.getElementById('slot-1-secret').value = d.keys.secret;
            activeSlots[1].key = d.keys.key;
            activeSlots[1].secret = d.keys.secret;
            syncBalance();
        }
    } catch(e) {}
}

function resetTrade() { 
    if (tradeSocket) tradeSocket.close();
    currentTrade = null; tradeStartTime = null; updateTradeUI(false); 
}

async function aproveitarOportunidade(fullSymbol) {
    if (!globalSystemPower) {
        alert("Ative o Master primeiro!");
        return;
    }
    if(!confirm(`🚀 SNIPER SWITCH: Deseja abandonar o trade atual e entrar em ${fullSymbol} IMEDIATAMENTE?`)) return;
    
    addLog(`🎯 SNIPER: Re-entrando em ${fullSymbol.replace('USDT','')}. Aguarde liquidação...`, 'system');

    // 1. Se estiver em trade, vende agora
    if (currentTrade) {
        try {
            await executeSell(); 
        } catch(e) {
            addLog(`⚠️ Falha na liquidação prévia: ${e.message}`, 'error');
        }
    }

    // 2. Busca dados da moeda no ranking salvo
    const coin = (window.lastRankingData || []).find(c => c.symbol === fullSymbol);
    if (coin) {
        executeTrade(coin);
    } else {
        addLog(`❌ Dados de ${fullSymbol} não encontrados no radar atual.`, 'error');
    }
}

function renderOpportunityHub(rankingData) {
    const grid = document.getElementById('opportunity-grid');
    if (!grid || !tradeHistory.length) return;

    grid.innerHTML = tradeHistory.map(hist => {
        const live = rankingData.find(r => r.symbol === hist.fullSymbol);
        const currentPrice = live ? live.price : hist.sellPrice;
        const diff = ((currentPrice - hist.sellPrice) / hist.sellPrice) * 100;
        const color = diff >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
        const statusClass = diff >= 0 ? 'recovering' : 'falling';

        return `
            <div class="opt-card ${statusClass}">
                <div class="opt-header">
                    <span class="opt-symbol">${hist.symbol}</span>
                    <span class="badge-real" style="font-size:0.5rem; opacity:0.6;">Vendido: $${hist.sellPrice.toFixed(4)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                    <div class="opt-pnl-group">
                        <span class="opt-pnl-label">Market Gap</span>
                        <div class="opt-pnl-val" style="color:${color}">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%</div>
                    </div>
                    <button onclick="aproveitarOportunidade('${hist.fullSymbol}')" class="btn-opt-buy">COMPRAR AGORA</button>
                </div>
            </div>
        `;
    }).join('');
}

async function agentForceSell() {
    if (!currentTrade) return;
    if (!confirm("⚠️ AGENTE ALFA: Forçar venda a mercado AGORA?")) return;
    try {
        await executeSell();
        addLog("⚡ AGENTE: Venda forçada disparada.", "sell");
    } catch (e) {
        addLog(`❌ Falha no Resgate: ${e.message}`, "error");
    }
}

async function agentClearGhost() {
    const user = document.getElementById('slot-1-name').value;
    if (!confirm("⚠️ AGENTE ALFA: Limpar trade fantasma e resetar monitor LOCALMENTE e na NUVEM?")) return;
    try {
        await fetch('/agent/clear-ghost', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ username: user }) 
        });
        resetTrade();
        addLog("👻 AGENTE: Estado fantasma limpo com sucesso.", "system");
    } catch (e) {
        addLog(`❌ Falha na Limpeza: ${e.message}`, "error");
    }
}

window.agentForceSell = agentForceSell;
window.agentClearGhost = agentClearGhost;
window.aproveitarOportunidade = aproveitarOportunidade;
window.recalibrateCapital = recalibrateCapital;
window.saveSlot = saveSlot;
window.masterToggle = masterToggle;
