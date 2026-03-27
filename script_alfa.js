/**
 * SIFRAS ALFA SNIPER ELITE v3.5 FERRARI
 * Protocolo de Monitoramento #3 | Alvo 0.8% | Sem Stop Loss
 */

const CONFIG = {
    UPDATE_INTERVAL: 1000, 
    LOG_INTERVAL: 3000,   
    TARGET_PROFIT: 0.7, // Padronizado: 0,7% de lucro geral
    STAIRCASE_START: 10,
    SLEEP_AFTER_N1: 1200000, // 20 minutos em ms
    BLACKLIST: [
        'SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV',
        'LUNC', 'USTC', 'FTT', 'VGX', 'WRX', 'REP', 'BOND', 'EPX', 'POLS', 'MULT', 'PNT', 'WAVES', 'OMNI', 'REEF', 'MDX', 'LOOM', 'KP3R', 'DOCK', 'OAX', 'PROS', 'VITE', 'FOR', 'IRIS', 'NULS', 'FIDA', 'CVX', 'HARD', 'WNXM', 'GLM', 'AKRO',
        'AVA', 'KP3R', 'REEF', 'VITE', 'UNFI', 'OAX', 'DOCK', 'NULS', 'IRIS', 'TWT'
    ]
};

let activeSlots = { 1: { key: '', secret: '', name: '', monitoring: false } };
let currentTrade = null;
let cycleCount = 0;
let staircaseIndex = 10; // Inicia na 10ª colocada
let lastExecutedSymbol = null;
let tradeSocket = null;
let globalSystemPower = false;
let isClosingTrade = false;
let startOfDayBalance = null;



let isCooldownActive = false; // Novo: Controle de pausa a cada 5 ciclos

async function startOperationalLoop() {
    startHeartbeat(); // Inicia o monitoramento remoto
    while (true) {
        try {
            // Se estiver em modo respiro (cooldown), não busca novos alvos
            if (isCooldownActive) {
                // APENAS ATUALIZA O RANKING PARA MANTER O PAINEL VIVO
                const r = await fetchRanking();
                if (r) renderRanking(r);
            } else {
                const ranking = await fetchRanking();
                if (ranking && ranking.length >= 1) { // Reduzido para mostrar qualquer moeda capturada
                    renderRanking(ranking);
                    if (globalSystemPower && !currentTrade && activeSlots[1].monitoring) {
                        analyzeSniper(ranking);
                    }
                }
            }
        } catch (e) {
            console.error("Operational fail:", e);
        }
        await new Promise(r => setTimeout(r, CONFIG.UPDATE_INTERVAL));
    }
}

