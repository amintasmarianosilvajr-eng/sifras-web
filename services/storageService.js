const fs = require('fs').promises;
const path = require('path');
const config = require('../config');

class StorageService {
    constructor() {
        this.users = {};
        this.leads = [];
        this.isDirty = false;
        this.saveInProgress = false;
        
        // Timer de persistência inteligente (Previne travamento de I/O)
        setInterval(() => this.autoSave(), 10000); 
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

    async saveUsers(force = false) {
        if (!force && this.saveInProgress) return;
        this.saveInProgress = true;

        const tempFile = `${config.USERS_FILE}.tmp`;
        const backupFile = `${config.USERS_FILE}.bak`;
        try {
            const data = JSON.stringify(this.users, null, 2);
            
            // 1. Escreve em arquivo temporário
            await fs.writeFile(tempFile, data, 'utf8');
            
            // 2. Cria backup do atual (se existir)
            try {
                await fs.copyFile(config.USERS_FILE, backupFile);
            } catch (e) { /* Arquivo original pode não existir no primeiro save */ }
            
            // 3. Renomeia o temporário para o oficial (Operação Atômica no SO)
            await fs.rename(tempFile, config.USERS_FILE);
            
            this.isDirty = false;
            console.log(`[STORAGE] Persistência Atômica Concluída: ${Object.keys(this.users).length} registros.`);
        } catch (e) {
            console.error("[STORAGE] [ERRO CRÍTICO] Falha na escrita atômica:", e.message);
            try { await fs.unlink(tempFile); } catch(err) {}
        } finally {
            this.saveInProgress = false;
        }
    }

    async autoSave() {
        if (this.isDirty && !this.saveInProgress) {
            await this.saveUsers();
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
                const oldAlfa = user.alfaState || {};
                const newAlfa = value || {};
                
                // --- ALFA SERVER-AS-MASTER (ESTÁVEL) ---
                // Se o novo estado não informou trade, mantemos o que está no servidor
                if (typeof newAlfa.currentTrade === 'undefined') {
                    newAlfa.currentTrade = oldAlfa.currentTrade;
                }
                
                user.alfaState = { ...oldAlfa, ...newAlfa };
            } else {
                user[key] = value;
            }
        }
        
        user.lastHeartbeat = Date.now();
        this.isDirty = true; // Marca para o autoSave()
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
