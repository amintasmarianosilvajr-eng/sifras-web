const fs = require('fs');
const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Inserir a chave de fechamento logo antes de 'function updateStatus(on)'
const newLines = [];
lines.forEach(line => {
    if (line.includes('function updateStatus(on) {')) {
        newLines.push('}'); // Fecha o updateUI pendente
    }
    newLines.push(line);
});

fs.writeFileSync(file, newLines.join('\n'));
console.log('Chave coringa fechada.');