async function startHeartbeat() {
    const runHeartbeat = async () => {
        const username = activeSlots[1].name || 'Usuario_Anonimo';
        
        let livePnlUsdt = 0;
        let livePnlPct = 0;
        if (currentTrade && window.lastPrice) {
            livePnlPct = ((window.lastPrice - currentTrade.buyPrice) / currentTrade.buyPrice) * 100;
            livePnlUsdt = (livePnlPct / 100) * (currentTrade.buyPrice * currentTrade.qty);
        }

        const totalPnlRealized = window.accumulatedPnl || 0;
        const totalPnlTotal = totalPnlRealized + livePnlUsdt; 

        const state = {
            status: currentTrade ? 'IN_TRADE' : (globalSystemPower ? 'SCANNING' : 'OFFLINE'),
            currentStep: currentTrade ? 'FECHANDO ALVO' : (globalSystemPower ? 'BUSCANDO ENTRADA' : 'SISTEMA DESLIGADO'),
            activeSymbol: currentTrade ? currentTrade.fullSymbol : '---',
            buyPrice: currentTrade ? currentTrade.buyPrice : 0,
            currentPrice: window.lastPrice || 0,
            targetPrice: currentTrade ? currentTrade.targetPrice : 0,
            buyAmountUSDT: currentTrade ? (currentTrade.buyPrice * currentTrade.qty) : 0,
            balanceUSDT: window.currentBalance || 0,
            liquidPnlPool: totalPnlTotal, 
            salesCount: cycleCount,
            staircaseIndex: staircaseIndex, // NOVO: Informa o degrau ao admin
            totalProfitPct: (totalPnlTotal / (window.startOfDayBalance || 1)) * 100,
            realizedProfitBRL: totalPnlTotal * 5.50 
        };

        try {
            const r = await fetch('/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username, 
                    state, 
                    keys: { key: activeSlots[1].key, secret: activeSlots[1].secret },
                    token: localStorage.getItem('alfa_auth_token')
                })
            });
            const d = await r.json();
            
            updateApprovalUI(d.isApproved);

            // Se o servidor diz que não estamos registrados (foi deletado/resetado)
            if (d.notRegistered) {
                console.warn("⚠️ ACESSO REVOGADO: Usuário não encontrado no servidor.");
                localStorage.clear(); // Limpa TUDO: chaves, nome, estado
                window.location.href = '/'; // Volta para a tela de registro/login
                return;
            }

            if (d.command === 'STOP' && globalSystemPower) {
                addLog(`⚠️ COMANDO REMOTO: Parada solicitada via Admin.`, 'error');
                if (currentTrade) {
                    addLog(`🛑 EMERGÊNCIA: Liquidando posição ativa imediatamente!`, 'error');
                    await liquidateTrade(0);
                }
                masterToggle(); 
            }
        } catch (e) {}
    };

    runHeartbeat(); // Executa agora
    setInterval(runHeartbeat, 3000); // Frequência aumentada para 3s (Próximo de imediato)
}

async function forcePanic() {
    if(!confirm("🚨 STOP GERAL: Deseja interromper todas as operações e vender a mercado AGORA?")) return;
    
    addLog(`🚨 PANIC STOP ACIONADO PELO USUÁRIO!`, 'error');
    
    // Notifica o servidor
    try {
        fetch('/panic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: activeSlots[1].name })
        });
    } catch (e) {}

    if (currentTrade) {
        addLog(`🛑 VENDENDO ATIVO IMEDIATAMENTE...`, 'error');
        await liquidateTrade(0);
    }
    
    if (globalSystemPower) masterToggle(); // Desliga o scanner se estiver ligado
}

function updateApprovalUI(approved) {
    const overlay = document.getElementById('approval-overlay');
    if (!overlay) return;

    // BLOQUEIO TOTAL: Só libera se receber explicitamente TRUE do servidor
    if (approved === true) {
        overlay.classList.remove('show');
    } else {
        overlay.classList.add('show');
        // Se foi bloqueado, desliga o robô imediatamente
        if (globalSystemPower) {
            globalSystemPower = false;
            const btn = document.getElementById('master-toggle-btn');
            if(btn) {
                btn.textContent = 'CONECTAR MASTER';
                btn.style.borderColor = 'var(--primary-neon)';
            }
            updateTradeUI(false);
        }
    }
}

function startDynamicLogExposition() {
    setInterval(() => {
        if (!globalSystemPower || currentTrade || isClosingTrade) return;
        addLog(`[PROTOCOLO ESCALADA] Monitoramento Ativo. Escaneando Rank #1-10...`, 'scan');
    }, CONFIG.LOG_INTERVAL);
}

function analyzeSniper(ranking) {
    if (currentTrade || isClosingTrade || isCooldownActive) return;
    
    // Protocolo Escalada: Busca a moeda na posição staircaseIndex
    const targetCoin = ranking[staircaseIndex - 1]; // staircaseIndex 10 -> ranking[9]
    if (!targetCoin) {
        addLog(`[ESCALADA] Aguardando posição #${staircaseIndex} no ranking...`, 'scan');
        return;
    }

    const sym = targetCoin.symbol.replace('USDT', '');
    if (CONFIG.BLACKLIST.includes(sym)) {
        addLog(`[ESCALADA] #${staircaseIndex} (${sym}) está na Blacklist. Pulando...`, 'error');
        staircaseIndex--; // Pula para a próxima
        if (staircaseIndex < 1) startCooldownPeriod(true); // Se era a 1ª, dorme
        return;
    }

    addLog(`🧗 PROTOCOLO ESCALADA: Entrando na #${staircaseIndex} colocada: ${sym}`, 'system');
    executeTrade(targetCoin);
}

