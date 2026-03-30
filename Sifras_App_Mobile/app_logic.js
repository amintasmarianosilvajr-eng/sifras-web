/**
 * Sifras Alfa Mobile App - Lógica de Simulação de UX
 * Focado no toque, micro-animações e feedback visual premium.
 */

document.addEventListener('DOMContentLoaded', () => {
    
    // --- TRANSIÇÃO DA SPLASH SCREEN ---
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        const main = document.getElementById('main-app');
        
        splash.style.opacity = '0';
        setTimeout(() => {
            splash.classList.add('hidden');
            main.classList.remove('hidden');
            // Animação de entrada dos elementos
            main.style.animation = 'fadeIn 0.8s ease-out';
            
            // Iniciar simulações visuais após o app carregar
            startVisualSimulation();
        }, 800);
    }, 2500); // 2.5s de tela de loading premium

    // --- INTERAÇÕES DE BOTÕES ---
    const toggleMotorBtn = document.getElementById('toggle-motor-btn');
    const panicBtn = document.getElementById('panic-btn');
    const motorDot = document.getElementById('motor-status-dot');
    const motorText = document.getElementById('motor-status-text');

    let motorLigado = false;

    // Ligar/Desligar Motor (Feedback Tátil Simulado)
    toggleMotorBtn.addEventListener('click', () => {
        motorLigado = !motorLigado;
        
        if (motorLigado) {
            toggleMotorBtn.classList.add('active');
            toggleMotorBtn.querySelector('span').innerText = 'Desconectar';
            motorDot.classList.replace('offline', 'online');
            motorText.innerText = 'Motor Scanning';
            motorText.style.color = 'var(--gold-primary)';
        } else {
            toggleMotorBtn.classList.remove('active');
            toggleMotorBtn.querySelector('span').innerText = 'Ligar Motor';
            motorDot.classList.replace('online', 'offline');
            motorText.innerText = 'Motor Offline';
            motorText.style.color = '';
            
            // Força a esconder o trade simulado
            document.getElementById('no-trade-area').classList.remove('hidden');
            document.getElementById('active-trade-area').classList.add('hidden');
        }

        // Tenta vibrar o celular (Haptic Feedback se suportado)
        if (navigator.vibrate) navigator.vibrate(50);
    });

    // Panic Button
    panicBtn.addEventListener('click', () => {
        if (!motorLigado) return alert('O Motor já está desligado.');
        
        const confirmar = confirm("🔥 MODO PANIC: Deseja liquidar as posições ativas imediatamente?");
        if (confirmar) {
            panicBtn.style.transform = 'scale(0.9)';
            setTimeout(() => panicBtn.style.transform = 'scale(1)', 150);
            
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]); // Vibração de alerta duplo
            
            alert('POSIÇÕES LIQUIDADAS COM SUCESSO A MERCADO.');
            
            // Desliga motor
            toggleMotorBtn.click();
        }
    });
});

// --- SIMULAÇÃO VISUAL DE DADOS E NÚMEROS (Efeito Requinte) ---
function startVisualSimulation() {
    const balanceEl = document.getElementById('total-balance');
    const profitEl = document.getElementById('session-profit');
    
    // Simula um loading inicial subindo o saldo rapidamente (Efeito Hodômetro)
    let currentBalance = 0;
    const targetBalance = 5420.75;
    
    const balanceInterval = setInterval(() => {
        currentBalance += 150.5;
        if (currentBalance >= targetBalance) {
            currentBalance = targetBalance;
            clearInterval(balanceInterval);
            
            // Depois que o saldo carrega, inicia a simulação de trade
            setInterval(simulateTradeStatus, 5000); 
        }
        balanceEl.innerText = `$ ${currentBalance.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    }, 20);

    // Simula lucros variando
    setInterval(() => {
        const randomProfit = (Math.random() * 5 + 12).toFixed(2);
        profitEl.innerText = `+$${randomProfit} (Hoje)`;
    }, 10000);
}

// Simula a transição entre "Escaneando" e "Entrou num Trade"
function simulateTradeStatus() {
    const isOnline = document.getElementById('motor-status-dot').classList.contains('online');
    if (!isOnline) return;

    const noTradeArea = document.getElementById('no-trade-area');
    const activeTradeArea = document.getElementById('active-trade-area');

    // Sorteia 30% de chance de entrar ou sair de um trade simulado
    const isTradingNow = !activeTradeArea.classList.contains('hidden');
    
    if (Math.random() > 0.7) {
        if (isTradingNow) {
            // Finge que vendeu e lucrou
            noTradeArea.classList.remove('hidden');
            activeTradeArea.classList.add('hidden');
        } else {
            // Finge que comprou
            noTradeArea.classList.add('hidden');
            activeTradeArea.classList.remove('hidden');
            
            // Sorteia moeda e preço
            const cryptos = ['BTC', 'ETH', 'SOL', 'INJ', 'LINK'];
            const sortedCoin = cryptos[Math.floor(Math.random() * cryptos.length)];
            const simPrice = (Math.random() * 500 + 20).toFixed(4);
            const simTarget = (simPrice * 1.008).toFixed(4);

            document.getElementById('trade-symbol').innerText = `${sortedCoin}/USDT`;
            document.getElementById('trade-entry').innerText = `$${simPrice}`;
            document.getElementById('trade-target').innerText = `$${simTarget}`;
            
            updateSimulatedPrice(simPrice, simTarget);
        }
    } else if (isTradingNow) {
        // Atualiza preço simulado
        const entry = parseFloat(document.getElementById('trade-entry').innerText.replace('$', ''));
        const target = parseFloat(document.getElementById('trade-target').innerText.replace('$', ''));
        updateSimulatedPrice(entry, target);
    }
}

function updateSimulatedPrice(entryPrice, targetPrice) {
    // Oscila o preço atual levemente
    const variance = (Math.random() - 0.2) * 0.005 * entryPrice; // Tende um pouco pra cima
    const currentPrice = entryPrice + variance;
    
    const percentage = ((currentPrice - entryPrice) / entryPrice) * 100;
    const progress = Math.max(0, Math.min(100, (percentage / 0.8) * 100)); // Considera 0.8% o alvo

    const plBadge = document.getElementById('trade-pl');
    plBadge.innerText = `${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%`;
    plBadge.style.color = percentage >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    plBadge.style.background = percentage >= 0 ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 59, 48, 0.15)';

    document.getElementById('trade-progress').style.width = `${progress}%`;
}
