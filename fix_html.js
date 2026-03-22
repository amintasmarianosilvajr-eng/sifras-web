const fs = require('fs');
const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\operacional.html';
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Vamos manter apenas as linhas ANTES da 163 e DEPOIS da 186
// Arrays em JS são 0-indexed. Linha 163 é o index 162. Linha 186 é o index 185.
const newLines = [
    ...lines.slice(0, 162),
    '                <!-- Fantasmas textuais apagados com rigor matemático -->',
    ...lines.slice(186)
];

fs.writeFileSync(file, newLines.join('\n'));
console.log('Linhas 163 a 186 apagadas com sucesso.');
