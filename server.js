const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(cors());

// Senhas de Acesso
const GLOBAL_ACCESS_KEY = 'alfa777';
const ADMIN_ACCESS_KEY = 'alfa777admin';

// CONFIGURAÇÃO E PERSISTÊNCIA
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users_db.json');
let usersDB = {}; 

if (fs.existsSync(USERS_FILE)) {
    try { usersDB = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
}

function saveUsersDB() { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2)); }

const activeTokens = new Map();
const userStates = new Map();

function createInitialState(username) {
    return {
        username, apiKey: '', apiSecret: '', status: 'OFFLINE', opsCount: 0, cooldownList: [], history: [], logs: [],
        dashboardData: { topRanking: [], pivotInfo: null, volatilityMetrics: null, triggerProfitAnim: false },
        isLoopActive: false, activeSymbol: null, buyPrice: 0, targetPrice: 0, currentPrice: 0, buyQty: 0,
        cachedFilters: null, totalProfit: 0.0, tradedCoins: [], buyPercentage: 0.99, buyAmountUSDT: 0.0, currentStep: 'OFFLINE'
    };
}

function loadUserState(username) {
    const state = createInitialState(username);
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    if (fs.existsSync(userFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
            Object.assign(state, data);
            state.status = 'OFFLINE';
            state.isLoopActive = false;
        } catch (e) {}
    }
    userStates.set(username, state);
    return state;
}

function saveUserState(username) {
    const state = userStates.get(username);
    if (!state) return;
    const userFile = path.join(DATA_DIR, `trade_${username}.json`);
    const dataToSave = { history: state.history, totalProfit: state.totalProfit, opsCount: state.opsCount, apiKey: state.apiKey, apiSecret: state.apiSecret, buyPercentage: state.buyPercentage };
    fs.writeFileSync(userFile, JSON.stringify(dataToSave, null, 2));
}

// SERVIR ARQUIVOS ESTÁTICOS
app.use(express.static(path.join(__dirname)));

// ROTAS DE ACESSO
app.post('/gateway', (req, res) => {
    const { accessKey } = req.body;
    if (accessKey === GLOBAL_ACCESS_KEY || accessKey === ADMIN_ACCESS_KEY) {
        return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Incorreta' });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Campos obrigatórios' });
    if (!usersDB[username]) {
        usersDB[username] = { password };
        saveUsersDB();
    } else if (usersDB[username].password !== password) {
        return res.status(401).json({ error: 'Incorreta' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.set(token, username);
    if (!userStates.has(username)) loadUserState(username);
    return res.json({ token, username });
});

function requireAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
        const token = auth.split(' ')[1];
        const username = activeTokens.get(token);
        if (username) {
            req.username = username;
            req.state = userStates.get(username) || loadUserState(username);
            return next();
        }
    }
    return res.status(401).json({ error: 'Auth failed' });
}

// MONITORAMENTO ADMINISTRATIVO
app.get('/painel_alfa', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin/overview', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth === `Bearer ${ADMIN_ACCESS_KEY}` || auth === ADMIN_ACCESS_KEY) {
        const overview = [];
        for (const [username, state] of userStates) {
            overview.push({ username, status: state.status, activeSymbol: state.activeSymbol, currentStep: state.currentStep, totalProfit: state.totalProfit, opsCount: state.opsCount });
        }
        return res.json(overview);
    }
    return res.status(401).json({ error: 'Negado' });
});

// MOTOR TRADING (REDUZIDO PARA ECONOMIZAR ESPAÇO NO LOG)
app.get('/status', requireAuth, (req, res) => res.json(req.state));

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Sifras Rodando na Porta ${PORT}`));
