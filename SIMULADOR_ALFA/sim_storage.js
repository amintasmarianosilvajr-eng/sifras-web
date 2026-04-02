const fs = require('fs').promises;
const path = require('path');

class SimStorage {
    constructor() {
        this.dbPath = path.join(__dirname, 'sim_db.json');
        this.data = {
            virtualBalance: 25728.42,
            currentTrade: null,
            history: [],
            monitoring: false
        };
    }

    async init() {
        try {
            const content = await fs.readFile(this.dbPath, 'utf8');
            this.data = JSON.parse(content);
        } catch (e) {
            await this.save();
        }
    }

    async save() {
        await fs.writeFile(this.dbPath, JSON.stringify(this.data, null, 2));
    }

    getState() { return this.data; }

    async updateState(newState) {
        this.data = { ...this.data, ...newState };
        await this.save();
        return this.data;
    }
}

module.exports = new SimStorage();
