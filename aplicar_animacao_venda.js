const fs = require('fs');

const pathHtml = 'c:\\Users\\user\\Desktop\\Sifras_Web\\operacional.html';
const pathCss = 'c:\\Users\\user\\Desktop\\Sifras_Web\\style_alfa.css';
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';

// --- 1. MODIFICAR HTML (Inserir Overlay) ---
let html = fs.readFileSync(pathHtml, 'utf8');
if (!html.includes('id="profit-overlay"')) {
    const overlayHtml = `
    <!-- Overlay de Celebração de Lucro (Fluxo Alfa) -->
    <div id="profit-overlay" class="profit-overlay">
        <div class="profit-card">
            <div class="profit-logo">
                <div class="logo-icon-large">F</div>
                <div class="logo-text-large">FLUXO<span>ALFA</span></div>
            </div>
            <h2>Mais uma operação com fluxo de lucro!</h2>
        </div>
    </div>
    `;
    // Inserir logo no início do body
    html = html.replace('<body>', '<body>' + overlayHtml);
    fs.writeFileSync(pathHtml, html);
}

// --- 2. MODIFICAR CSS (Estilos e Animação) ---
let css = fs.readFileSync(pathCss, 'utf8');
if (!css.includes('.profit-overlay')) {
    const overlayCss = `
/* ======== PROFIT OVERLAY ANIMATION ======== */
.profit-overlay {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(6, 11, 25, 0.95); z-index: 9999;
    display: flex; justify-content: center; align-items: center;
    opacity: 0; pointer-events: none; transition: opacity 0.5s ease;
}
.profit-overlay.show { opacity: 1; pointer-events: auto; }
.profit-card {
    background: var(--card-bg); border: 3px solid var(--primary);
    padding: 60px 80px; border-radius: 40px; text-align: center;
    box-shadow: 0 0 50px var(--accent-glow);
    animation: pulse-card 2s infinite cubic-bezier(0.4, 0, 0.2, 1);
}
.profit-logo { display: flex; align-items: center; justify-content: center; gap: 20px; margin-bottom: 30px; }
.logo-icon-large {
    background: var(--primary); color: var(--bg-dark); width: 90px; height: 90px;
    display: flex; align-items: center; justify-content: center; border-radius: 25px;
    font-size: 3.5rem; font-weight: 800; font-family: 'Outfit';
}
.logo-text-large { font-size: 4.5rem; font-weight: 900; font-family: 'Outfit'; color: #fff; line-height: 1; text-align: left; letter-spacing: -1px; }
.logo-text-large span { display: block; color: var(--primary); font-size: 1.8rem; letter-spacing: 5px; margin-top: 5px; }
.profit-card h2 { font-size: 2.2rem; color: #fff; font-weight: 700; }
@keyframes pulse-card {
    0% { transform: scale(1); box-shadow: 0 0 40px var(--accent-glow); }
    50% { transform: scale(1.05); box-shadow: 0 0 100px var(--primary); }
    100% { transform: scale(1); box-shadow: 0 0 40px var(--accent-glow); }
}
`;
    css += overlayCss;
    fs.writeFileSync(pathCss, css);
}

// --- 3. MODIFICAR SCRIPT_ALFA.JS (Gatilho) ---
let js = fs.readFileSync(pathJs, 'utf8');

const anchor = `if (actualPnl >= 0) {`;
if (js.includes(anchor) && !js.includes('profit-overlay')) {
    const triggerJs = `if (actualPnl >= 0) {
                const overlay = document.getElementById('profit-overlay');
                if(overlay) { overlay.classList.add('show'); setTimeout(() => overlay.classList.remove('show'), 8000); }
`;
    js = js.replace(anchor, triggerJs);
    fs.writeFileSync(pathJs, js);
}

console.log('Animação de Venda Fluxo Alfa Injetada com Sucesso.');
