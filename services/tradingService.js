const binance = require('./binanceService');
const storage = require('./storageService');
const config = require('../config');

class TradingService {
    constructor() {
        this.isProcessing = false;
        this.loopInterval = null;
    }

    async init() {
        console.log(`\n=================================================`);
        console.log(`[ENGINE-V2] MOTOR DEFINITIVO: INICIANDO...`);
        
        // Loop de alta frequência (1s) para monitoramento de Trailing Stop
        if (this.loopInterval) clearInterval(this.loopInterval);
        this.loopInterval = setInterval(() => this.processAllUsers(), 1000);
        
        console.log(`[ENGINE-V2] STATUS: OPERAÇÃO ATIVA (1000ms).`);
        console.log(`=================================================\n`);
    }

    async processAllUsers() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        
        try {
            const users = storage.getUsers();
            // Apenas usuários online e com monitoramento ligado no painel
            const activeUsers = users.filter(u => u.alfaState && u.alfaState.monitoring && u.keys && u.keys.key);
            
            for (const user of activeUsers) {
                try {
                    await this.processUserTradeLogic(user);
                } catch (userErr) {
                    console.error(`[ENGINE] Erro no usuário ${user.username}:`, userErr.message);
                }
            }
        } catch (e) {
            console.error("[ENGINE] Erro no loop global:", e.message);
        } finally {
            this.isProcessing = false;
        }
    }

    async processUserTradeLogic(user) {
        const state = user.alfaState;

        // 1. MONITORAMENTO DE TRADE ATIVO
        if (state.currentTrade) {
            await this.monitorActiveTrade(user);
        } 
        // 2. SCANNER DE COMPRA (APENAS SE NÃO ESTIVER EM COOLDOWN)
        else {
            const isCooldown = state.cooldownUntil && Date.now() < state.cooldownUntil;
            if (!isCooldown) {
                await this.runSniperScan(user);
            }
        }
    }

    async monitorActiveTrade(user) {
        const state = user.alfaState;
        const trade = state.currentTrade;
        if (!trade) return;

        try {
            // Busca preço atual (Cache global ou API)
            let currentPrice = 0;
            const rankingMatch = binance.globalMarket.top30.find(m => m.symbol === trade.fullSymbol);
            if (rankingMatch) {
                currentPrice = rankingMatch.price;
            } else {
                currentPrice = await binance.getTickerPrice(trade.fullSymbol);
            }

            if (!currentPrice) return;

            // --- LÓGICA DE TRAILING E STOP ---
            const pnl = ((currentPrice - trade.buyPrice) / trade.buyPrice) * 100;
            
            // 🎯 GATILHO DE ALVO (0.9%)
            const TARGET_PROFIT = 0.9;
            const STOP_LOSS = -2.5;
            const TRAILING_PULLBACK = 0.1; // Se cair 0.1% do pico após atingir o alvo, vende.

            // Atualiza o pico de lucro (High Water Mark)
            trade.maxPnl = Math.max(trade.maxPnl || pnl, pnl);
            trade.currentPrice = currentPrice;
            trade.currentPnl = pnl;

            // A. VERIFICA STOP LOSS (Proteção de Banca)
            if (pnl <= STOP_LOSS) {
                console.log(`[STOP-LOSS] 🚨 ${user.username}: Protegendo banca. Liquidando ${trade.symbol} em ${pnl.toFixed(2)}%`);
                await this.executeBackendSell(user, "STOP_LOSS");
                return;
            }

            // B. VERIFICA TRAILING PROFIT (Garantia de Lucro)
            // Só entra aqui se o lucro for POSITIVO e já tiver batido o alvo
            if (trade.maxPnl >= TARGET_PROFIT) {
                if ((trade.maxPnl - pnl) >= TRAILING_PULLBACK) {
                    console.log(`[TRAILING] 🚀 ${user.username}: Realizando lucro. Pico: ${trade.maxPnl.toFixed(2)}% | Atual: ${pnl.toFixed(2)}%`);
                    await this.executeBackendSell(user, "PROFIT_TRAILING");
                    return;
                }
            } else {
                // LOCK DE SEGURANÇA: Se o lucro ainda não bateu o alvo E o PNL é negativo (mas acima do Stop Loss),
                // o robô é PROIBIDO de vender. Ele deve aguardar a recuperação ou o Stop Loss.
                if (pnl < 0) {
                    // Log silencioso para monitoramento
                    return; 
                }
            }

            // C. PROTEÇÃO ANTI-FANTASMA (Sincronia a cada 10s)
            if (Date.now() % 10000 < 1000) {
                const balance = await binance.getAssetBalance(user.keys.key, user.keys.secret, trade.symbol.replace('USDT', ''));
                if (balance <= 0) {
                    console.warn(`[SYNC] ${user.username}: Moeda ${trade.symbol} não encontrada na carteira. Resetando.`);
                    this.clearUserTrade(user);
                }
            }

            // Atualiza o estado no storage (isDirty) para o frontend ver o PNL
            await storage.updateUser(user.username, { alfaState: state });

        } catch (e) {
            console.error(`[MONITOR] Erro ${user.username}:`, e.message);
        }
    }

    async runSniperScan(user) {
        const state = user.alfaState;
        const ranking = binance.globalMarket.top30;
        if (!ranking || ranking.length < 5) return;

        // Regra: Não repetir as últimas 2 moedas
        const history = state.tradeHistory || [];
        const blacklisted = history.slice(0, 2).map(h => h.fullSymbol);

        // Algoritmo Sniper: Busca moedas com volume > 1M e subida consistente
        // Filtra as Top 15 (excluindo a #1 que pode ser muito volátil ou spike falso)
        const candidates = ranking.slice(1, 15).filter(c => !blacklisted.includes(c.symbol) && !(config.BLACKLIST || []).includes(c.symbol.replace('USDT', '')));

        if (!state.isAnalyzing) {
            state.volBuffer = {};
            candidates.forEach(c => { state.volBuffer[c.symbol] = c.price; });
            state.analysisStartTime = Date.now();
            state.isAnalyzing = true;
            return;
        }

        // Janela de análise de 10 segundos para confirmar explosão real
        if (Date.now() - state.analysisStartTime >= 10000) {
            let bestCoin = null;
            let highestDelta = 0;

            candidates.forEach(c => {
                const initial = state.volBuffer[c.symbol];
                if (initial) {
                    const delta = ((c.price - initial) / initial) * 100;
                    if (delta > highestDelta) {
                        highestDelta = delta;
                        bestCoin = c;
                    }
                }
            });

            // TRIGGER: Mínimo 0.12% em 10s para confirmar entrada agressiva
            if (bestCoin && highestDelta >= 0.12) {
                console.log(`[SCANNER] ⚡ Explosão Confirmada: ${bestCoin.symbol} +${highestDelta.toFixed(2)}% em 10s.`);
                await this.executeBackendBuy(user, bestCoin);
            }
            
            state.isAnalyzing = false;
            await storage.updateUser(user.username, { alfaState: state });
        }
    }

    async executeBackendBuy(user, coin) {
        try {
            console.log(`[BUY] 🛒 ${user.username}: Comprando ${coin.symbol}...`);
            const result = await binance.executeOrder(user.keys.key, user.keys.secret, coin.symbol, 'BUY');
            
            if (result.orderId) {
                const filledPrice = result.fills && result.fills.length > 0 ? parseFloat(result.fills[0].price) : coin.price;
                const filledQty = parseFloat(result.executedQty);

                user.alfaState.currentTrade = {
                    symbol: coin.symbol.replace('USDT', ''),
                    fullSymbol: coin.symbol,
                    buyPrice: filledPrice,
                    targetPrice: filledPrice * 1.009, // 0.9% de lucro alvo
                    qty: filledQty,
                    buyTime: Date.now(),
                    maxPnl: 0,
                    currentPnl: 0
                };
                
                await storage.updateUser(user.username, { 
                    alfaState: user.alfaState,
                    status: 'IN_TRADE',
                    activeSymbol: coin.symbol
                });
                await storage.saveUsers(true); // Força gravação imediata do trade
                console.log(`[BUY] ✅ SUCESSO: ${coin.symbol} @ ${filledPrice}`);
            }
        } catch (e) {
            console.error(`[BUY-ERROR] ${user.username}:`, e.message);
        }
    }

    async executeBackendSell(user, reason) {
        const state = user.alfaState;
        const trade = state.currentTrade;
        if (!trade) return;

        try {
            console.log(`[SELL] 📤 ${user.username}: Vendendo ${trade.symbol} (Motivo: ${reason})`);
            const result = await binance.executeOrder(user.keys.key, user.keys.secret, trade.fullSymbol, 'SELL', trade.qty);
            
            if (result.orderId) {
                const sellPrice = result.fills && result.fills.length > 0 ? parseFloat(result.fills[0].price) : trade.currentPrice;
                const profit = ((sellPrice - trade.buyPrice) / trade.buyPrice) * 100;

                // Salva no histórico
                state.tradeHistory = state.tradeHistory || [];
                state.tradeHistory.unshift({
                    symbol: trade.symbol,
                    buyPrice: trade.buyPrice,
                    sellPrice: sellPrice,
                    pnl: profit,
                    time: Date.now(),
                    reason: reason
                });
                if (state.tradeHistory.length > 30) state.tradeHistory.pop();

                state.cycleCount = (state.cycleCount || 0) + 1;
                state.currentTrade = null;

                // --- REGRA DE SEGURANÇA: COOLDOWN A CADA 3 TRADES ---
                if (state.cycleCount % 3 === 0) {
                    state.cooldownUntil = Date.now() + (15 * 60 * 1000); // 15 Minutos de descanso
                    console.log(`[COOLDOWN] 🕒 ${user.username}: Pausa de 15 min ativada.`);
                }

                await storage.updateUser(user.username, { 
                    alfaState: state,
                    status: 'SCANNING',
                    activeSymbol: '---'
                });
                await storage.saveUsers(true); // Força gravação do lucro
                console.log(`[SELL] ✅ SUCESSO: PNL Final ${profit.toFixed(2)}%`);
            }
        } catch (e) {
            console.error(`[SELL-ERROR] ${user.username}:`, e.message);
            if (e.message.includes('Account has insufficient balance')) {
                console.warn(`[SELL-FAIL] Saldo insuficiente para vender. Limpando trade fantasma.`);
                this.clearUserTrade(user);
            }
        }
    }

    async clearUserTrade(user) {
        user.alfaState.currentTrade = null;
        await storage.updateUser(user.username, { alfaState: user.alfaState });
        await storage.saveUsers(true);
    }

    async panicStop(user) {
        if (user.alfaState.currentTrade) {
            await this.executeBackendSell(user, "PANIC_STOP");
        }
        user.alfaState.monitoring = false;
        await storage.updateUser(user.username, { alfaState: user.alfaState });
        await storage.saveUsers(true);
    }
}

module.exports = new TradingService();
