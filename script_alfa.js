/**
 * SIFRAS ALFA PREMIUM v6.2 - DASHBOARD PASSIVO
 */

const CONFIG = {
    SYNC_INTERVAL: 5000,
    UPDATE_UI_INTERVAL: 1000
};

let activeSlots = { 1: { key: '', secret: '', name: '', monitoring: false } };
let currentTrade = null;
let sessionStartBalance = parseFloat(localStorage.getItem('alfa_session_start') || '0');
let lastLogMsg = "";

document.addEventListener('DOMContentLoaded', () => {
    loadSavedState();
    setInterval(tick, CONFIG.UPDATE_UI_INTERVAL);
    setInterval(syncWithServer, CONFIG.SYNC_INTERVAL);
});

function tick() {
    updateChronometry();
    updateSessionUI();
}

async function syncWithServer() {
    const username = activeSlots[1].name || localStorage.getItem('alfa_session_user');
    if (!username) return;

    try {
        const r = await fetch('/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username, 
                state: { monitoring: activeSlots[1].monitoring },
                keys: { key: activeSlots[1].key, secret: activeSlots[1].secret } 
            })
        });
        const d = await r.json();

        if (d.success) {
            updateUIFromState(d.serverState);
            if (d.marketRanking) renderRanking(d.marketRanking);
        }
    } catch (e) {
        console.error("Erro na sincronia cloud:", e);
    }
}

function updateUIFromState(state) {
    if (!state) return;

    currentTrade = state.currentTrade;
    
    const container = document.getElementById('active-trade-container');
    const msg = document.getElementById('no-trade-msg');

    if (currentTrade) {
        if (container) container.classList.remove('hidden');
        if (msg) msg.classList.add('hidden');

        document.getElementById('monitoring-symbol').innerText = currentTrade.symbol;
        document.getElementById('monitoring-buy-price').innerText = `$${currentTrade.buyPrice.toFixed(4)}`;
        document.getElementById('monitoring-current-price').innerText = `$${(currentTrade.currentPrice || 0).toFixed(4)}`;
        
        const pnl = currentTrade.currentPnl || 0;
        const pnlEl = document.getElementById('monitoring-pl');
        if (pnlEl) {
            pnlEl.innerText = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
            pnlEl.style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
        }

        const progress = Math.min(100, Math.max(0, (pnl / 0.9) * 100));
        const fill = document.getElementById('trade-progress-fill');
        if (fill) fill.style.width = `${progress}%`;
    } else {
        if (container) container.classList.add('hidden');
        if (msg) msg.classList.remove('hidden');
    }

    // Atualiza Ciclos
    const elCycle = document.getElementById('cycle-counter');
    if (elCycle) {
        const isCooldown = state.cooldownUntil && Date.now() < state.cooldownUntil;
        if (isCooldown) {
            const rem = Math.ceil((state.cooldownUntil - Date.now()) / 60000);
            elCycle.innerText = `PAUSA: ${rem}m`;
        } else {
            elCycle.innerText = `${state.cycleCount || 0} / 10`;
        }
    }

    // Logs sincronizados
    if (state.tradeHistory && state.tradeHistory.length > 0) {
        const last = state.tradeHistory[0];
        const logStr = `${last.symbol} | PNL: ${last.pnl.toFixed(2)}%`;
        if (logStr !== lastLogMsg) {
            addLog(`✅ OPERAÇÃO CONCLUÍDA: ${logStr}`, 'buy');
            lastLogMsg = logStr;
            syncBalance();
        }
    }
}

async function syncBalance() {
    const slot = activeSlots[1];
    if (!slot.key || !slot.secret) return;

    try {
        const res = await fetch('/pnl-real', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: slot.key, secret: slot.secret })
        });
        const data = await res.json();
        
        if (data.totalUsdt !== undefined) {
            window.currentBalance = data.totalUsdt;
            if (sessionStartBalance === 0) {
                sessionStartBalance = data.totalUsdt;
                localStorage.setItem('alfa_session_start', sessionStartBalance.toString());
            }
            const balanceEl = document.getElementById('cabinet-total-balance');
            if (balanceEl) balanceEl.innerText = `$ ${data.totalUsdt.toFixed(2)}`;
            updateSessionUI();
        }
    } catch (e) {}
}

function renderRanking(list) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    grid.innerHTML = list.slice(0, 15).map((item, i) => `
        <div class="log-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:900; font-size:1rem;">#${i + 1} ${item.symbol.replace('USDT', '')}</span>
                <span style="color:var(--accent-green); font-weight:800;">${item.vol.toFixed(2)}%</span>
            </div>
            <div style="font-size:0.6rem; color:var(--text-muted); margin-top:4px;">VOL: $${(item.quoteVol || 0 / 1000000).toFixed(1)}M</div>
        </div>
    `).join('');
}

function updateChronometry() {
    const tradeVal = document.getElementById('trade-timer-val');
    if (currentTrade && tradeVal) {
        const elapsed = Math.floor((Date.now() - (currentTrade.buyTime || Date.now())) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        tradeVal.innerText = `${mins}:${secs}`;
    }
}

function addLog(msg, type) {
    const log = document.getElementById('log-monitor');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-timestamp">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    log.prepend(entry);
    if (log.children.length > 20) log.lastChild.remove();
}

function masterToggle() {
    activeSlots[1].monitoring = !activeSlots[1].monitoring;
    const btn = document.getElementById('master-toggle-btn');
    const pill = document.getElementById('system-status-pill');
    
    if (activeSlots[1].monitoring) {
        btn.innerText = "DESCONECTAR MASTER";
        if (pill) { pill.innerText = "BUSCANDO ALVO"; pill.className = "status-pill online"; }
        addLog("SISTEMA ALFA CONECTADO AO SERVIDOR.", "system");
        syncBalance(); 
    } else {
        btn.innerText = "CONNECT MASTER";
        if (pill) { pill.innerText = "OFFLINE"; pill.className = "status-pill waiting"; }
        addLog("SISTEMA EM PAUSA.", "system");
    }
    syncWithServer();
}

function updateSessionUI() {
    const pnlHeader = document.getElementById('header-realtime-pnl');
    if (!pnlHeader || !window.currentBalance) return;
    
    const profit = window.currentBalance - sessionStartBalance;
    const pct = sessionStartBalance > 0 ? (profit / sessionStartBalance) * 100 : 0;
    const color = profit >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
    pnlHeader.innerText = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${pct.toFixed(2)}%)`;
    pnlHeader.style.color = color;
}

function loadSavedState() {
    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    if (slot.key) {
        const nameEl = document.getElementById('slot-1-name');
        const keyEl = document.getElementById('slot-1-key');
        const secEl = document.getElementById('slot-1-secret');
        if (nameEl) nameEl.value = slot.name || '';
        if (keyEl) keyEl.value = slot.key || '';
        if (secEl) secEl.value = slot.secret || '';
        activeSlots[1] = { ...activeSlots[1], ...slot };
    }
}

function saveSlot() {
    const id = 1;
    activeSlots[id].key = document.getElementById(`slot-${id}-key`).value;
    activeSlots[id].secret = document.getElementById(`slot-${id}-secret`).value;
    activeSlots[id].name = document.getElementById(`slot-${id}-name`).value;
    localStorage.setItem('alfa_slot_1', JSON.stringify(activeSlots[id]));
    addLog(`Operador ${activeSlots[id].name} autorizado!`, 'system');
    syncWithServer();
}

window.masterToggle = masterToggle;
window.saveSlot = saveSlot;
window.syncBalance = syncBalance;
