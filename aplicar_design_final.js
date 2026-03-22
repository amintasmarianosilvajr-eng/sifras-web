const fs = require('fs');

const pathHtml = 'c:\\Users\\user\\Desktop\\Sifras_Web\\operacional.html';
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
const pathCss = 'c:\\Users\\user\\Desktop\\Sifras_Web\\style_alfa.css';

// 1. Modificar o HTML
let html = fs.readFileSync(pathHtml, 'utf8');

// 1.1 Header (Logo + Texto Profissional)
const oldHeaderTitle = `<div class="header-title">
                    <h1>Sifras Web <span class="highlight">Operação Ciclos ALFA</span></h1>
                    <p style="color: var(--accent-green); font-weight: bold;">️ CONEXÃO BINANCE MAINNET (LIVE)
                        — Reposição Automática Ativa
                    </p>
                </div>`;
const newHeaderTitle = `<div class="header-title" style="display: flex; align-items: center; gap: 25px;">
                    <div class="logo-container" style="margin: 0; padding: 0; border: none; display: flex; align-items: center; gap: 15px;">
                        <div class="logo-icon" style="background: var(--primary); color: var(--bg-dark); width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; border-radius: 12px; font-weight: 800; font-size: 1.5rem; font-family: 'Outfit';">F</div>
                        <div class="logo-text" style="font-size: 1.5rem; line-height: 1;">FLUXO<span style="display: inline; color: var(--primary); margin-left: 5px;">ALFA</span></div>
                    </div>
                    <div style="height: 40px; width: 2px; background: var(--card-border);"></div>
                    <div>
                        <h1 style="font-size: 1.1rem; color: #fff; margin: 0; text-transform: uppercase; letter-spacing: 1px;">Operações Não Binárias</h1>
                        <p style="color: var(--accent-green); font-weight: 700; font-size: 0.85rem; margin-top: 5px; text-transform: uppercase;">De alto fluxo em Pixels</p>
                    </div>
                </div>`;
html = html.replace(oldHeaderTitle, newHeaderTitle);

// 1.2 Layout dos Botões API
const oldButtons = `<button class="btn-connect" onclick="connectSlot(1)">CONECTAR SLOT</button>
                                <button class="btn-test-api disabled" id="test-1" onclick="testApiConnection(1)"
                                    style="width: 100%; margin-top: 8px; padding: 10px; border-radius: 8px; font-weight: 700; font-size: 0.75rem; cursor: pointer; background: rgba(121, 40, 202, 0.2); border: 1px solid var(--accent-purple); color: var(--accent-purple);">TESTAR
                                    API (SALDO)</button>
                                <button class="btn-activate disabled" id="activate-1"
                                    onclick="toggleMonitoring(1)">INICIAR MONITORAMENTO</button>`;
const newButtons = `<div style="display: flex; gap: 15px; margin-top: 15px; width: 100%;">
                                    <button class="btn-connect" onclick="connectSlot(1)" style="flex: 1; padding: 16px; font-size: 0.85rem; border-radius: 15px;">1. CONECTAR</button>
                                    <button class="btn-activate disabled" id="test-1" onclick="testApiConnection(1)" style="flex: 1; margin:0; padding: 16px; font-size: 0.85rem; border-radius: 15px; background: transparent; border: 2px solid var(--card-border); color: #fff;">2. VERIFICAR</button>
                                    <button class="btn-activate disabled" id="activate-1" onclick="toggleMonitoring(1)" style="flex: 1; margin:0; padding: 16px; font-size: 0.85rem; border-radius: 15px;">3. MONITORAR</button>
                                </div>`;
html = html.replace(oldButtons, newButtons);
if(html.includes('TESTAR\n                                    API (SALDO)')){
    // Regex em caso de falha de espaçamento do VScode
    html = html.replace(/<button class="btn-connect"[\s\S]*?INICIAR MONITORAMENTO<\/button>/, newButtons);
}
fs.writeFileSync(pathHtml, html);

