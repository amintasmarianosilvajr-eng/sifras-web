const fs = require('fs');
const path = require('path');

const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\operacional.html';
let html = fs.readFileSync(file, 'utf8');

// 1. Remover completamente o resto do código pendurado que estava criando aquele painel indesejado
html = html.replace(/<div class="alfa-container">[\s\S]*?<\/div>[\s]*<\/div>/, '');

// 2. Injetar o novo painel dinâmico (com o Grid de 9 moedas) exatamente acima do quadro de Logs, caso ainda não exista
if (!html.includes('dynamic-targets-card')) {
    const dynamicCard = `
                <!-- Monitoramento Dinâmico de Mercado (Ranks #2 ao #10) -->
                <div class="card dynamic-targets-card">
                    <div class="card-header">
                        <h3>Espectro de Oportunidades (Rank #2 ao #10)</h3>
                        <span class="time-update" id="last-update">Sincronizando Módulo...</span>
                    </div>
                    <div class="targets-grid" id="dynamic-targets-grid">
                        <div class="loading">Recuperando trilhos de dados da Binance...</div>
                    </div>
                </div>
`;
    // Substituir a marcação dos Logs para costurar o novo card antes
    html = html.replace(/<!-- Operational Logs -->/, dynamicCard + '\n                <!-- Operational Logs -->');
}

fs.writeFileSync(file, html);
console.log('Painel antigo expurgado e novo Espectro Dinâmico posicionado com sucesso!');
