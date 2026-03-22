const fs = require('fs');

const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\operacional.html';
let html = fs.readFileSync(file, 'utf8');

// 1. Substituir a Logo do Header (Texto por Imagem PNG)
const regexHeaderLogo = /<div class="logo-container"[^>]*>[\s\S]*?<div class="logo-icon"[\s\S]*?<\/div>[\s\S]*?<div class="logo-text"[\s\S]*?<\/div>[\s\S]*?<\/div>/;

const newHeaderLogo = `<div class="logo-container" style="margin: 0; padding: 0; border: none; display: flex; align-items: center; justify-content: center;">
                        <img src="logo.png" alt="Fluxo Alfa" style="height: 65px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.6);">
                    </div>`;

html = html.replace(regexHeaderLogo, newHeaderLogo);

// 2. Substituir a Logo do Profit Overlay (Modal Gigante 8 segundos)
const regexOverlayLogo = /<div class="profit-logo">[\s\S]*?<div class="logo-icon-large">[\s\S]*?<\/div>[\s\S]*?<div class="logo-text-large">[\s\S]*?<\/div>[\s\S]*?<\/div>/;

const newOverlayLogo = `<div class="profit-logo" style="display: flex; justify-content: center; margin-bottom: 30px;">
                <img src="logo.png" alt="Fluxo Alfa Profit" style="height: 140px; border-radius: 30px; box-shadow: 0 0 50px var(--primary);">
            </div>`;

html = html.replace(regexOverlayLogo, newOverlayLogo);

// Tratativa para o caso de espaçamento não bater no Overlay
if (!html.includes('Fluxo Alfa Profit')) {
    const backupOverlay = /<div class="profit-logo">[\s\S]+?<\/div>/;
    html = html.replace(backupOverlay, newOverlayLogo);
}

fs.writeFileSync(file, html);
console.log('Logo PNG Oficial inserida no Cabeçalho e no Modal de Comemoração!');
