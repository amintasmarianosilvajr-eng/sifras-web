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

// --- BOOTSTRAP ---

document.addEventListener('DOMContentLoaded', () => {
    console.log("[ALFA v4.6.3] Inicializando Instrumentos...");
    loadSavedState();
    
    // Unificar cronometria em 1 único intervalo de 1s
    setInterval(updateHeartbeatUI, 1000);
    
    // Heartbeat de rede a cada 5s
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
        await triggerDataSync(); // Dispara Ranking e Saldo
    }

    // 1.5 Safety Reset para LENS (Anti-Travamento)
    if (isAnalyzingVolatility && (Date.now() - analysisStartTime > CONFIG.VOLATILITY_WINDOW + 5000)) {
        isAnalyzingVolatility = false;
        console.warn("[ALFA] LENS Reset de Segurança acionado.");
    }

    // 2. Atualiza Círculos e Contadores
    updateChronometryActive();
    
    // 3. Atualiza PNL se necessário
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
    if (isCooldownActive) return;
    
    // 1. Fetch Ranking
    const rankingData = await fetchRanking(); 
    if (rankingData && rankingData.ranking) {
        renderRanking(rankingData.ranking);
        analyzeAlfa(rankingData.ranking);
    }
    
    // 2. Fetch Balance/PNL
    await syncBalance();
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
    if (currentTrade || isCooldownActive) return;

    // DEFINIÇÃO: SCAN TOP 15 (Inclui a #1)
    const candidates = ranking.slice(0, 15).filter(c => !CONFIG.BLACKLIST.includes(c.symbol.replace('USDT', '')) && !instantBlacklist.includes(c.symbol));
    
    if (!isAnalyzingVolatility) {
        volatilityBuffer = {};
        candidates.forEach(c => { volatilityBuffer[c.symbol] = { initialPrice: c.price, data: c }; });
        analysisStartTime = Date.now();
        isAnalyzingVolatility = true;
        addLog(`🧪 SCAN ATIVADO: Top 15 (Alvo: +${CONFIG.MIN_VOLATILITY_TRIGGER}%)`, 'system');
        return;
    }

    if (Date.now() - analysisStartTime >= CONFIG.VOLATILITY_WINDOW) {
        let bestCoin = null;
        let highestDelta = -Infinity;
        candidates.forEach(c => {
            const buf = volatilityBuffer[c.symbol];
            if (buf) {
                const delta = ((c.price - buf.initialPrice) / buf.initialPrice) * 100;
                if (delta > highestDelta) {
                    highestDelta = delta;
                    bestCoin = c;
                }
            }
        });

        if (bestCoin && highestDelta >= CONFIG.MIN_VOLATILITY_TRIGGER) {
            addLog(`🚀 GATILHO COMPRA EM ${bestCoin.symbol} (+${highestDelta.toFixed(2)}%)`, 'buy');
            executeTrade(bestCoin);
            isAnalyzingVolatility = false;
        } else {
            // Reinicia o buffer para o próximo ciclo de 10s contínuo
            volatilityBuffer = {};
            candidates.forEach(c => { volatilityBuffer[c.symbol] = { initialPrice: c.price, data: c }; });
            analysisStartTime = Date.now();
            isAnalyzingVolatility = true;
        }
    }
}

async function executeTrade(coin) {
    if (instantBlacklist.includes(coin.symbol)) return;
    const tp = coin.price * (1 + (CONFIG.TARGET_PROFIT / 100));
    currentTrade = { symbol: coin.symbol.replace('USDT', ''), fullSymbol: coin.symbol, buyPrice: coin.price, targetPrice: tp, qty: 0 };
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
    }
}

function initPriceSocket(symbol) {
    if(tradeSocket) tradeSocket.close();
    tradeSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
    tradeSocket.onmessage = (e) => {
        const d = JSON.parse(e.data);
        const price = parseFloat(d.c);
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
    if (pl >= CONFIG.TARGET_PROFIT) executeSell();
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
            resetTrade();
            isAnalyzingVolatility = false;
            completedCycles++;
            if (completedCycles >= CONFIG.MAX_CYCLES) triggerCooldown();
            if (CONFIG.WITHDRAW_ENABLED) checkAndWithdrawProfit();
        } else throw new Error(d.error || "Sell Rejected");
    } catch (e) { addLog(`❌ ERRO NA VENDA: ${e.message}`, 'error'); }
}

function triggerCooldown() {
    completedCycles = 0;
    isCooldownActive = true;
    addLog(`🛑 SEGURANÇA: 10 Ciclos. Pausa de 30 minutos (Proteção Anti-Retomada).`, 'system');
    setTimeout(() => { isCooldownActive = false; addLog(`✅ RETOMANDO: Radar ativado!`, 'system'); }, CONFIG.COOLDOWN_TIME);
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
    if (active) {
        document.getElementById('monitoring-symbol').textContent = currentTrade.symbol;
        document.getElementById('monitoring-buy-price').textContent = `$${currentTrade.buyPrice.toFixed(4)}`;
        document.getElementById('monitoring-target-price').textContent = `$${currentTrade.targetPrice.toFixed(4)}`;
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
        addLog("✅ MOTOR MASTER LIGADO.", "system");
        syncBalance();
        syncCountdown = 1; // Trigger imediato
    } else {
        addLog("🛑 MOTOR MASTER DESLIGADO.", "system");
        updateChronometryStatic();
    }
    updateTradeUI(false);
}

function recalibrateCapital() {
    if (window.currentBalance) {
        sessionStartBalance = window.currentBalance;
        localStorage.setItem('alfa_session_start', sessionStartBalance);
        addLog(`🔄 CALIBRADO: $${sessionStartBalance.toFixed(2)} definido como ponto zero.`, 'system');
        updateSessionStats();
    } else addLog(`⚠️ ERRO: Aguarde o carregamento do saldo.`, 'error');
}

function saveSlot() {
    const s = { name: document.getElementById('slot-1-name').value.trim(), key: document.getElementById('slot-1-key').value.trim(), secret: document.getElementById('slot-1-secret').value.trim() };
    activeSlots[1] = { ...activeSlots[1], ...s };
    localStorage.setItem('alfa_slot_1', JSON.stringify(s));
    addLog(`✅ OPERADOR COMPATIBILIZADO.`, "system");
    syncBalance();
}

function loadSavedState() {
    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    if (slot.name) {
        document.getElementById('slot-1-name').value = slot.name;
        document.getElementById('slot-1-key').value = slot.key || '';
        document.getElementById('slot-1-secret').value = slot.secret || '';
        activeSlots[1] = { ...activeSlots[1], ...slot };
    }
    const sessionUser = localStorage.getItem('alfa_session_user');
    if (sessionUser && !slot.name) document.getElementById('slot-1-name').value = sessionUser;
}

async function pushNetworkHeartbeat() {
    const username = activeSlots[1].name || 'OPERADOR';
    const state = { status: currentTrade ? 'IN_TRADE' : (globalSystemPower ? 'SCANNING' : 'OFFLINE'), activeSymbol: currentTrade ? currentTrade.fullSymbol : '---', balanceUSDT: window.currentBalance || 0 };
    try {
        const r = await fetch('/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, state, keys: { key: activeSlots[1].key, secret: activeSlots[1].secret } }) });
        const d = await r.json();
        if (d.command === 'STOP' && globalSystemPower) masterToggle();
    } catch (e) {}
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

window.recalibrateCapital = recalibrateCapital;
window.saveSlot = saveSlot;
window.masterToggle = masterToggle;
