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
            await fs.writeFile(config.USERS_FILE, JSON.stringify(this.users, null, 2));
        } catch (e) {
            console.error("Erro ao salvar usuários:", e);
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
        }
        
        // Atualiza campos apenas se não forem vazios/undefined para evitar perda de dados no heartbeat
        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && value !== null && value !== '') {
                this.users[username][key] = value;
            } else if (['status', 'activeSymbol', 'balanceUSDT', 'remoteCommand', 'isApproved', 'buyPrice', 'currentPrice', 'targetPrice', 'pnlPerc', 'liquidPnlPool', 'staircaseIndex'].includes(key)) {
                // Campos técnicos podem ser atualizados mesmo se zero/vazio
                this.users[username][key] = value;
            }
        }
        
        this.users[username].lastHeartbeat = Date.now();
        await this.saveUsers();
        return this.users[username];
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