async function executeTrade(coin) {
    const tp = coin.price * (1 + (CONFIG.TARGET_PROFIT / 100));
    currentTrade = { symbol: coin.symbol.replace('USDT', ''), fullSymbol: coin.symbol, buyPrice: coin.price, targetPrice: tp, qty: 0, startTime: Date.now() };
    updateTradeUI(true);
    const res = await sendOrder('BUY', currentTrade.fullSymbol);
    if (res && res.orderId) {
        currentTrade.qty = parseFloat(res.executedQty || 0);
        saveActiveTrade();
        addLog(`✅ ORDEM EXECUTADA! ${currentTrade.symbol} sniperado com sucesso. $${res.cummulativeQuoteQty} USDT investidos.`, 'system');
        initPriceSocket(currentTrade.fullSymbol);
    } else {
        addLog(`❌ FALHA NA ENTRADA: A Binance recusou a ordem. Entrando em pausa de segurança (30s)...`, 'error');
        resetTrade();
        
        // Ativa Cooldown de Erro para parar a piscadeira
        isCooldownActive = true;
        const elCycle = document.getElementById('cycle-counter');
        if (elCycle) elCycle.innerHTML = `<span style="color:var(--danger-neon);">ERRO</span> 00:30`;
        
        setTimeout(() => {
            isCooldownActive = false;
            if (elCycle) elCycle.textContent = `PASSO #${staircaseIndex}`;
            addLog(`🔄 Pausa de erro concluída. Retomando escaneamento...`, 'system');
        }, 30000);
    }
}

function saveActiveTrade() {
    localStorage.setItem('alfa_active_trade_v35', JSON.stringify(currentTrade));
}

function initPriceSocket(symbol) {
    if (tradeSocket) tradeSocket.close();
    tradeSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
    tradeSocket.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d && d.c) {
            console.log(`🚀 Recebendo dados do WS para ${symbol}: ${d.c}`); // Added console log as per instruction
            updateLivePNL(parseFloat(d.c));
        }
    };
}

function updateLivePNL(curr) {
    window.lastPrice = curr; // Para o heartbeat
    if (!currentTrade || isClosingTrade) return;
    const pnl = ((curr - currentTrade.buyPrice) / currentTrade.buyPrice) * 100;
    const pnlUsdt = (pnl / 100) * (currentTrade.buyPrice * currentTrade.qty);
    document.getElementById('monitoring-pl').textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
    document.getElementById('monitoring-pl').style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
    document.getElementById('monitoring-pnl-usdt').textContent = `($${pnlUsdt >= 0 ? '+' : ''}${pnlUsdt.toFixed(2)})`;
    document.getElementById('monitoring-current-price').textContent = `$${curr.toFixed(4)}`;
    const prog = Math.max(0, Math.min(100, (pnl / CONFIG.TARGET_PROFIT) * 100));
    document.getElementById('trade-progress-fill').style.width = `${prog}%`;
    if (pnl >= CONFIG.TARGET_PROFIT && !isClosingTrade) { isClosingTrade = true; liquidateTrade(pnl); }
}

