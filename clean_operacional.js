const fs = require('fs');
const path = require('path');

const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\operacional.html';
const serverFile = 'c:\\Users\\user\\Desktop\\Sifras_Web\\server.js';

if(fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');

    // 1. Remover Emojis (Regex agressiva universal)
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{2934}\u{2935}⚡🔥🎯📦🏁🔎🏆]/gu;
    content = content.replace(emojiRegex, '');

    // 2. Remover completamento o bloco do menu <nav>
    content = content.replace(/<nav class="nav-menu">[\s\S]*?<\/nav>/, '<nav class="nav-menu">\n                <!-- Modo Exclusivo: Sem navegação para rotas externas mantendo Operacional como painel raiz isolado -->\n            </nav>');

    // 3. Remover emojis no server.js logic string returns (opcional para o frontend display)
    if(fs.existsSync(serverFile)) {
        let sc = fs.readFileSync(serverFile, 'utf8');
        sc = sc.replace(/app\.get\('\/', \(req, res\) => {[\s\S]*?}\);/, `app.get('/', (req, res) => {\n  res.redirect('/operacional');\n});`);
        fs.writeFileSync(serverFile, sc);
    }

    // 4. Salvar HTML
    fs.writeFileSync(file, content);
    console.log("Limpeza e isolamento do Operacional concluídos!");
}
