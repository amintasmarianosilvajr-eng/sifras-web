const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const config = require('./config');
const storage = require('./services/storageService');
const binance = require('./services/binanceService');
const tradingService = require('./services/tradingService');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// --- MIDDLEWARES ---
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

// --- CORE ROUTES ---

app.post('/get-alfa-state', async (req, res) => {
    try {
        const { username } = req.body;
        if(!username) return res.json({ found: false });
        
        const user = storage.getUser(username);
        if(user) {
            res.json({ 
                found: true, 
                state: user.alfaState || {}, 
                keys: user.keys || {},
                marketRanking: binance.globalMarket.top30 || []
            });
        } else {
            res.json({ found: false });
        }
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/save-alfa-state', async (req, res) => {
    try {
        const { username, state, keys } = req.body;
        await storage.updateUser(username, { alfaState: state, keys: keys || undefined });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/heartbeat', async (req, res, next) => {
    try {
        const { username, state, keys } = req.body;
        if (!username) throw new Error("Missing username");
        
        const existing = storage.getUser(username);
        const serverState = (existing && existing.alfaState) ? existing.alfaState : {};
        
        let finalTrade = state.currentTrade;
        if(!finalTrade && serverState.currentTrade && serverState.currentTrade.symbol) {
             finalTrade = serverState.currentTrade;
        }

        const user = await storage.updateUser(username, { 
            alfaState: { ...state, currentTrade: finalTrade },
            keys: keys && keys.key ? keys : (existing ? existing.keys : undefined),
            status: finalTrade ? 'IN_TRADE' : (state.monitoring ? 'SCANNING' : 'OFFLINE'),
            activeSymbol: finalTrade ? finalTrade.symbol : '---',
            balanceUSDT: state.currentBalance || (existing ? existing.balanceUSDT : 0),
            lastUpdated: Date.now()
        });

        res.json({ 
            success: true, 
            serverState: user.alfaState, 
            keys: user.keys,
            marketRanking: binance.globalMarket.top30 || [],
            command: (user.panicPending) ? 'STOP' : 'OK'
        });
        
        if(user.panicPending) {
             await storage.updateUser(username, { panicPending: false });
        }
    } catch (e) { next(e); }
});

app.post('/pnl-real', async (req, res, next) => {
    try {
        const { key, secret } = req.body;
        const totalUsdt = await binance.getAssetBalance(key, secret, 'USDT');
        res.json({ totalUsdt });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/moedas-ranking', (req, res) => {
    res.json({ ranking: binance.globalMarket.top30 || [] });
});

app.post('/executar-ordem', async (req, res) => {
    try {
        const { key, secret, symbol, side, qty } = req.body;
        const result = await binance.executeOrder(key, secret, symbol, side, qty);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/panic', async (req, res) => {
    try {
        const { key, secret, symbol, username } = req.body;
        const result = await binance.executeOrder(key, secret, symbol, 'SELL');
        if(username) {
             const u = storage.getUser(username);
             if(u && u.alfaState) {
                  u.alfaState.currentTrade = null;
                  u.alfaState.monitoring = false;
                  await storage.updateUser(username, { alfaState: u.alfaState });
             }
        }
        res.json({ success: true, msg: "Panic stop executado via Binance." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/agent/clear-ghost', async (req, res) => {
    try {
        const { username } = req.body;
        const u = storage.getUser(username);
        if(u && u.alfaState) {
            u.alfaState.currentTrade = null;
            await storage.updateUser(username, { alfaState: u.alfaState });
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// START SEQUENCE (HEALING)
async function startServer() {
    console.log("[MASTER] Inicializando banco de dados local...");
    await storage.init(); 
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`[MASTER SERVER] SIFRAS ALFA v6.1.2 rodando na porta ${PORT}`);
        binance.startGlobalWS();
        tradingService.init();
    });
}

startServer().catch(e => {
    console.error("[CRITICAL] Falha na inicialização do servidor:", e);
});