// 2. Modificar os Arquivos CSS (Destaque nos Logs)
let css = fs.readFileSync(pathCss, 'utf8');
css = css.replace(/\.log-entry\.buy \{ color: var\(--primary\); border-left: 4px solid var\(--primary\); \}/, `.log-entry.buy { color: var(--bg-dark); background: var(--primary); font-weight: 800; border: none; padding: 12px; border-radius: 8px; margin-top: 5px; }`);
css = css.replace(/\.log-entry\.sell \{ color: #fff; border-left: 4px solid #fff; \}/, `.log-entry.sell { color: #fff; background: rgba(255, 255, 255, 0.1); border-left: 4px solid var(--primary); font-weight: 700; padding: 12px; margin-top: 5px; text-transform: uppercase; }`);
fs.writeFileSync(pathCss, css);

// 3. Modificar o JS (Termos Corporativos)
let js = fs.readFileSync(pathJs, 'utf8');
const termsToReplace = [
    [/🔥 SISTEMA FERRARI SNIPER: MODO REAL ATIVO/, '[SISTEMA ALFA] Motor de Operações Base Inicializado'],
    [/Bypassing security filters\.\.\. Connected\./, '[CONEXÃO] Link Seguro Estabelecido (Mainnet).'],
    [/Chaves Mestre auto-recuperadas da memória local\./, '[SISTEMA] Credenciais Operacionais recuperadas da base.'],
    [/🔄 CICLO REINICIADO! Sistema retomando operações\.\.\./, '[OPERAÇÃO] Retomando fluxo de varredura ativa.'],
    [/⚡ GATILHO RÁPIDO: (.*?) \+(.*?)% em 15s \(Rank #(.*?)\)/, '[ALERTA DE FLUXO] Crescimento Anômalo em $1 (+$2%/15s) | Rank #$3.'],
    [/♻️ REPOSIÇÃO (.*?): (.*?)\. Disparando\.\.\./, '[REPOSIÇÃO] Ciclo $1 em $2. Processando Ordem...'],
    [/🔭 ALVO DETECTADO: (.*?)\. Disparando chaves\.\.\./, '[ALVO CONFIRMADO] Padrão detectado em $1. Processando Ordem...'],
    [/📦 Qty adquirida \(Slot #(.*?)\): (.*?)/, '[AUDITORIA] Fração executada (S$1): $2'],
    [/✅ Qty armazenada: (.*?) (.*?)/, '[SISTEMA] Fração registrada em log de memória interna: $1 $2'],
    [/⚠️ Qty não retornada pela API\. Usará saldo real na venda\./, '[AVISO] Divergência na API da Binance. O motor forçará leitura do saldo real no fechamento.'],
    [/🎯 POSICIONADO em (.*?) \| Op (.*?)\/(.*?)\. Monitorando alvo\.\.\./, '[POSIÇÃO ABERTA] Ativo: $1 | Operação de Ciclo Atual: $2/$3.'],
    [/❌ PAINEL: Ordem Rejeitada\. Confira 'Spot Trading' na Binance\./, '[ERRO] Ordem Recusada. Verifique permissões Mestre "Spot Trading" na Binance.'],
    [/✅ COMPRA CONFIRMADA! (.*?) adquirido\. Qtd: (.*?)/, '[COMPRA EXECUTADA] Ativo: $1 | Qtd: $2'],
    [/✅ USDT ADQUIRIDO! (.*?) convertido com sucesso\./, '[VENDA EXECUTADA] Capital em $1 inteiramente convertido para USDT.'],
    [/🎯 META ALCANÇADA: (.*?)% — Comprando USDT e reposicionando!/, '[TAKE PROFIT ALCANÇADO] Variação Positiva Identificada ($1%). Iniciando Ordem de Liquidação.'],
    [/🛑 STOP LOSS: (.*?)% — Protegendo capital e mudando de alvo!/, '[RISCO MÁXIMO ATINGIDO] Gatilho de Segurança ativado ($1%). Iniciando Ordem de Liquidação (Proteção).'],
    [/✨ REPOSIÇÃO IMEDIATA: (.*?) reposicionado/, '[REPOSIÇÃO ATIVA] Substituição da margem de operação para ativo alvo.'],
    [/💹 SAÍDA OPERACIONAL! Vendendo (.*?) para obter USDT\.\.\./, '[LIQUIDAÇÃO A MERCADO] Enviando Ordem de Venda Integral para $1.'],
    [/📐 Qty corrigida: (.*?) → com margem e precisão \((.*?) casas\): (.*?)/, '[AJUSTE DE FRAÇÃO] Lote bruto: $1 → Corrigido com Step Size ($2 decimais): $3'],
    [/🔍 Qty não encontrada\. Buscando saldo real na Binance\.\.\./, '[CONSULTA] Buscando saldo real exato pendente de liquidação na carteira Binance...'],
    [/🔍 Saldo real: (.*?) → formatado: (.*?)/, '[CONSULTA REALIZADA] Saldo exato recuperado: $1 → Ajustado: $2'],
    [/❌ Saldo insuficiente para venda de (.*?)\./, '[FALHA DE LIQUIDAÇÃO] Margem de ativo ($1) é insuficiente para envio da ordem de venda.'],
    [/🛡️ STOP LOSS FINALIZADO! Capital protegido\. Impacto na banca: (.*?)%\. Saldo parcial: (.*?)%/, '[STOP LOSS EXECUTADO] Operação e Prejuízos Encerrados. PNL do Trade: $1%. Global: $2%'],
    [/💰 Venda registrada! Lucro acumulado Slot #(.*?): (.*?)%/, '[MARGEM CONSOLIDADA] Operação S$1 fechada com lucro! PNL Global Acumulado C/ Juros: $2%'],
    [/🔄 USDT obtido! Cota (.*?)\/(.*?) concluída\./, '[ATUALIZAÇÃO DE OPERAÇÃO] Capital protegido em USDT. Operações concluídas no Ciclo: $1/$2.'],
    [/🏁 CICLO COMPLETO! (.*?) operações\. PAUSA DE 30 MINUTOS iniciada\./, '[CICLO ENCERRADO] Limite de segurança de $1 Trades atingido. Protocolo de Resfriamento de 30min Inativo ativado.'],
    [/⏰ Sistema retomará às (.*?)/, '[AGUARDO] Retomada inteligente de mercado agendada estritamente para às $1'],
    [/♻️ RECOMPRA IMEDIATA: reposicionando em (.*?)\.\.\./, '[NOVO ALVO] Reposicionando mira de mercado imediatamente em $1...'],
    [/🚫 COOLDOWN: (.*?) ocultada\./, '[SISTEMA ALFA] Ativo $1 atingiu limite de reentradas por janela operacional (Ignorando).'],
    [/💤 Guardião (.*?) em repouso\./, '[SISTEMA] Monitoramento do Terminal $1 Suspenso.'],
    [/🕵️ Guardião (.*?) em patrulha\./, '[SISTEMA] Monitoramento do Terminal $1 Ativado. Aguardando Janelas de Oportunidade.']
];

termsToReplace.forEach(([oldR, newTerm]) => {
    js = js.replace(oldR, newTerm);
    // Também cobrir versão global caso tenha múltiplos
    js = js.replace(new RegExp(oldR, 'g'), newTerm); 
});

fs.writeFileSync(pathJs, js);
console.log('UI Profissionalizada + Botoes Lado a Lado + Logs Corporativos Injetados!');
