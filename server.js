const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const storage = require('./services/storageService');
const binance = require('./services/binanceService');
const authMiddleware = require('./middleware/authMiddleware');
const errorMiddleware = require('./middleware/errorMiddleware');

const app = express();

// --- SEGURANÇA & PERFORMANCE ---
app.use(helmet({ contentSecurityPolicy: false })); // CSP off for simplicity with CDN scripts
app.use(compression());
app.use(express.json());
app.use(cors());

// Limitador de requisições para rotas sensíveis
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100, // 100 requisições por IP a cada 15 min
    message: { error: "Muitas tentativas. Tente novamente em 15 minutos." }
});

// --- INICIALIZAÇÃO ---
(async () => {
    await storage.init();
    binance.startGlobalWS();
})();

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, './')));
app.use('/app', express.static(path.join(__dirname, 'Sifras_App_Mobile')));

// --- BOT SYNC ROUTES ---

app.post('/heartbeat', async (req, res, next) => {
    try {
        const { username, state, keys } = req.body;
        if (!username) throw new Error("Username missing");

        const user = await storage.updateUser(username, {
            status: state.status || 'OFFLINE',
            activeSymbol: state.activeSymbol || '---',
            balanceUSDT: state.balanceUSDT || 0,
            keys: keys || undefined
        });

        const command = user.remoteCommand || 'KEEP_ALIVE';
        if (user.remoteCommand) {
            user.remoteCommand = null;
            await storage.saveUsers();
        }

        res.json({ command, isApproved: user.isApproved });
    } catch (e) { next(e); }
});

// --- AUTH & REGISTRATION ROUTES ---

app.post('/register', async (req, res, next) => {
    try {
        const { fullName, email, whatsapp, username, password } = req.body;
        if (!username || !password) throw new Error("Usuário e Senha são obrigatórios");
        
        const existing = storage.getUser(username);
        if (existing) throw new Error("Usuário já cadastrado");

        await storage.updateUser(username, {
            fullName,
            email,
            whatsapp,
            password,
            isApproved: false // Sempre pendente no início
        });

        res.json({ success: true, msg: "Cadastro realizado com sucesso! Aguarde a aprovação do administrador." });
    } catch (e) { next(e); }
});

app.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;
        const user = storage.getUser(username);

        if (!user || user.password !== password) {
            throw new Error("Usuário ou Senha incorretos");
        }

        if (!user.isApproved) {
            return res.json({ success: false, pending: true, msg: "Sua conta aguarda aprovação do administrador." });
        }

        res.json({ success: true, user: { username: user.username, keys: user.keys || null } });
    } catch (e) { next(e); }
});

app.post('/sync-profile', (req, res) => {
    const user = storage.getUser(req.body.username);
    if (user) {
        res.json({ found: true, isApproved: user.isApproved, keys: user.keys || { key: '', secret: '' } });
    } else res.json({ found: false });
});

// --- ALFA STATE SYNC (CLOUD PERSISTENCE) ---

app.post('/get-alfa-state', (req, res) => {
    const user = storage.getUser(req.body.username);
    if (user) {
        res.json({ state: user.alfaState || {} });
    } else {
        res.json({ state: {} });
    }
});