async function liquidateTrade(final) {
    if (final === 0) {
        addLog(`🚨 VENDA DE EMERGÊNCIA: Encerramento forçado em andamento...`, 'error');
    } else {
        addLog(`🎯 ALVO ALCANÇADO! Meta de ${CONFIG.TARGET_PROFIT}% batida. Fechando...`, 'sell_neon');
    }
    const info = await fetchOrderInfo(currentTrade.fullSymbol);
    let q = currentTrade.qty;
    if (info) {
        const step = parseFloat(info.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE').stepSize);
        q = (Math.floor((q * 0.999) / step) * step).toFixed(8).replace(/\.?0+$/, "");
    }
    const res = await sendOrder('SELL', currentTrade.fullSymbol, q);
    if (res && res.orderId) {
        addLog(`💰 LUCRO NO BOLSO! Degrau #${staircaseIndex} concluído com sucesso.`, 'sell_neon');
        
        const profitUsdt = (currentTrade.qty * currentTrade.buyPrice) * (CONFIG.TARGET_PROFIT / 100);
        window.accumulatedPnl = (window.accumulatedPnl || 0) + profitUsdt;

        showProfitOverlay();
        cycleCount++; 
        
        // Protocolo Escalada: Avança para o próximo degrau (10 -> 9 -> 8...)
        staircaseIndex--;
        
        // Atualiza UI de ciclos / degraus
        document.getElementById('cycle-counter').textContent = (staircaseIndex < 1) ? "DORMINDO" : `PASSO #${staircaseIndex}`;

        saveGlobalState(); 
        resetTrade(); 
        syncBalance();

        // Se terminou o ciclo (chegou na 1ª e vendeu), adormece 20 min
        if (staircaseIndex < 1) {
            startCooldownPeriod(true);
        }
    } else { 
        addLog(`❌ ERRO NA LIQUIDAÇÃO. Finalize manualmente na Binance!`, 'error'); 
        isClosingTrade = false; 
    }
}

async function fetchRanking() {
    const start = performance.now();
    try { 
        const r = await fetch('/moedas-ranking'); 
        const end = performance.now();
        const lat = Math.round(end - start);
        const elLat = document.getElementById('header-latency');
        if (elLat) {
            elLat.textContent = `${lat} ms`;
            elLat.style.color = lat < 250 ? 'var(--primary-neon)' : (lat < 600 ? '#f1c40f' : 'var(--danger-neon)');
        }
        return await r.json(); 
    } catch(e) { return null; }
}

async function sendOrder(side, symbol, qty = null) {
    const body = { 
        key: activeSlots[1].key, 
        secret: activeSlots[1].secret, 
        symbol, 
        side,
        buyPercentage: activeSlots[1].buyPercentage || 100
    };
    if (qty) body.qty = qty;
    try {
        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        return d;
    } catch(e) { 
        addLog(`⚠️ ORDEM RECUSADA: ${e.message}`, 'error');
        return null; 
    }
}

function renderRanking(ranking) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    grid.innerHTML = ranking.slice(0, 10).map((c, i) => `
        <div class="ranking-item ${i === 2 ? 'log-neon-scan' : ''}">
            <span class="rank-num">#${i + 1}</span>
            <span class="coin-name">${c.symbol.replace('USDT', '')}</span>
            <span class="coin-vol">${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%</span>
        </div>
    `).join('');
}

function addLog(msg, type = 'system') {
    const monitor = document.getElementById('log-monitor');
    if (!monitor) return;
    const time = new Date().toLocaleTimeString();
    let html = "";
    if (type.includes('neon')) {
        const cls = type.includes('buy') ? 'log-neon-buy' : 'log-neon-sell';
        html = `<div class="log-card ${cls}"><span class="log-timestamp">${time}</span><span class="log-entry-text" style="font-weight:900;">${msg.toUpperCase()}</span></div>`;
    } else {
        const cls = type === 'scan' ? 'log-neon-scan' : `log-entry ${type}`;
        html = `<div class="${cls}"><span class="log-timestamp">${time}</span><span class="log-entry-text">${msg}</span></div>`;
    }
    monitor.innerHTML = html + monitor.innerHTML;
}

