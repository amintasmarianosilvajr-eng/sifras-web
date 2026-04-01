const fs = require('fs').promises;
const path = require('path');
const config = require('../config');

class StorageService {
    constructor() {
        this.users = {};
        this.leads = [];
    }

    async init() {
        try {
            await fs.mkdir(path.dirname(config.USERS_FILE), { recursive: true });
            const data = await fs.readFile(config.USERS_FILE, 'utf8');
            this.users = JSON.parse(data);
        } catch (e) {
            this.users = {};
            await this.saveUsers();
        }
    }

    async saveUsers() {
        try {
            const count = Object.keys(this.users).length;
            await fs.writeFile(config.USERS_FILE, JSON.stringify(this.users, null, 2));
            console.log(`[STORAGE] Memória Sincronizada: ${count} usuários salvos em disco.`);
        } catch (e) {
            console.error("[STORAGE] Erro crítico ao salvar usuários:", e);
        }
    }

    getUsers() {
        return Object.values(this.users).map(u => ({
            ...u,
            isOnline: (Date.now() - (u.lastHeartbeat || 0)) < config.HEARTBEAT_TIMEOUT
        }));
    }

    getUser(username) {
        return this.users[username];
    }

    async findUserByKeys(key, secret) {
        return this.getUsers().find(u => u.keys && u.keys.key === key);
    }

    async updateUser(username, data) {
        if (!this.users[username]) {
            this.users[username] = {
                username,
                fullName: data.fullName || '',
                email: data.email || '',
                whatsapp: data.whatsapp || '',
                password: data.password || '',
                registrationDate: new Date().toISOString(),
                isApproved: false,
                status: 'OFFLINE',
                staircaseIndex: 10,
                alfaState: {}
            };
            console.log(`[STORAGE] Criando novo registro: ${username}`);
        }
        
        const user = this.users[username];

        for (const [key, value] of Object.entries(data)) {
            if (key === 'alfaState') {
                const oldState = user.alfaState || {};
                const newState = value || {};
                
                // ÔMEGA-3: RECUPERAÇÃO DE TRADE (Se o servidor resetou mas o navegador tem trade, restaura)
                if (!oldState.currentTrade && newState.currentTrade) {
                    console.log(`[STORAGE] [OMEGA-3] RECUPERANDO TRADE EXTERNO: ${newState.currentTrade.symbol}`);
                    user.alfaState = newState;
                    continue;
                }

                // BLINDAGEM: Se o servidor tem trade mas o novo pulso não, MANTÉM o do servidor
                if (oldState.currentTrade && !newState.currentTrade) {
                    newState.currentTrade = oldState.currentTrade;
                }

                // PROTEÇÃO DE QTY: Se o QTY sumiu no novo dado, restaura do antigo
                if (oldState.currentTrade?.qty && !newState.currentTrade?.qty) {
                    if (newState.currentTrade) newState.currentTrade.qty = oldState.currentTrade.qty;
                }

                user.alfaState = { ...oldState, ...newState };
            } else if (value !== undefined && value !== null && value !== '') {
                user[key] = value;
            } else if (['status', 'activeSymbol', 'balanceUSDT', 'remoteCommand', 'isApproved', 'buyPrice', 'currentPrice', 'targetPrice', 'pnlPerc', 'liquidPnlPool', 'staircaseIndex'].includes(key)) {
                user[key] = value;
            }
        }
        
        user.lastHeartbeat = Date.now();
        await this.saveUsers();
        return user;
    }

    async deleteUser(username) {
        delete this.users[username];
        await this.saveUsers();
    }

    async resetUsers() {
        this.users = {};
        await this.saveUsers();
    }
}

module.exports = new StorageService();
