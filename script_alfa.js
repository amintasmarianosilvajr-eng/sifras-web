let activeSlots = { 1: { monitoring: false, key: '', secret: '', name: '' } };
let currentTrade = null;
let sessionStartBalance = 0;

async function syncBalance() {
    const key = activeSlots[1].key || document.getElementById('slot-1-key')?.value;
    const secret = activeSlots[1].secret || document.getElementById('slot-1-secret')?.value;
    if (!key || !secret) return;

    try {
        const r = await fetch('/pnl-real', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, secret })
        });
        const d = await r.json();
        if (d.totalUsdt) {
            window.currentBalance = parseFloat(d.totalUsdt);
            if (sessionStartBalance === 0) sessionStartBalance = window.currentBalance;
            updateSessionUI();
        }
    } catch (e) {}
}

async function syncWithServer() {
    const nameInput = document.getElementById('slot-1-name');
    const username = activeSlots[1].name || localStorage.getItem('alfa_session_user') || (nameInput ? nameInput.value : '');
    if (!username) return;

    try {
        const r = await fetch('/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username, 
                state: { monitoring: activeSlots[1].monitoring },
                keys: { 
                    key: activeSlots[1].key || document.getElementById('slot-1-key')?.value, 
                    secret: activeSlots[1].secret || document.getElementById('slot-1-secret')?.value 
                } 
            })
        });
        const d = await r.json();

        if (d.success) {
            updateUIFromState(d.serverState);
            if (d.marketRanking) {
                renderRanking(d.marketRanking);
                renderOpportunityHub(d.marketRanking);
            }
            if (d.keys && d.keys.key && !activeSlots[1].key) {
                activeSlots[1].key = d.keys.key;
                activeSlots[1].secret = d.keys.secret;
                const kEl = document.getElementById('slot-1-key');
                const sEl = document.getElementById('slot-1-secret');
                if (kEl) kEl.value = d.keys.key;
                if (sEl) sEl.value = d.keys.secret;
            }
        }
    } catch (e) { console.error("Sync error:", e); }
}

function updateUIFromState(state) {
    if (!state) return;
    const trade = state.currentTrade;
    
    // Switch between Empty Msg and Active Trade
    const emptyMsg = document.getElementById('no-trade-msg');
    const tradeCont = document.getElementById('active-trade-container');
    const statusPill = document.querySelector('.status-pill');

    if (trade && trade.symbol) {
        if (emptyMsg) emptyMsg.classList.add('hidden');
        if (tradeCont) tradeCont.classList.remove('hidden');
        
        document.getElementById('monitoring-symbol').innerText = trade.symbol;
        document.getElementById('monitoring-buy-price').innerText = `$ ${Number(trade.buyPrice).toFixed(4)}`;
        document.getElementById('monitoring-current-price').innerText = `$ ${Number(trade.currentPrice).toFixed(4)}`;
        document.getElementById('monitoring-target-price').innerText = `$ ${Number(trade.targetPrice).toFixed(6)}`;
        
        const pnl = trade.currentPnl || 0;
        const pnlEl = document.getElementById('monitoring-pl');
        if (pnlEl) {
            pnlEl.innerText = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
            pnlEl.style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
        }
        
        const pnlCash = (pnl / 100) * (state.currentBalance || 10);
        const cashEl = document.getElementById('monitoring-pnl-usdt');
        if (cashEl) cashEl.innerText = `($${pnlCash.toFixed(2)})`;

        // Progress Bar
        const fill = document.getElementById('trade-progress-fill');
        if (fill) {
            const progress = Math.min(Math.max((pnl / 0.9) * 100, 0), 100);
            fill.style.width = `${progress}%`;
        }
        if (statusPill) { statusPill.innerText = "IN TRADE"; statusPill.className = "status-pill online"; }
        currentTrade = trade;
    } else {
        if (emptyMsg) emptyMsg.classList.remove('hidden');
        if (tradeCont) tradeCont.classList.add('hidden');
        if (state.monitoring) {
            if (statusPill) { statusPill.innerText = "SCANNING"; statusPill.className = "status-pill online"; }
        } else {
            if (statusPill) { statusPill.innerText = "OFFLINE"; statusPill.className = "status-pill waiting"; }
        }
        currentTrade = null;
    }

    window.currentBalance = state.currentBalance || 0;
    const cycleEl = document.getElementById('cycle-counter');
    if (cycleEl) cycleEl.innerText = `${state.cycleCount || 0} / 3`;
    updateSessionUI();
}

