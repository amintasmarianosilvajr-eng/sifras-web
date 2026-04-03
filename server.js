const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const config = require('./config');
const storage = require('./services/storageService');
const binance = require('./services/binanceService');
const tradingService = require('./services/tradingService');

const app = express();
app.use(bodyParser.json());

// --- ROTEAMENTO AMIGÁVEL (FIX: Cannot GET /operacional) ---
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
// --- CORE ROUTES ---

app.post('/heartbeat', async (req, res, next) => {
    try {
        const { username, state, keys } = req.body;
        if (!username) return res.status(400).json({ error: "Username required" });
        
        const user = storage.getUser(username);
        if (!user) return res.status(404).json({ error: "User not found" });

        // --- BLINDAGEM MASTER ÔMEGA-3 ---
        // O servidor é o mestre. Só aceitamos o toggle de "monitoring" do frontend.
        const currentServerState = user.alfaState || {};
        
        const updatedState = {
            ...currentServerState,
            monitoring: typeof state.monitoring !== 'undefined' ? state.monitoring : currentServerState.monitoring,
            lastHeartbeat: Date.now()
        };

        // Atualiza chaves se enviadas
        const updatedKeys = (keys && keys.key) ? keys : user.keys;

        const updatedUser = await storage.updateUser(username, { 
            alfaState: updatedState,
            keys: updatedKeys,
            lastHeartbeat: Date.now()
        });

        // Retorna o estado real (do servidor) para o frontend apenas exibir
        res.json({ 
            success: true, 
            serverState: updatedUser.alfaState, 
            keys: updatedUser.keys || {},
            marketRanking: binance.globalMarket.top30 || [] 
        });
    } catch(e) { next(e); }
});

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

// Rota legada para compatibilidade, aponta para o heartbeat
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
        
        res.json({ success: true, msg: "Panic stop executado e motor travado." });
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
        
        await storage.updateUser(username, { 
            fullName, email, whatsapp, password, 
            isApproved: false // Novos cadastros dependem de aprovação no Admin
        });
        res.json({ success: true, msg: "Solicitação enviada. Aguarde aprovação." });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = storage.getUser(username);
        
        if (!user) throw new Error("Usuário não encontrado.");
        if (user.password !== password) throw new Error("Senha incorreta.");
        if (!user.isApproved) throw new Error("Seu acesso ainda não foi liberado pelo administrador.");
        
        res.json({ 
            success: true, 
            user: {
                username: user.username,
                keys: user.keys || {}
            },
            token: 'ALFA-' + Date.now()
        });
    } catch (e) { res.status(401).json({ error: e.message }); }
});

const auth = require('./middleware/authMiddleware');

// --- ADMIN ROUTES (COMMAND CENTER) ---
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

        res.json({
            success: true,
            users,
            serverUptime: process.uptime(),
            totalLeads: users.filter(u => !u.isApproved).length
        });
    } catch (error) {
        console.error("[ADMIN] Erro ao carregar visão geral:", error);
        res.status(500).json({ error: 'Erro ao carregar visão geral' });
    }
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
        res.json({ success: true, msg: "Comando de parada agendado para o próximo pulso." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- EXPORT ROUTES ---
app.get('/export-leads', auth, (req, res) => {
    try {
        const users = storage.getUsers();
        let csv = 'Nome;Usuario;Email;WhatsApp;Saldo;Cadastro;Status\n';
        users.forEach(u => {
            csv += `${u.fullName || ''};${u.username};${u.email || ''};${u.whatsapp || ''};${u.balanceUSDT || 0};${u.registrationDate};${u.isApproved ? 'APROVADO' : 'PENDENTE'}\n`;
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=leads_alfa.csv');
        res.send(csv);
    } catch (e) { res.status(500).send("Erro ao exportar."); }
});

app.get('/export-word', auth, (req, res) => {
    try {
        const users = storage.getUsers();
        let report = '--- RELATÓRIO DE MENTORADOS FLUXO ALFA ---\n\n';
        users.forEach(u => {
            report += `CLIENTE: ${u.fullName || u.username}\nUSUÁRIO: ${u.username}\nEMAIL: ${u.email || '---'}\nWHATSAPP: ${u.whatsapp || '---'}\nSTATUS: ${u.isApproved ? 'APROVADO' : 'PENDENTE'}\n-----------------------------------\n\n`;
        });
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'attachment; filename=relatorio_alfa.txt');
        res.send(report);
    } catch (e) { res.status(500).send("Erro ao exportar relatório."); }
});

// ERROR MIDDLEWARE (BLINDAGEM CONTRA CRASHES)
app.use((err, req, res, next) => {
    console.error(`[CRÍTICO] Erro na rota ${req.path}:`, err.message);
    res.status(500).json({ 
        success: false, 
        error: "Erro interno no servidor Alfa.",
        msg: err.message 
    });
});

// --- RAILWAY GRACEFUL SHUTDOWN (PROTEÇÃO DE DADOS) ---
const gracefulShutdown = async (signal) => {
    console.log(`\n[SYSTEM] Recebido sinal ${signal}. Iniciando encerramento seguro...`);
    try {
        await storage.saveUsers();
        console.log("[SYSTEM] Todos os dados foram persistidos com sucesso.");
        process.exit(0);
    } catch (e) {
        console.error("[SYSTEM] Erro crítico no desligamento:", e.message);
        process.exit(1);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// START SEQUENCE (HEALING)
async function startServer() {
    console.log("[MASTER] Inicializando banco de dados local...");
    await storage.init(); 
    
    const PORT = config.PORT || process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\n=================================================`);
        console.log(`[MASTER SERVER] SIFRAS ALFA v6.1.2`);
        console.log(`[STATUS] Rodando em http://localhost:${PORT}`);
        console.log(`[STATUS] Roteamento Ativo: /operacional, /dashboard`);
        console.log(`=================================================\n`);
        
        binance.startGlobalWS();
        tradingService.init();
    });
}

startServer().catch(e => {
    console.error("[CRITICAL] Falha na inicialização do servidor:", e);
});
