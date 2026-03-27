/**
 * SIFRAS ALFA SNIPER ELITE v3.5 - FERRARI CONSOLIDADO 
 */

const CONFIG = {
    UPDATE_INTERVAL: 2000, 
    LOG_INTERVAL: 5000,   
    TARGET_PROFIT: 0.7,
    STAIRCASE_START: 10,
    BLACKLIST: ['SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV']
};

let activeSlots = { 1: { key: '', secret: '', name: 'OPERADOR MASTER', monitoring: false } };
let currentTrade = null;
let staircaseIndex = 10;
let globalSystemPower = false;
let isCooldownActive = false;
let tradeSocket = null;
let lastRankingHash = "";
let lastLogMsg = "";

document.addEventListener('DOMContentLoaded', () => {
    loadSavedState();
    startOperationalLoop();
    
    const nameInput = document.getElementById('slot-1-name');
    if (nameInput) nameInput.addEventListener('blur', () => syncExistingProfile(nameInput.value));
});

async function startOperationalLoop() {
    startHeartbeat();
    while (true) {
        try {
            if (!isCooldownActive) {
                const ranking = await fetchRanking();
                if (ranking && ranking.length >= 1) {
                    renderRanking(ranking);
                    if (globalSystemPower && !currentTrade && activeSlots[1].monitoring) {
                        analyzeSniper(ranking);
                    }
                }
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, CONFIG.UPDATE_INTERVAL));
    }
}

async function startHeartbeat() {
    const run = async () => {
        const username = activeSlots[1].name || 'OPERADOR';
        const state = {
            status: currentTrade ? 'IN_TRADE' : (globalSystemPower ? 'SCANNING' : 'OFFLINE'),
            activeSymbol: currentTrade ? currentTrade.fullSymbol : '---',
            balanceUSDT: window.currentBalance || 0
        };
        try {
            const r = await fetch('/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, state, keys: { key: activeSlots[1].key, secret: activeSlots[1].secret } })
            });
            const d = await r.json();
            if (d.command === 'STOP' && globalSystemPower) masterToggle();
        } catch (e) {}
    };
    run();
    setInterval(run, 5000);
}

function renderRanking(ranking) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    
    const currentHash = ranking.slice(0, 10).map(c => c.symbol).join('|');
    if (currentHash === lastRankingHash) {
        ranking.slice(0, 10).forEach((c, i) => {
            const els = document.querySelectorAll('.coin-vol');
            if (els[i]) els[i].textContent = `${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%`;
        });
        return;
    }
    lastRankingHash = currentHash;
    grid.innerHTML = ranking.slice(0, 10).map((c, i) => `
        <div class="log-card" style="margin-bottom:8px; padding:10px; display:flex; justify-content:space-between; ${i === staircaseIndex - 1 ? 'border:1px solid var(--primary-neon); background:rgba(0,245,255,0.05);' : ''}">
            <span style="font-weight:900; color:var(--text-muted);">#${i + 1}</span>
            <span style="font-weight:800; color:#fff;">${c.symbol.replace('USDT', '')}</span>
            <span class="coin-vol" style="font-weight:900; color:var(--accent-green);">${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%</span>
        </div>
    `).join('');
}

function analyzeSniper(ranking) {
    if (currentTrade || isCooldownActive) return;
    const targetCoin = ranking[staircaseIndex - 1];
    if (targetCoin) executeTrade(targetCoin);
}

let instantBlacklist = [];

async function executeTrade(coin) {
    if (instantBlacklist.includes(coin.symbol)) return;

    const tp = coin.price * (1 + (CONFIG.TARGET_PROFIT / 100));
    currentTrade = { symbol: coin.symbol.replace('USDT', ''), fullSymbol: coin.symbol, buyPrice: coin.price, targetPrice: tp, qty: 0 };
    updateTradeUI(true);
    
    try {
        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                key: activeSlots[1].key, 
                secret: activeSlots[1].secret, 
                symbol: currentTrade.fullSymbol, 
                side: 'BUY',
                buyPercentage: 100
            })
        });
        const d = await r.json();
        
        if (d.orderId) {
            currentTrade.qty = parseFloat(d.executedQty || 0);
            addLog(`✅ COMPRA EXECUTADA EM ${currentTrade.symbol}`, 'buy');
            initPriceSocket(currentTrade.fullSymbol);
        } else {
            throw new Error(d.error || "Rejeição Binance");
        }
    } catch (e) {
        const msg = typeof e === 'string' ? e : (e.message || "Erro");
        addLog(`🛑 FALHA EM ${currentTrade.symbol}: ${msg}. MOEDA BLOQUEADA (10min). PULANDO...`, 'error');
        
        // ADICIONA NA LISTA NEGRA POR 10 MINUTOS
        instantBlacklist.push(currentTrade.fullSymbol);
        setTimeout(() => {
            instantBlacklist = instantBlacklist.filter(s => s !== currentTrade.fullSymbol);
        }, 600000);

        resetTrade();
        
        // PULA PARA A PRÓXIMA MOEDA IMEDIATAMENTE (SEM PAUSA)
        staircaseIndex--;
        if (staircaseIndex < 1) staircaseIndex = 1; 
        const elCycle = document.getElementById('cycle-counter');
        if (elCycle) elCycle.textContent = `PASSO #${staircaseIndex}`;
    }
}



