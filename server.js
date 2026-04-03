const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const config = require('./config');
const storage = require('./services/storageService');
const binance = require('./services/binanceService');
const tradingService = require('./services/tradingService');

const app = express();
app.use(bodyParser.json());

// --- ROTEAMENTO AMIGÁVEL ---
app.get('/operacional', (req, res) => res.sendFile(path.join(__dirname, 'operacional.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/ADMIN', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/cadastro', (req, res) => res.sendFile(path.join(__dirname, 'cadastro.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

app.use(express.static(path.join(__dirname)));

// --- MIDDLEWARES ---
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

// --- CENTRALIZED HEARTBEAT & SYNC ---
app.post('/heartbeat', async (req, res) => {
    try {
        const { username, state, keys } = req.body;
        if (!username) return res.status(400).json({ error: "Usuário obrigatório." });

        const user = storage.getUser(username);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

        if (!user.alfaState) user.alfaState = {};
        
        if (state && typeof state.monitoring !== 'undefined') {
            user.alfaState.monitoring = state.monitoring;
        }

        if (keys && keys.key && keys.secret) {
            user.keys = { key: keys.key, secret: keys.secret };
        }

        if (user.alfaState.monitoring && user.keys && user.keys.key) {
            try {
                const balance = await binance.getAssetBalance(user.keys.key, user.keys.secret, 'USDT');
                user.alfaState.currentBalance = balance;
                user.balanceUSDT = balance;
            } catch (err) {}
        }

        user.alfaState.lastHeartbeat = Date.now();
        await storage.updateUser(username, user);

        res.json({ 
            success: true, 
            serverState: user.alfaState, 
            keys: user.keys || {},
            marketRanking: binance.globalMarket.top30 || [],
            serverUptime: process.uptime()
        });
    } catch (e) {
        console.error("[HEARTBEAT] Erro de sincronia cloud:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/save-alfa-state', async (req, res, next) => {
    req.url = '/heartbeat';
    app.handle(req, res, next);
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
        const { username } = req.body;
        const u = storage.getUser(username);
        if(!u) throw new Error("Usuário não encontrado.");
        await tradingService.panicStop(u);
        res.json({ success: true, msg: "Panic stop executado." });
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

app.post('/register', async (req, res) => {
    try {
        const { username, fullName, email, whatsapp, password } = req.body;
        if (!username || !password) throw new Error("Usuário e Senha são obrigatórios.");
        await storage.updateUser(username, { fullName, email, whatsapp, password, isApproved: false });
        res.json({ success: true, msg: "Solicitação enviada." });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = storage.getUser(username);
        if (!user) throw new Error("Usuário não encontrado.");
        if (user.password !== password) throw new Error("Senha incorreta.");
        if (!user.isApproved) throw new Error("Acesso não liberado.");
        res.json({ success: true, user: { username: user.username, keys: user.keys || {} }, token: 'ALFA-' + Date.now() });
    } catch (e) { res.status(401).json({ error: e.message }); }
});

const auth = require('./middleware/authMiddleware');

// --- ADMIN ROUTES ---
app.get('/admin/overview', auth, async (req, res) => {
    try {
        const users = storage.getUsers().map(u => {
            const state = u.alfaState || {};
            const trade = state.currentTrade || {};
            return {
                username: u.username,
                fullName: u.fullName || u.username,
                whatsapp: u.whatsapp || '---',
                email: u.email || '---',
                registrationDate: u.registrationDate || Date.now(),
                isApproved: u.isApproved,
                status: trade.symbol ? 'IN_TRADE' : (state.monitoring ? 'SCANNING' : 'OFFLINE'),
                activeSymbol: trade.symbol || '---',
                buyPrice: trade.buyPrice || 0,
                currentPrice: trade.currentPrice || 0,
                targetPrice: trade.targetPrice || (trade.buyPrice ? trade.buyPrice * 1.009 : 0),
                qty: trade.qty || 0,
                balanceUSDT: state.currentBalance || 0,
                liquidPnlPool: state.sessionProfitUsdt || 0,
                cycleCount: state.cycleCount || 0,
                password: u.password,
                lastHeartbeat: state.lastHeartbeat || 0
            };
        });
        res.json({ success: true, users, serverUptime: process.uptime(), totalLeads: users.filter(u => !u.isApproved).length });
    } catch (error) { res.status(500).json({ error: 'Erro no overview' }); }
});

app.post('/admin/approve-user', auth, async (req, res) => {
    try {
        const { targetUser } = req.body;
        await storage.updateUser(targetUser, { isApproved: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/delete-user', auth, async (req, res) => {
    try {
        const { targetUser } = req.body;
        await storage.deleteUser(targetUser);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/update-profile', auth, async (req, res) => {
    try {
        const { targetUser, fullName, email, whatsapp } = req.body;
        await storage.updateUser(targetUser, { fullName, email, whatsapp });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/set-password', auth, async (req, res) => {
    try {
        const { targetUser, newPassword } = req.body;
        await storage.updateUser(targetUser, { password: newPassword });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/stop-user', auth, async (req, res) => {
    try {
        const { targetUser } = req.body;
        await storage.updateUser(targetUser, { panicPending: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ERROR MIDDLEWARE
app.use((err, req, res, next) => {
    console.error(`[ERR] ${req.path}:`, err.message);
    res.status(500).json({ success: false, error: err.message });
});

// GRACEFUL SHUTDOWN
const gracefulShutdown = async (signal) => {
    await storage.saveUsers();
    process.exit(0);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// START
async function startServer() {
    await storage.init(); 
    const PORT = config.PORT || process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`[MASTER SERVER] SIFRAS ALFA v6.1.2 ON PORT ${PORT}`);
        binance.startGlobalWS();
        tradingService.init();
    });
}
startServer().catch(e => console.error(e));
