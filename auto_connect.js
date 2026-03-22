const fs = require('fs');
const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(file, 'utf8');

// Atualizar a função loadSavedData para realizar o Auto-Connect (Memorizar e Auto-Acionar)
const autoConnectCode = `function loadSavedData() {
    [1].forEach(id => {
        const saved = localStorage.getItem(\`sifras_slot_\${id}\`);
        if (saved) {
            const data = JSON.parse(saved);
            document.getElementById(\`slot-\${id}-name\`).value = data.name || '';
            document.getElementById(\`slot-\${id}-key\`).value = data.key || '';
            document.getElementById(\`slot-\${id}-secret\`).value = data.secret || '';
            activeSlots[id].key = data.key;
            activeSlots[id].secret = data.secret;
            activeSlots[id].clientName = data.name;
            
            // Auto Memorização e Auto-Conexão
            if (data.key && data.secret) {
                setTimeout(() => {
                    connectSlot(id);
                    addLog('Chaves Mestre auto-recuperadas da memória local.', 'system');
                }, 800);
            }
        }
    });
}`;

js = js.replace(/function loadSavedData\(\) {[\s\S]*?}\n\nfunction saveSlotData/g, autoConnectCode + '\n\nfunction saveSlotData');

fs.writeFileSync(file, js);
console.log('Auto-Memory Injection Completa!');