app.post('/save-alfa-state', async (req, res, next) => {
    try {
        const { username, state } = req.body;
        if (!username) throw new Error("Missing username");
        
        let status = 'OFFLINE';
        if (state.monitoring) {
             status = state.currentTrade ? 'IN_TRADE' : 'SEARCHING';
        }
        
        await storage.updateUser(username, { 
            alfaState: state,
            status: status,
            activeSymbol: state.currentTrade ? state.currentTrade.symbol : '---',
            balanceUSDT: state.currentBalance || 0,
            buyPrice: state.currentTrade ? state.currentTrade.buyPrice : 0,
            currentPrice: state.currentPrice || 0,
            targetPrice: state.currentTrade ? state.currentTrade.buyPrice * (1 + 0.008) : 0,
            liquidPnlPool: state.sessionProfitUsdt || 0,
            staircaseIndex: state.cycleCount || 0,
            keys: req.body.keys || undefined
        });
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/pnl-real', async (req, res, next) => {
    try {
        const { key, secret, activeSymbol } = req.body;
        const totalUsdt = await binance.getBalance(key, secret);
        
        let activeAssetQty = 0;
        if (activeSymbol) {
             const baseAsset = activeSymbol.replace('USDT', '');
             activeAssetQty = await binance.getAssetBalance(key, secret, baseAsset);
        }
        
        res.json({ totalUsdt, activeAssetQty });
    } catch (e) { next(e); }
});

// --- TRADING ROUTES ---

app.post('/executar-ordem', async (req, res, next) => {
    try {
        const { key, secret, symbol, side, qty } = req.body;
        const result = await binance.executeOrder(key, secret, symbol, side, qty);
        res.json(result);
    } catch (e) { 
        res.status(500).json({ error: e.response?.data?.msg || e.message });
    }
});

app.post('/panic', async (req, res, next) => {
    try {
        const { key, secret, symbol } = req.body;
        if (symbol) {
            try {
                // Liquida a mercado o saldo da moeda ativa
                await binance.executeOrder(key, secret, symbol, 'SELL');
            } catch (e) {
                console.log("[PANIC] Falha na liquidação final (saldo já pode estar zero):", e.message);
            }
        }
        res.json({ msg: "PANIC STOP! Ativos Liquidados e Robô Pausado." });
    } catch (e) { next(e); }
});

app.get('/moedas-ranking', (req, res) => {
    console.log(`[API] Solicitado ranking. Itens em cache: ${binance.globalMarket.top30.length}`);
    res.json({
        ranking: binance.globalMarket.top30,
        serverTime: Date.now()
    });
});

app.get('/info-par', async (req, res, next) => {
    try {
        const info = await binance.getExchangeInfo(req.query.symbol);
        res.json(info);
    } catch (e) { next(e); }
});

// --- ADMIN ROUTES ---

app.get('/admin/overview', adminLimiter, authMiddleware, (req, res) => {
    res.json({
        users: storage.getUsers(),
        serverUptime: process.uptime(),
        serverIp: 'Local Dynamic'
    });
});

app.post('/admin/approve-user', authMiddleware, async (req, res, next) => {
    try {
        await storage.updateUser(req.body.targetUser, { isApproved: true });
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/admin/stop-user', authMiddleware, async (req, res, next) => {
    try {
        await storage.updateUser(req.body.targetUser, { remoteCommand: 'STOP' });
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/admin/stop-all', authMiddleware, async (req, res, next) => {
    try {
        const users = storage.getUsers();
        for (const u of users) {
            await storage.updateUser(u.username, { remoteCommand: 'STOP' });
        }
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/admin/delete-user', authMiddleware, async (req, res, next) => {
    try {
        await storage.deleteUser(req.body.targetUser);
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/admin/set-password', authMiddleware, async (req, res, next) => {
    try {
        const { targetUser, newPassword } = req.body;
        await storage.updateUser(targetUser, { password: newPassword });
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/admin/reset-all-users', authMiddleware, async (req, res, next) => {
    try {
        await storage.resetUsers();
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/admin/anti-restart', authMiddleware, async (req, res, next) => {
    try {
        await storage.updateUser(req.body.targetUser, { staircaseIndex: 10 });
        res.json({ success: true });
    } catch (e) { next(e); }
});

// --- EXPORT ROUTES ---

app.get('/export-leads', authMiddleware, (req, res) => {
    const users = storage.getUsers();
    const csv = "Nome Completo,WhatsApp,Email,Usuario,Status,Aprovado,Saldo USDT,Data Cadastro\n" + 
        users.map(u => `"${u.fullName || ''}","${u.whatsapp || ''}","${u.email || ''}","${u.username}","${u.status}","${u.isApproved}","${u.balanceUSDT || 0}","${u.registrationDate}"`).join("\n");
    res.attachment('leads_sifras.csv').send('\uFEFF' + csv); // Add UTF-8 BOM for Excel
});

app.get('/export-word', authMiddleware, (req, res) => {
    const users = storage.getUsers();
    const txt = users.map(u => `CLIENTE: ${u.username}\nEMAIL: ${u.email}\nSTATUS: ${u.status}\nAPROVADO: ${u.isApproved}\nDATA: ${u.registrationDate}\n---`).join("\n\n");
    res.attachment('leads_sifras.txt').send(txt);
});

app.get('/ping', (req, res) => res.json({ version: '4.5.0-STABLE-OFFICIAL', status: 'online' }));

// --- PAGE ROUTES ---
app.get(['/', '/operacional'], (req, res) => res.sendFile(path.join(__dirname, 'operacional.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/cadastro', (req, res) => res.sendFile(path.join(__dirname, 'cadastro.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/leads', (req, res) => res.sendFile(path.join(__dirname, 'leads.html')));
app.get('/alfabeta', (req, res) => res.sendFile(path.join(__dirname, 'alfabeta.html')));

// --- ERROR HANDLER ---
app.use(errorMiddleware);

app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`[ALFA SYSTEM] Motor Ligado na porta ${config.PORT}`);
});