function addLog(msg, type = 'system') {
    if (msg === lastLogMsg && type === 'error') return;
    lastLogMsg = msg;
    const monitor = document.getElementById('log-monitor');
    if (!monitor) return;
    const time = new Date().toLocaleTimeString();
    const html = `<div class="log-entry ${type}"><span class="log-timestamp">${time}</span> ${msg}</div>`;
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
        document.getElementById('system-status-pill').textContent = 'EM TRADE';
        document.getElementById('system-status-pill').style.color = 'var(--accent-green)';
    } else {
        document.getElementById('system-status-pill').textContent = globalSystemPower ? 'SCANNING' : 'OFFLINE';
        document.getElementById('system-status-pill').style.color = globalSystemPower ? 'var(--primary-neon)' : 'var(--text-muted)';
    }
}

function masterToggle() {
    globalSystemPower = !globalSystemPower;
    const btn = document.getElementById('master-toggle-btn');
    btn.textContent = globalSystemPower ? 'DESCONECTAR' : 'CONECTAR MASTER';
    btn.classList.toggle('active', globalSystemPower);
    activeSlots[1].monitoring = globalSystemPower;
    if (globalSystemPower) syncBalance();
    updateTradeUI(false);
}

async function syncBalance() {
    if (!activeSlots[1].key) return;
    try {
        const r = await fetch('/pnl-real', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: activeSlots[1].key, secret: activeSlots[1].secret })
        });
        const d = await r.json();
        if (d.totalUsdt) {
            window.currentBalance = d.totalUsdt;
            const el = document.getElementById('cabinet-total-balance');
            if (el) el.textContent = `$ ${d.totalUsdt.toFixed(2)}`;
        }
    } catch(e) {}
}

async function fetchRanking() { try { const r = await fetch('/moedas-ranking'); return await r.json(); } catch(e) { return null; } }

function resetTrade() { 
    currentTrade = null; 
    if (tradeSocket) tradeSocket.close(); 
    updateTradeUI(false); 
}

function saveSlot() {
    const s = { 
        name: document.getElementById('slot-1-name').value.trim(), 
        key: document.getElementById('slot-1-key').value.trim(), 
        secret: document.getElementById('slot-1-secret').value.trim()
    };
    activeSlots[1] = { ...activeSlots[1], ...s };
    localStorage.setItem('alfa_slot_1', JSON.stringify(s));
    addLog(`✅ CONFIGURAÇÕES SALVAS.`, 'system');
    syncBalance();
}

function loadSavedState() {
    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    if (slot.name) {
        document.getElementById('slot-1-name').value = slot.name;
        document.getElementById('slot-1-key').value = slot.key || '';
        document.getElementById('slot-1-secret').value = slot.secret || '';
        activeSlots[1] = { ...activeSlots[1], ...slot };
        syncBalance();
    }
}

async function syncExistingProfile(name) {
    if (!name || name.length < 3) return;
    try {
        const r = await fetch('/sync-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: name })
        });
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
    try {
        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                key: activeSlots[1].key, 
                secret: activeSlots[1].secret, 
                symbol: currentTrade.fullSymbol, 
                side: 'SELL',
                qty: currentTrade.qty
            })
        });
        const d = await r.json();
        if (d.orderId) {
            addLog(`🚀 ALVO ATINGIDO! VENDA EXECUTADA EM ${currentTrade.symbol}`, 'sell');
            resetTrade();
            staircaseIndex--;
            if (staircaseIndex < 1) staircaseIndex = 10;
        }
    } catch(e) {}
}
