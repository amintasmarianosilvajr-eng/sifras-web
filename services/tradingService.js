const binance = require('./binanceService');
const storage = require('./storageService');
const config = require('../config');

class TradingService {
    constructor() {
        this.activeUsers = {};
        this.isProcessing = false;
    }

    async init() {
        console.log(`\n=================================================`);
        console.log(`[ENGINE] MOTOR ÔMEGA-3: INICIANDO AUTO-CURA...`);
        
        // Processamento Imediato na Partida (Self-Healing)
        await this.processAllUsers();
        
        // Ciclo agressivo de 3 segundos para monitoramento contínuo
        setInterval(() => this.processAllUsers(), 1000);
        
        console.log(`[ENGINE] MOTOR ÔMEGA-3: OPERAÇÃO 24H ATIVA (3s).`);
        console.log(`=================================================\n`);
    }

    async processAllUsers() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        const startTime = Date.now();
        
        try {
            const users = storage.getUsers();
            const activeUsers = users.filter(u => u.alfaState && u.alfaState.monitoring);
            
            if (activeUsers.length === 0) return;

            // Processamento em Paralelo Controlado para escala
            await Promise.all(activeUsers.map(async (user) => {
                try {
                    await this.processUserTradeLogic(user);
                } catch (userErr) {
                    console.error(`[ENGINE] Falha crítica no usuário ${user.username}:`, userErr.message);
                }
            }));

        } catch (e) {
            console.error("[ENGINE] Erro fatal no loop global:", e.message);
        } finally {
            const duration = Date.now() - startTime;
            if (duration > 2000) console.warn(`[ENGINE] Ciclo lento detectado: ${duration}ms`);
            this.isProcessing = false;
        }
    }

    async processUserTradeLogic(user) {
        try {
            if (user.alfaState.currentTrade) {
                await this.monitorActiveTrade(user);
            } else {
                await this.runSniperScan(user, user.alfaState);
            }
        } catch (e) {
            console.error(`[TRADING-ENGINE] Erro no usuário ${user.username}:`, e.message);
        }
    }

    async monitorActiveTrade(user) {
        const trade = user.alfaState.currentTrade;
        if (!trade) return;

        try {
            // 1. Busca Preço Real Diretamente (Ignora caches)
            const currentPrice = await binance.getTickerPrice(trade.fullSymbol);
            if (!currentPrice) return;

            // --- META ÔMEGA-3: SEMPRE 0.9% (ATUALIZADO CICLO 9) ---
            const targetPrice = trade.buyPrice * 1.009;

            if (currentPrice >= targetPrice) {
                console.log(`[TARGET] Alvo de 0.8% atingido em ${trade.symbol} para ${user.username}. Liquidando...`);
                await this.executeBackendSell(user);
                return;
            }

            // --- SINCRONIA BINANCE (ANTI-FANTASMA) ---
            // Se o monitor ainda rodar após 5 segundos do trade iniciado, verifica se a moeda ainda existe na Binance
            if (Date.now() - (trade.buyTime || 0) > 5000) {
                const balance = await binance.getAssetBalance(user.keys.key, user.keys.secret, trade.symbol.replace('USDT', ''));
                if (balance <= 0) {
                    console.warn(`[SYNC] ${trade.symbol} não encontrado na Binance. Limpando Ghost Trade.`);
                    this.clearUserTrade(user);
                }
            }
        } catch (e) {
            console.error(`[MONITOR-ERROR] ${user.username}:`, e.message);
        }
    }

    async executeBackendSell(user) {
        const trade = user.alfaState.currentTrade;
        if (!trade) return;

        try {
            // 1. Inicializar QUANTIDADE COM FALLBACK DE SEGURANÇA
            let qtyToSell = trade.qty || 0;
            const asset = trade.symbol.replace('USDT', '');

            if (qtyToSell <= 0) {
                console.warn(`[SELL] Quantidade zero detectada para ${trade.symbol}. Consultando carteira Binance...`);
                const realBalance = await binance.getAssetBalance(user.keys.key, user.keys.secret, asset);
                if (realBalance > 0) {
                    qtyToSell = realBalance;
                    trade.qty = realBalance;
                } else {
                    console.error(`[SELL] Nenhum saldo de ${asset} na Binance. Trade fantasma limpo.`);
                    this.clearUserTrade(user);
                    return;
                }
            }

            // 2. APLICAR FILTRO DE LOTE (PREVENIR ERRO DE "LOT_SIZE")
            const info = await binance.getSymbolInfo(trade.symbol);
            if (info && info.filters) {
                const lot = info.filters.find(f => f.filterType === 'LOT_SIZE');
                if (lot) {
                    const stepSize = parseFloat(lot.stepSize);
                    qtyToSell = (Math.floor(qtyToSell / stepSize) * stepSize).toFixed(8).replace(/\.?0+$/, "");
                }
            }

            console.log(`[SELL] Executando venda a mercado: ${trade.symbol} | Qty: ${qtyToSell}`);
            const result = await binance.executeOrder(user.keys.key, user.keys.secret, trade.symbol, 'SELL', qtyToSell);
            
            if (result.orderId) {
                console.log(`[SELL] ✅ VENDA CONCLUÍDA: ${trade.symbol}.`);
                await this.finalizeTrade(user, result);
            }
        } catch (e) {
            console.error(`[SELL-ERROR] ${user.username}:`, e.message);
            // Se der erro de "insufficient balance", limpa o trade para não travar
            if (e.message.includes('Account has insufficient balance')) {
                this.clearUserTrade(user);
            }
        }
    }

    async finalizeTrade(user, result) {
        // --- ÔMEGA-3: FINALIZAÇÃO ATÔMICA ---
        console.log(`[FINALIZE] Limpando estado de trade para ${user.username}...`);
        
        const trade = user.alfaState.currentTrade;
        if (!trade) return;

        const historyEntry = {
            symbol: trade.symbol,
            fullSymbol: trade.fullSymbol,
            buyPrice: trade.buyPrice,
            sellPrice: result.price || trade.buyPrice * 1.009,
            qty: trade.qty,
            time: Date.now()
        };

        // Mutação imediata em memória para o ciclo de 1s não pegar o trade velho
        user.alfaState.tradeHistory = user.alfaState.tradeHistory || [];
        user.alfaState.tradeHistory.unshift(historyEntry);
        if (user.alfaState.tradeHistory.length > 20) user.alfaState.tradeHistory.pop();
        
        user.alfaState.currentTrade = null;
        user.alfaState.tradeStartTime = null;
        user.alfaState.cycleCount = (user.alfaState.cycleCount || 0) + 1;
        
        // --- REGRA DO NONO CICLO: 20 MINUTOS A CADA 3 TRADES ---
        if (user.alfaState.cycleCount % 3 === 0) {
            user.alfaState.cooldownUntil = Date.now() + (20 * 60 * 1000); // 20 Minutos
            console.log(`[CYCLE] 🎯 Ciclo de 3 operações concluído para ${user.username}. Iniciando intervalo de 20 minutos.`);
        }

        user.alfaState.monitoring = true; 

        // Persistência forçada com clone limpo
        const updatedAlfaState = JSON.parse(JSON.stringify(user.alfaState));
        await storage.updateUser(user.username, { alfaState: updatedAlfaState });
        console.log(`[FINALIZE] ✅ Sistema pronto para Recompra (Loop Snipe Ativo).`);
    }

    async clearUserTrade(user) {
        const state = user.alfaState;
        state.currentTrade = null;
        state.tradeStartTime = null;
        await storage.updateUser(user.username, { alfaState: state });
    }

    async runSniperScan(user, state) {
        // --- VERIFICAÇÃO DE INTERVALO DE CICLO (20 MIN) ---
        if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
            const remaining = Math.ceil((state.cooldownUntil - Date.now()) / 60000);
            if (Date.now() % 60000 < 2000) { // Log a cada minuto aproximadamente
                console.log(`[COOLDOWN] ${user.username}: Aguardando intervalo de ciclo operacional (${remaining} min restantes).`);
            }
            return;
        }

        const ranking = binance.globalMarket.top30;
        if (!ranking || ranking.length < 10) return;

        // REGRA DE OURO: Não repete as últimas 3 moedas do histórico
        const last3Symbols = (state.tradeHistory || []).slice(0, 3).map(h => h.fullSymbol || h.symbol);
        
        const candidates = ranking.slice(1, 15).filter(c => 
            !last3Symbols.includes(c.symbol) &&
            !(config.BLACKLIST || []).includes(c.symbol) &&
            !ranking[0].symbol.includes(c.symbol) // Pula o Top 1 se já estiver operando ele
        );

        if (!state.isAnalyzing) {
            state.volBuffer = {};
            candidates.forEach(c => { state.volBuffer[c.symbol] = c.price; });
            state.analysisStartTime = Date.now();
            state.isAnalyzing = true;
            return;
        }

        if (Date.now() - state.analysisStartTime >= 10000) {
            let bestCoin = null;
            let highestDelta = 0;

            candidates.forEach(c => {
                const init = state.volBuffer[c.symbol];
                if (init) {
                    const d = ((c.price - init) / init) * 100;
                    if (d > highestDelta) { highestDelta = d; bestCoin = c; }
                }
            });

            if (bestCoin && highestDelta >= 0.1) {
                console.log(`[SCANNER] Explosão: ${bestCoin.symbol} +${highestDelta.toFixed(2)}%!`);
                await this.executeBackendBuy(user, bestCoin);
            }
            state.isAnalyzing = false;
        }
    }

    async executeBackendBuy(user, coin) {
        try {
            console.log(`[BUY] Comprando ${coin.symbol} para ${user.username}...`);
            const result = await binance.executeOrder(user.keys.key, user.keys.secret, coin.symbol, 'BUY');
            
            if (result.orderId) {
                const state = user.alfaState;
                state.currentTrade = {
                    symbol: coin.symbol,
                    fullSymbol: coin.symbol,
                    buyPrice: parseFloat(result.fills[0].price),
                    qty: parseFloat(result.executedQty),
                    startTime: Date.now()
                };
                state.tradeStartTime = Date.now();
                await storage.updateUser(user.username, { alfaState: state });
                console.log(`[BUY] ✅ COMPRA CONCLUÍDA: ${coin.symbol} | Qty: ${state.currentTrade.qty}`);
            }
        } catch (e) {
            console.error(`[BUY-ERROR] ${user.username}:`, e.message);
        }
    }

    async panicStop(user) {
        console.warn(`[PANIC] Executando Parada de Emergência para ${user.username}...`);
        
        try {
            const trade = user.alfaState.currentTrade;
            if (trade) {
                console.log(`[PANIC] Liquidando ${trade.symbol} a mercado...`);
                await binance.executeOrder(user.keys.key, user.keys.secret, trade.symbol, 'SELL');
            }
        } catch (e) {
            console.error(`[PANIC-ERROR] Erro na liquidação Binance:`, e.message);
        }

        // Deep Wipe
        user.alfaState.currentTrade = null;
        user.alfaState.tradeStartTime = null;
        user.alfaState.monitoring = false; // DESLIGA O MOTOR MASTER
        user.alfaState.isAnalyzing = false;
        
        const updatedAlfaState = JSON.parse(JSON.stringify(user.alfaState));
        await storage.updateUser(user.username, { 
            alfaState: updatedAlfaState,
            status: 'OFFLINE',
            lastPanicTime: Date.now()
        });
        
        console.log(`[PANIC] ✅ Sistema em STANDBY para ${user.username}.`);
    }
}

module.exports = new TradingService();
