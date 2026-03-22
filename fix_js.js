const fs = require('fs');
const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(file, 'utf8');

// 1. Remove qualquer menção à variavel 'box' que não existe mais para não dar ReferenceError
js = js.replace(/box\.classList\.remove\('active'\);/g, '');
js = js.replace(/box\.textContent = .*?;/g, '');
js = js.replace(/const box = document\.getElementById\('decision-box'\);/g, '');

// 2. Corrige o erro de sintaxe bizarro (restos do loop anterior do updateUI)
// Procura a exata string que está sujando o final da função updateUI e apaga
const badSyntaxRegex = /}<\/span> \${c\.symbol\.replace\('USDT', ''\)} \${badge}<\/span>[\s\S]*?document\.getElementById\('last-update'\)\.textContent = new Date\(\)\.toLocaleTimeString\(\);\n}/g;
js = js.replace(badSyntaxRegex, '');

fs.writeFileSync(file, js);
console.log('Erros críticos de sintaxe no script_alfa.js foram higienizados.');
