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
        
        // --- BLINDAGEM SERVER-AS-MASTER (REFINADA) ---
        // Só restaura se enviou vazio MAS o servidor tem trade E parece uma reconexão (atraso no pulso > 10s)
        let finalTrade = state.currentTrade;
        const timeSinceLastUpdate = existing ? (Date.now() - (existing.lastUpdated || 0)) : 0;

        if(!finalTrade && serverState.currentTrade && serverState.currentTrade.symbol && existing) {
             if (timeSinceLastUpdate > 10000) { 
                 console.log(`[HEARTBEAT] [SHIELD] Reconexão detectada para ${username}. Restaurando trade: ${serverState.currentTrade.symbol}`);
                 finalTrade = serverState.currentTrade;
             } else {
                 console.log(`[HEARTBEAT] [SYNC] Cliente ${username} limpou trade intencionalmente. Sincronizando com Servidor.`);
             }
        }

        // --- BLINDAGEM ÔMEGA-3 (LOCK DE PÂNICO & PERSISTÊNCIA DE HISTÓRICO) ---
        // Se houve um pânico recente (< 5s), ignora o desejo do cliente de ligar o motor
        const isRecentPanic = existing && existing.lastPanicTime && (Date.now() - existing.lastPanicTime < 5000);
        if (isRecentPanic) {
            state.monitoring = false;
            finalTrade = null;
        }

        // FUSÃO DE ESTADO SEGURA: O servidor protege o seu histórico e contador de ciclos
        const finalAlfaState = {
            ...serverState,      // Base: Dados REAIS do servidor (History, Cycles, etc)
            ...state,            // Update: Novos dados do cliente (Balance, Monitoring)
            currentTrade: finalTrade // Autoridade: Trade real da Binance/Servidor
        };

        const user = await storage.updateUser(username, { 
            alfaState: finalAlfaState,
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
app.get('/admin/overview', auth, (req, res) => {
    const users = storage.getUsers();
    res.json({
        users,
        serverUptime: process.uptime(),
        totalLeads: users.filter(u => !u.isApproved).length
    });
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
