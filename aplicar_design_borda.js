const fs = require('fs');

const pathCss = 'c:\\Users\\user\\Desktop\\Sifras_Web\\style_alfa.css';
let css = fs.readFileSync(pathCss, 'utf8');

// 1. Remover a linha verde (var(--primary)) no topo de todos os cards
const cardBeforeRegex = /\.card::before\s*\{[\s\S]*?\}/g;
css = css.replace(cardBeforeRegex, `
.card::before {
    content: ''; position: absolute;
    top: 0; left: 0; right: 0; height: 1px;
    background: #6B7280; /* Linha discreta cinza claro superior */
    box-shadow: 0 0 10px rgba(107, 114, 128, 0.5); /* Sombra grafite */
}`);

// 2. Modificar as bordas do Card de Operação Ativa (Tirar o verde limão)
const activeTradeRegex = /\.card\.active-trade-card\s*\{[\s\S]*?\}/g;
css = css.replace(activeTradeRegex, `
.card.active-trade-card { 
    border: 1px solid #4A5568; /* Cinza grafite */
    box-shadow: 0 15px 40px rgba(0, 0, 0, 0.6), 0 0 25px rgba(74, 85, 104, 0.3); /* Sombra destacando em grafite */
}`);

// 3. Atualizar o Card Padrão para garantir que não tem borda agressiva
const cardRegex = /\.card\s*\{([\s\S]*?)\}/;
/*
.card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    ...
*/
css = css.replace(cardRegex, `.card {
    background: var(--card-bg);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 30px;
    padding: 3rem;
    box-shadow: 0 15px 40px rgba(0, 0, 0, 0.6), 0 0 15px rgba(46, 59, 82, 0.3);
    position: relative;
    overflow: hidden;
}`);

// 4. Remover borda verde de painel de profit
// (Wait, profit-overlay also has green? They didn't ask to remove it from the celebration overlay, only the main cards. But let's check).
// They said "Tirar a borda verde limão de todos e deixar conforme anexo".
// I'll stick to the cards.

fs.writeFileSync(pathCss, css);
console.log('CSS atualizado: Bordas e sombras grafite/cinza premium aplicadas.');