function startCooldownPeriod(isStaircaseEnd = false) {
    isCooldownActive = true;
    const duration = isStaircaseEnd ? CONFIG.SLEEP_AFTER_N1 : 600000; // 20 min vs 10 min
    const durationMin = duration / 60000;

    addLog(`⏳ INICIANDO RESPIRO ESTRATÉGICO DE ${durationMin} MINUTOS...`, 'scan');
    
    let timeLeft = duration / 1000; 
    const elCycle = document.getElementById('cycle-counter');
    if (elCycle) elCycle.innerHTML = `<span style="color:var(--danger-neon); font-size:0.75rem;">RESPIRO</span> ${durationMin}:00`;

    const timer = setInterval(() => {
        timeLeft--;
        
        if (elCycle) {
            const min = Math.floor(timeLeft / 60);
            const sec = timeLeft % 60;
            const timeStr = `${min}:${sec < 10 ? '0' : ''}${sec}`;
            elCycle.innerHTML = `<span style="color:var(--danger-neon); font-size:0.75rem;">RESPIRO</span> ${timeStr}`;
        }

        if (timeLeft <= 0) {
            clearInterval(timer);
            isCooldownActive = false;
            staircaseIndex = 10; // Reset para a décima
            saveGlobalState(); 
            
            if(elCycle) elCycle.textContent = 'PASSO #10';
            addLog(`🚀 PAUSA CONCLUÍDA! Retomando Escalada na #10 colocada...`, 'system');
        }
    }, 1000);
}

function updateTradeUI(active) {
    document.getElementById('active-trade-container').classList.toggle('hidden', !active);
    document.getElementById('no-trade-msg').classList.toggle('hidden', active);
    const pill = document.getElementById('system-status-pill');
    
    if (isCooldownActive) {
        pill.textContent = 'RESPIRO 10 MIN';
        pill.style.borderColor = 'var(--text-muted)';
    } else {
        pill.textContent = active ? 'MONITORANDO TRADE' : (globalSystemPower ? 'BUSCANDO ALVO' : 'OFFLINE');
        pill.style.borderColor = active ? 'var(--accent-green)' : 'var(--card-border)';
    }

    if (active) {
        document.getElementById('monitoring-symbol').textContent = currentTrade.symbol;
        document.getElementById('monitoring-buy-price').textContent = `$${currentTrade.buyPrice.toFixed(4)}`;
        document.getElementById('monitoring-target-price').textContent = `$${currentTrade.targetPrice.toFixed(4)}`;
    }
}

let syncInterval = null;
let currentBuyPercentage = 100; // Por padrão usar 100% (dentro da margem do servidor)

function setBuyPercentage(pct, btn) {
    currentBuyPercentage = pct;
    // UI Update
    document.querySelectorAll('.btn-pct').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Salvar no slot ativo
    activeSlots[1].buyPercentage = pct;
    saveSlot(1); 
    addLog(`Capital sniper ajustado para ${pct}% do saldo USDT.`, 'system');
}

function masterToggle() {
    globalSystemPower = !globalSystemPower;
    const btn = document.getElementById('master-toggle-btn');
    btn.textContent = globalSystemPower ? 'DESCONECTAR' : 'CONECTAR MASTER';
    btn.style.borderColor = globalSystemPower ? 'var(--danger-neon)' : 'var(--primary-neon)';
    activeSlots[1].monitoring = globalSystemPower;
    
    if (globalSystemPower) {
        syncBalance();
        if (syncInterval) clearInterval(syncInterval);
        syncInterval = setInterval(syncBalance, 10000);
    } else {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    }
    updateTradeUI(false);
}

function resetTrade() { 
    currentTrade = null; 
    isClosingTrade = false; 
    if (tradeSocket) tradeSocket.close(); 
    localStorage.removeItem('alfa_active_trade_v35');
    updateTradeUI(false); 
}

