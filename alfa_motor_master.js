/**
 * SIFRAS ALFA v3.5 - PREMIUM CONSOLIDADO 
 */

const CONFIG = {
    UPDATE_INTERVAL: 2000, 
    LOG_INTERVAL: 5000,   
    TARGET_PROFIT: 0.8,
    VOLATILITY_WINDOW: 10000,
    MIN_VOLATILITY_TRIGGER: 0.001,
    MAX_CYCLES: 10,
    COOLDOWN_TIME: 1800000,
    BLACKLIST: ['SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV'],
    WITHDRAW_THRESHOLD: 15,
    WITHDRAW_ENABLED: true
};

let activeSlots = { 1: { key: '', secret: '', name: 'OPERADOR MASTER', monitoring: false } };
let currentTrade = null;
let globalSystemPower = false;
let isCooldownActive = false;
let tradeSocket = null;
let lastRankingHash = "";
let lastLogMsg = "";
let completedCycles = 0;
let sessionStartBalance = parseFloat(localStorage.getItem('alfa_session_start') || '0');

// Sniper Analyzer Variables
let isAnalyzingVolatility = false;
let analysisStartTime = 0;
let volatilityBuffer = {};

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
                        analyzeAlfa(ranking);
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
    
    const currentHash = ranking.slice(0, 30).map(c => c.symbol).join('|');
    if (currentHash === lastRankingHash) {
        ranking.slice(0, 30).forEach((c, i) => {
            const els = document.querySelectorAll('.coin-vol');
            if (els[i]) els[i].textContent = `${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%`;
        });
        return;
    }
    lastRankingHash = currentHash;
    grid.innerHTML = ranking.slice(0, 30).map((c, i) => {
        let isTracked = isAnalyzingVolatility && volatilityBuffer[c.symbol];
        let hl = isTracked ? 'border:1px solid var(--primary-neon); background:rgba(0,245,255,0.05);' : '';
        return `
        <div class="log-card" style="margin-bottom:8px; padding:10px; display:flex; justify-content:space-between; ${hl}">
            <span style="font-weight:900; color:var(--text-muted);">#${i + 1}</span>
            <span style="font-weight:800; color:#fff;">${c.symbol.replace('USDT', '')}</span>
            <span class="coin-vol" style="font-weight:900; color:var(--accent-green);">${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%</span>
        </div>
    `}).join('');
}