function renderRanking(list) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    grid.innerHTML = list.slice(0, 10).map((item, i) => `
        <div class="log-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:900; font-size:1rem;">#${i + 1} ${item.symbol.replace('USDT', '')}</span>
                <span style="color:var(--accent-green); font-weight:800;">${item.vol.toFixed(2)}%</span>
            </div>
            <div style="font-size:0.6rem; color:var(--text-muted); margin-top:4px;">VOL: $${((item.quoteVol || 0) / 1000000).toFixed(1)}M</div>
        </div>
    `).join('');
}

function renderOpportunityHub(list) {
    const grid = document.getElementById('opportunity-grid');
    if (!grid) return;
    grid.innerHTML = list.slice(0, 10).map(item => `
        <div class="opp-card ${item.vol >= 0 ? 'bull' : 'bear'}">
            <div class="opp-header">
                <span class="opp-symbol">${item.symbol.replace('USDT', '')}</span>
                <span class="opp-vol">${item.vol.toFixed(2)}%</span>
            </div>
            <div class="opp-price">$${item.price.toFixed(4)}</div>
            <div class="opp-vol-label">VOL: $${((item.quoteVol || 0) / 1000000).toFixed(1)}M</div>
        </div>
    `).join('');
}

function updateSessionUI() {
    const pnlHeader = document.getElementById('header-realtime-pnl');
    const balanceCabinet = document.getElementById('cabinet-total-balance');
    const valPnl = document.querySelector('.val-pnl');

    if (window.currentBalance !== undefined && balanceCabinet) {
        balanceCabinet.innerHTML = `$ ${window.currentBalance.toFixed(2)}`;
        
        if (pnlHeader) {
            const profit = window.currentBalance - sessionStartBalance;
            const pct = sessionStartBalance > 0 ? (profit / sessionStartBalance) * 100 : 0;
            const color = profit >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
            pnlHeader.innerText = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${pct.toFixed(2)}%)`;
            pnlHeader.style.color = color;
            if (valPnl) { valPnl.innerText = `$${profit.toFixed(2)}`; valPnl.style.color = color; }
        }
    }
}

function masterToggle() {
    activeSlots[1].monitoring = !activeSlots[1].monitoring;
    const btn = document.getElementById('master-toggle-btn');
    if (activeSlots[1].monitoring) {
        if (btn) btn.innerText = "DESCONECTAR MASTER";
        addLog("SISTEMA ALFA CONECTADO AO SERVIDOR.", "system");
        syncBalance(); 
    } else {
        if (btn) btn.innerText = "CONNECT MASTER";
        addLog("SISTEMA EM PAUSA.", "system");
    }
    syncWithServer();
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

function saveSlot(id = 1) {
    const name = document.getElementById(`slot-${id}-name`).value;
    const key = document.getElementById(`slot-${id}-key`).value;
    const secret = document.getElementById(`slot-${id}-secret`).value;
    
    activeSlots[id] = { monitoring: activeSlots[1].monitoring, key, secret, name };
    localStorage.setItem('alfa_session_user', name);
    localStorage.setItem('alfa_slot_1', JSON.stringify(activeSlots[id]));
    
    addLog(`Operador ${name} autorizado pelo servidor!`, 'system');
    syncWithServer();
}

// Inicia Cronômetros
setInterval(syncWithServer, 2000);
setInterval(() => {
    const syncVal = document.getElementById('sync-timer-val');
    if (syncVal) {
        let current = parseInt(syncVal.innerText) || 10;
        current = current <= 1 ? 10 : current - 1;
        syncVal.innerText = `${current}s`;
    }
}, 1000);

window.onload = () => {
    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    if (slot.key) {
        document.getElementById('slot-1-name').value = slot.name || '';
        document.getElementById('slot-1-key').value = slot.key || '';
        document.getElementById('slot-1-secret').value = slot.secret || '';
        activeSlots[1] = { ...activeSlots[1], ...slot };
    }
    syncWithServer();
};

window.masterToggle = masterToggle;
window.saveSlot = saveSlot;
window.recalibrateCapital = () => { sessionStartBalance = window.currentBalance; updateSessionUI(); };