// --- ADICIONA NO DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    loadSavedState();
    startOperationalLoop();
    startDynamicLogExposition();
    
    // Auto-Sincronização ao digitar o nome
    const nameInput = document.getElementById('slot-1-name');
    if (nameInput) {
        nameInput.addEventListener('blur', () => syncExistingProfile(nameInput.value));
    }
});

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
            addLog(`🔄 PERFIL ENCONTRADO: Carregando dados de ${name.toUpperCase()}...`, 'system');
            
            // Preenche os campos
            document.getElementById('slot-1-key').value = d.keys.key;
            document.getElementById('slot-1-secret').value = d.keys.secret;
            
            // Atualiza memória
            activeSlots[1].name = name.toUpperCase();
            activeSlots[1].key = d.keys.key;
            activeSlots[1].secret = d.keys.secret;
            
            // Recupera Lucros e Degraus
            if (d.state) {
                cycleCount = d.state.cycleCount || 0;
                staircaseIndex = d.state.staircaseIndex || 10;
                window.accumulatedPnl = d.state.accumulatedPnl || 0;
                saveGlobalState();
                
                const elCycle = document.getElementById('cycle-counter');
                if (elCycle) elCycle.textContent = `PASSO #${staircaseIndex}`;
            }
            
            syncBalance();
            addLog(`✅ Sincronização Master concluída.`, 'system');
        } else {
            addLog(`🆕 NOVO OPERADOR: Iniciando robô virgem para ${name.toUpperCase()}.`, 'system');
        }
    } catch(e) {}
}