function analyzeAlfa(ranking) {
    if (currentTrade || isCooldownActive) return;

    // Filtra ranking das posições #2 a #30 (índices 1 a 29)
    const candidates = ranking.slice(1, 30).filter(c => !CONFIG.BLACKLIST.includes(c.symbol.replace('USDT', '')) && !instantBlacklist.includes(c.symbol));
    
    if (!isAnalyzingVolatility) {
        volatilityBuffer = {};
        candidates.forEach(c => { volatilityBuffer[c.symbol] = { initialPrice: c.price, data: c }; });
        analysisStartTime = Date.now();
        isAnalyzingVolatility = true;
        
        let elCycle = document.getElementById('cycle-counter');
        if (elCycle) elCycle.textContent = `RASTREANDO 10S...`;
        return;
    }

    // Checa se os 10 segundos passaram
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
            addLog(`⚡ EXPLOSÃO DETECTADA: ${bestCoin.symbol} subiu +${highestDelta.toFixed(2)}% em 10s!`, 'buy');
            executeTrade(bestCoin);
        } else {
            let limit = CONFIG.MIN_VOLATILITY_TRIGGER;
            let maxReport = bestCoin ? `Máximo: ${bestCoin.symbol} (+${highestDelta.toFixed(2)}%)` : 'Nenhum alvo válido.';
            addLog(`⏱️ Abaixo de ${limit}% em 10s. ${maxReport} Reiniciando rastreamento...`, 'system');
            
            // Reinicia ciclo
            isAnalyzingVolatility = false;
        }
    }
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
        
        // REINICIA O RASTREAMENTO IMEDIATAMENTE APÓS PULAR
        isAnalyzingVolatility = false;
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
            if (sessionStartBalance === 0 || isNaN(sessionStartBalance)) {
                sessionStartBalance = d.totalUsdt;
                localStorage.setItem('alfa_session_start', sessionStartBalance);
                addLog(`🎯 CAPITAL INICIAL FIXADO EM $${sessionStartBalance.toFixed(2)}`, 'system');
            }
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
    if (!currentTrade) return;
    try {
        addLog(`🎯 ALVO ALCANÇADO: Tentando liquidar ${currentTrade.symbol}...`, 'sell');
        
        // Ajuste de Precisão (Evitar erro de Lot Size / Liquidez)
        const info = await fetchOrderInfo(currentTrade.fullSymbol);
        let qtyToSell = currentTrade.qty;
        if (info && info.symbols) {
            const lot = info.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE');
            const step = parseFloat(lot.stepSize);
            qtyToSell = (Math.floor(qtyToSell / step) * step).toFixed(8).replace(/\.?0+$/, "");
        }

        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                key: activeSlots[1].key, 
                secret: activeSlots[1].secret, 
                symbol: currentTrade.fullSymbol, 
                side: 'SELL',
                qty: qtyToSell
            })
        });
        const d = await r.json();
        
        if (d.orderId) {
            addLog(`🚀 ALVO ATINGIDO! VENDA EXECUTADA EM ${currentTrade.symbol}`, 'sell');
            resetTrade();
            isAnalyzingVolatility = false;
            
            completedCycles++;
            if (completedCycles >= CONFIG.MAX_CYCLES) {
                completedCycles = 0;
                isCooldownActive = true;
                addLog(`🛑 SEGURANÇA: 10 Operações Concluídas. Descanso de 30 minutos ativado.`, 'system');
                let elCycle = document.getElementById('cycle-counter');
                if (elCycle) elCycle.textContent = `PAUSA OBRIGATÓRIA: 30M`;
                
                setTimeout(() => {
                    isCooldownActive = false;
                    addLog(`✅ DESCANSO FINALIZADO: Retomando radar de volatilidade!`, 'system');
                }, CONFIG.COOLDOWN_TIME);
            }

            // --- NOVO: SAQUE SEGURO DE LUCRO FIXO ($15) ---
            if (CONFIG.WITHDRAW_ENABLED) {
                const profit = window.currentBalance - sessionStartBalance;
                if (profit >= CONFIG.WITHDRAW_THRESHOLD) {
                    executeAutoWithdraw(CONFIG.WITHDRAW_THRESHOLD);
                }
            }
        } else {
            throw new Error(d.error || "Rejeição na venda");
        }
    } catch (e) {
        const msg = e.message || "Erro de API";
        addLog(`❌ ERRO NA VENDA AUTOMÁTICA: ${msg}`, 'error');
        addLog(`⚠️ DICA: Verifique seu saldo ou venda manualmente e clique em RESET.`, 'system');
        
        // Se falhar a venda e o preço continuar subindo, ele vai tentar de novo no próximo tick.
        // Mas para não travar o robô se de fato não houver saldo, vamos resetar o estado após 10 tentativas.
        window.sellRetries = (window.sellRetries || 0) + 1;
        if (window.sellRetries > 10) {
             addLog(`🚨 LIMPEZA DE SEGURANÇA: Resetando robô após múltiplas falhas de venda.`, 'error');
             resetTrade();
             window.sellRetries = 0;
        }
    }
}

async function fetchOrderInfo(symbol) { try { const r = await fetch(`/info-par?symbol=${symbol}`); return await r.json(); } catch(e) { return null; } }

async function executeAutoWithdraw(amount) {
    try {
        addLog(`💰 PROTEÇÃO: Convertendo lucro fixo de $${amount.toFixed(2)} para BRL...`, 'system');
        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                key: activeSlots[1].key, 
                secret: activeSlots[1].secret, 
                symbol: 'USDTBRL', 
                side: 'SELL',
                qty: amount
            })
        });
        const d = await r.json();
        if (d.orderId) {
            addLog(`✅ SUCESSO: R$ Convertido. Capital base preservado em $${sessionStartBalance.toFixed(2)} USDT.`, 'buy');
            // Nota técnica: Não subtraímos do sessionStartBalance para evitar o loop infinito!
            // O window.currentBalance será atualizado no próximo syncBalance.
        }
    } catch (e) {
        addLog(`⚠️ FALHA NO SAQUE BRL: ${e.message}`, 'error');
    }
}