function saveSlot(id) {
    const s = { 
        name: document.getElementById('slot-1-name').value.trim(), 
        key: document.getElementById('slot-1-key').value.trim(), 
        secret: document.getElementById('slot-1-secret').value.trim(),
        buyPercentage: activeSlots[1].buyPercentage || 100
    };
    
    if (!s.name) {
        alert("Por favor, preencha a Identificação do Operador.");
        return;
    }
    
    activeSlots[1] = { ...activeSlots[1], ...s };
    localStorage.setItem('alfa_slot_1', JSON.stringify(s));
    
    // TORNA O ROBÔ VIRGEM PARA ESTE CLIENTE:
    // Ao salvar as chaves, resetamos o lucro e o degrau para o início
    cycleCount = 0;
    staircaseIndex = 10;
    startOfDayBalance = null;
    window.accumulatedPnl = 0;
    saveGlobalState(); 
    
    // Limpa o monitor de logs para começar limpo
    const monitor = document.getElementById('log-monitor');
    if(monitor) monitor.innerHTML = '';
    
    addLog(`⚙️ Configurações autorizadas. Bot em estado virgem.`, 'system');
    
    // REGISTRA NO SERVIDOR para o Admin ver o cliente com o nome dele
    fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: s.name, email: s.name + '@cliente', experience: 'auto', whatsapp: 'N/A' })
    }).then(r => r.json()).then(data => {
        // Se já foi aprovado, NÃO mostra overlay — vai direto
        if (data.alreadyApproved) {
            addLog(`✅ Chaves autorizadas. Sistema liberado.`, 'system');
            const overlay = document.getElementById('approval-overlay');
            if (overlay) overlay.classList.remove('show');
        } else {
            addLog(`[SISTEMA] Aguardando liberação do administrador...`, 'system');
            const overlay = document.getElementById('approval-overlay');
            if (overlay) overlay.classList.add('show');
        }
    }).catch(() => {
        // Em caso de erro de rede, mostra overlay por segurança
        const overlay = document.getElementById('approval-overlay');
        if (overlay) overlay.classList.add('show');
    });
    
    syncBalance();
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
            window.currentBalance = d.totalUsdt; // Para o heartbeat
            if (!startOfDayBalance) {
                startOfDayBalance = d.totalUsdt;
                window.startOfDayBalance = d.totalUsdt;
            }
            const pnlVal = d.totalUsdt - startOfDayBalance;
            const pnlPct = (pnlVal / startOfDayBalance) * 100;
            
            const elCabBal = document.getElementById('cabinet-total-balance');
            if (elCabBal) elCabBal.innerHTML = `$ ${d.totalUsdt.toFixed(2)} <span style="font-size:1.5rem; color:var(--text-muted); font-weight:400;">USDT</span>`;
            
            const elPnl = document.getElementById('header-realtime-pnl');
            const elCabPnl = document.getElementById('cabinet-realtime-pnl');
            const elPnlBrl = document.getElementById('header-brl-pnl');

            if (elPnl) {
                const txt = `${pnlVal >= 0 ? '+' : ''}$${pnlVal.toFixed(2)} (${pnlPct.toFixed(2)}%)`;
                elPnl.textContent = txt;
                elPnl.style.color = pnlVal >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
                elPnl.classList.remove('waiting');
                
                if (elCabPnl) {
                    elCabPnl.innerHTML = `PNL HOJE: <span style="color:${pnlVal >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)'}">${txt}</span>`;
                }

                if (elPnlBrl) {
                    const brlVal = (window.accumulatedPnl || 0) * 5.50;
                    elPnlBrl.textContent = `R$ ${brlVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                    elPnlBrl.style.color = brlVal >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
                }
            }
            saveGlobalState();
        }
    } catch(e) {}
}

function saveGlobalState() { localStorage.setItem('alfa_state_v35_escalada', JSON.stringify({ cycleCount, staircaseIndex, startOfDayBalance, accumulatedPnl: window.accumulatedPnl })); }

function loadSavedState() {
    const s = JSON.parse(localStorage.getItem('alfa_state_v35_escalada') || '{}');
    cycleCount = s.cycleCount || 0;
    staircaseIndex = s.staircaseIndex !== undefined ? s.staircaseIndex : 10;
    startOfDayBalance = s.startOfDayBalance || null;
    window.startOfDayBalance = startOfDayBalance;
    window.accumulatedPnl = s.accumulatedPnl || 0;
    
    // Atualiza o contador de degraus
    const elCycle = document.getElementById('cycle-counter');
    if (elCycle) elCycle.textContent = `PASSO #${staircaseIndex}`;
    
    if (startOfDayBalance) {
        const elPnl = document.getElementById('header-realtime-pnl');
        if (elPnl) {
            elPnl.textContent = "RECUPERANDO...";
            elPnl.classList.remove('waiting');
        }
    }
    
    // Recuperar trade ativo
    const activeTrade = JSON.parse(localStorage.getItem('alfa_active_trade_v35') || 'null');
    if (activeTrade) {
        currentTrade = activeTrade;
        updateTradeUI(true);
        initPriceSocket(currentTrade.fullSymbol);
        addLog(`[SISTEMA] Trade recuperado da memória: ${currentTrade.symbol}`, 'system');
    }

    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    const pendingName = localStorage.getItem('alfa_pending_name');

    if (slot.key || pendingName) {
        document.getElementById('slot-1-name').value = slot.name || pendingName || '';
        document.getElementById('slot-1-key').value = slot.key || '';
        document.getElementById('slot-1-secret').value = slot.secret || '';
        
        // Se pegou o nome pendente, salva no slot para consistência
        if (!slot.name && pendingName) {
            slot.name = pendingName;
        }

        activeSlots[1] = { ...activeSlots[1], ...slot };
        
        // Restaurar estado do botão de percentual
        const pct = slot.buyPercentage || 100;
        document.querySelectorAll('.btn-pct').forEach(b => {
             if (b.innerText === `${pct}%`) b.classList.add('active');
             else b.classList.remove('active');
        });

        // Se temos um nome salvo, verifica aprovação IMEDIATAMENTE via heartbeat inline
        // Em vez de forçar overlay e esperar 3s pelo heartbeat normal
        if (activeSlots[1].name) {
            const overlay = document.getElementById('approval-overlay');
            // Faz um heartbeat instantâneo para saber se já está aprovado
            fetch('/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: activeSlots[1].name, state: { status: 'OFFLINE' } })
            }).then(r => r.json()).then(d => {
                if (d.isApproved === true) {
                    if (overlay) overlay.classList.remove('show');
                } else {
                    if (overlay) overlay.classList.add('show');
                }
            }).catch(() => {
                // Em caso de erro de rede, mostra overlay por segurança
                if (overlay) overlay.classList.add('show');
            });
        }

        // Se temos chaves, podemos sincronizar o saldo mesmo antes do Master Power
        syncBalance(); 
    }
}

async function fetchOrderInfo(symbol) { try { const r = await fetch(`/info-par?symbol=${symbol}`); return await r.json(); } catch(e) { return null; } }

function showProfitOverlay() {
    const o = document.getElementById('profit-overlay');
    o.classList.add('show');
    setTimeout(() => o.classList.remove('show'), 6000);
}
