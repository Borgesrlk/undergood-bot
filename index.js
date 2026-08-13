'use strict';
// Keep-alive HTTP para Render.com (deve ser o primeiro codigo)
const http = require('http');
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); })
    .listen(process.env.PORT || 3000, () => console.log('[HTTP] porta ' + (process.env.PORT || 3000)));

const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, Events } = require('discord.js');
const https  = require('https');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const TOKEN     = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;
const GIST_ID   = process.env.GIST_ID;
const GH_TOKEN  = process.env.GITHUB_TOKEN;
const ADMIN_ID  = process.env.ADMIN_ID;

const ADMIN_IDS = process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(',').map(id => id.trim())
    : (ADMIN_ID ? [ADMIN_ID] : []);

const COLOR = { primary: 0x8864FF, success: 0x00FF88, error: 0xFF4455, warning: 0xFFAA00, info: 0x4488FF };

// GitHub Gist
function ghRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = https.request({
            hostname: 'api.github.com', path, method,
            headers: {
                'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github+json',
                'User-Agent': 'WexizeBot', 'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            }
        }, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function readKeys() {
    try {
        const gist = await ghRequest('GET', `/gists/${GIST_ID}`);
        return JSON.parse(gist.files['keys.json'].content);
    } catch (e) { console.error('[Gist] read error:', e.message); return { keys: [] }; }
}

async function writeKeys(data) {
    try {
        await ghRequest('PATCH', `/gists/${GIST_ID}`, { files: { 'keys.json': { content: JSON.stringify(data, null, 2) } } });
    } catch (e) { console.error('[Gist] write error:', e.message); }
}

function isKeyExpired(k) {
    if (k.duration === '9999') return false;
    if (!k.activatedAt) return false;
    return Date.now() > new Date(k.activatedAt).getTime() + parseInt(k.duration) * 86400000;
}

function expiresAt(k) {
    if (k.duration === '9999') return '♾️ Nunca';
    if (!k.activatedAt) return '⏳ Aguardando primeiro uso';
    return new Date(new Date(k.activatedAt).getTime() + parseInt(k.duration) * 86400000)
        .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function statusEmoji(k) {
    if (isKeyExpired(k)) return '❌ Expirada';
    if (!k.activatedAt) return '⏳ Aguardando uso';
    if (k.hwid) return '🔒 Ativa + HWID vinculado';
    return '✅ Ativa';
}

// Comandos
const commands = [
    new SlashCommandBuilder().setName('gerar_key').setDescription('🔑 Gera keys (Admin)')
        .addStringOption(o => o.setName('dias').setDescription('Duração').setRequired(true)
            .addChoices({name:'1 Dia',value:'1'},{name:'7 Dias',value:'7'},{name:'30 Dias',value:'30'},{name:'Vitalício',value:'9999'}))
        .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (1-99)').setMinValue(1).setMaxValue(99).setRequired(true))
        .addStringOption(o => o.setName('usuario').setDescription('Usuário').setRequired(false)),
    new SlashCommandBuilder().setName('listar_keys').setDescription('📋 Lista keys')
        .addStringOption(o => o.setName('filtro').setDescription('Filtro').setRequired(false)
            .addChoices({name:'Todas',value:'all'},{name:'Ativas',value:'active'},{name:'Expiradas',value:'expired'},{name:'Pendentes',value:'pending'})),
    new SlashCommandBuilder().setName('remover_key').setDescription('🗑️ Remove key')
        .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true)),
    new SlashCommandBuilder().setName('verificar_key').setDescription('🔍 Verifica key')
        .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true)),
    new SlashCommandBuilder().setName('usar_key').setDescription('✅ Ativa key')
        .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true)),
    new SlashCommandBuilder().setName('resetar_hwid').setDescription('🔄 Reseta HWID (Admin)')
        .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true)),
    new SlashCommandBuilder().setName('banir_key').setDescription('🚫 Bane key (Admin)')
        .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true))
        .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('stats').setDescription('📊 Estatísticas (Admin)'),
].map(c => c.toJSON());

// Registra comandos
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
    try {
        console.log('[CMD] Registrando comandos...');
        if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        else await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('[CMD] Comandos registrados!');
    } catch (e) { console.error('[CMD] Erro:', e.message); }
})();

// Bot
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, () => {
    console.log(`[BOT] Online como ${client.user.tag}`);
    client.user.setActivity('🔑 Wexize Keys', { type: 2 });
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const isAdmin = ADMIN_IDS.includes(interaction.user.id) ||
        interaction.member?.roles?.cache?.some(r => r.name === (process.env.ADMIN_ROLE || 'Owner'));
    const publicCmds = ['usar_key', 'verificar_key'];
    if (!isAdmin && !publicCmds.includes(interaction.commandName))
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });

    if (interaction.commandName === 'gerar_key') {
        await interaction.deferReply({ ephemeral: true });
        const dias = interaction.options.getString('dias');
        const qtd  = interaction.options.getInteger('quantidade');
        const user = interaction.options.getString('usuario') || null;
        const store = await readKeys(); const newKeys = [];
        for (let i = 0; i < qtd; i++) {
            const key = `WEXIZE-${uuidv4().substring(0,8).toUpperCase()}`;
            store.keys.push({ key, duration: dias, username: user, createdAt: new Date().toISOString(),
                activatedAt: null, hwid: null, banned: false, banReason: '', role: 'User', createdBy: interaction.user.id });
            newKeys.push(key);
        }
        await writeKeys(store);
        const embed = new EmbedBuilder().setTitle('🔑 Keys Geradas').setColor(COLOR.primary)
            .addFields({name:'�� Qtd',value:`**${qtd}**`,inline:true},{name:'⏳ Duração',value:dias==='9999'?'♾️ Vitalício':`📅 ${dias}d`,inline:true},
                {name:'👤 Usuário',value:user||'—',inline:true},{name:'🗝️ Chaves',value:`\`\`\`\n${newKeys.join('\n')}\n\`\`\``})
            .setFooter({text:`Wexize • ${interaction.user.username}`}).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'usar_key') {
        await interaction.deferReply({ ephemeral: true });
        const keyInput = interaction.options.getString('key');
        const store = await readKeys(); const found = store.keys.find(k => k.key === keyInput);
        if (!found) return interaction.editReply({ content: `❌ Key \`${keyInput}\` não encontrada.` });
        if (found.banned) return interaction.editReply({ content: `🚫 Key banida. Motivo: ${found.banReason||'N/A'}` });
        if (isKeyExpired(found)) return interaction.editReply({ content: `❌ Key expirada.` });
        if (found.activatedAt) {
            return interaction.editReply({ content: `✅ Key já ativa!\nExpira em: **${expiresAt(found)}**` });
        }
        found.activatedAt = new Date().toISOString(); await writeKeys(store);
        const embed = new EmbedBuilder().setTitle('✅ Key Ativada!').setColor(COLOR.success)
            .addFields({name:'🔑 Key',value:`\`${keyInput}\``,inline:true},{name:'📅 Expira',value:expiresAt(found)})
            .setFooter({text:'Wexize'}).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'verificar_key') {
        await interaction.deferReply({ ephemeral: true });
        const keyInput = interaction.options.getString('key');
        const store = await readKeys(); const found = store.keys.find(k => k.key === keyInput);
        if (!found) return interaction.editReply({ content: `❌ Key \`${keyInput}\` inválida.` });
        const embed = new EmbedBuilder().setTitle('🔍 Verificação').setColor(isKeyExpired(found)?COLOR.error:COLOR.info)
            .addFields({name:'🔑 Key',value:`\`${keyInput}\``,inline:false},{name:'📊 Status',value:statusEmoji(found),inline:true},
                {name:'⏳ Duração',value:found.duration==='9999'?'♾️ Lifetime':`${found.duration}d`,inline:true},
                {name:'👤 Usuário',value:found.username||'—',inline:true},{name:'📅 Expira',value:expiresAt(found),inline:true},
                {name:'🖥️ HWID',value:found.hwid?`\`${found.hwid.substring(0,16)}...\``:'—',inline:true})
            .setFooter({text:'Wexize'}).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'listar_keys') {
        await interaction.deferReply({ ephemeral: true });
        const filtro = interaction.options.getString('filtro') || 'all';
        const store = await readKeys(); let keys = store.keys;
        if (filtro==='active') keys = keys.filter(k => !isKeyExpired(k) && k.activatedAt && !k.banned);
        if (filtro==='expired') keys = keys.filter(k => isKeyExpired(k));
        if (filtro==='pending') keys = keys.filter(k => !k.activatedAt);
        if (!keys.length) return interaction.editReply({ content: `📭 Nenhuma key (filtro: ${filtro}).` });
        let list = keys.map(k => `${isKeyExpired(k)?'❌':(k.activatedAt?'✅':'⏳')}${k.hwid?'🔒':'  '} \`${k.key}\` ${k.duration==='9999'?'LT':`${k.duration}d`}${k.username?` [${k.username}]`:''}`).join('\n');
        if (list.length > 1900) list = list.substring(0,1890) + '\n...';
        const embed = new EmbedBuilder().setTitle(`📋 Keys (${keys.length})`).setColor(COLOR.info)
            .addFields({name:'Lista',value:list||'—'}).setFooter({text:'Wexize'}).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'remover_key') {
        await interaction.deferReply({ ephemeral: true });
        const key = interaction.options.getString('key');
        const store = await readKeys(); const before = store.keys.length;
        store.keys = store.keys.filter(k => k.key !== key);
        if (store.keys.length === before) return interaction.editReply({ content: `❌ Key não encontrada.` });
        await writeKeys(store);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Removida').setColor(COLOR.error).setDescription(`Key \`${key}\` removida.`).setTimestamp()] });
    }

    if (interaction.commandName === 'resetar_hwid') {
        await interaction.deferReply({ ephemeral: true });
        const key = interaction.options.getString('key');
        const store = await readKeys(); const found = store.keys.find(k => k.key === key);
        if (!found) return interaction.editReply({ content: `❌ Key não encontrada.` });
        found.hwid = null; await writeKeys(store);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔄 HWID Resetado').setColor(COLOR.warning)
            .setDescription(`HWID da key \`${key}\` resetado.`).setTimestamp()] });
    }

    if (interaction.commandName === 'banir_key') {
        await interaction.deferReply({ ephemeral: true });
        const key = interaction.options.getString('key');
        const motivo = interaction.options.getString('motivo') || 'Sem motivo';
        const store = await readKeys(); const found = store.keys.find(k => k.key === key);
        if (!found) return interaction.editReply({ content: `❌ Key não encontrada.` });
        found.banned = true; found.banReason = motivo; await writeKeys(store);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🚫 Key Banida').setColor(COLOR.error)
            .addFields({name:'🔑 Key',value:`\`${key}\``,inline:true},{name:'📝 Motivo',value:motivo}).setTimestamp()] });
    }

    if (interaction.commandName === 'stats') {
        await interaction.deferReply({ ephemeral: true });
        const store = await readKeys(); const k = store.keys;
        const embed = new EmbedBuilder().setTitle('📊 Estatísticas').setColor(COLOR.primary)
            .addFields(
                {name:'📦 Total',value:`${k.length}`,inline:true},
                {name:'✅ Ativas',value:`${k.filter(x=>!isKeyExpired(x)&&x.activatedAt&&!x.banned).length}`,inline:true},
                {name:'⏳ Pendentes',value:`${k.filter(x=>!x.activatedAt).length}`,inline:true},
                {name:'❌ Expiradas',value:`${k.filter(x=>isKeyExpired(x)).length}`,inline:true},
                {name:'🚫 Banidas',value:`${k.filter(x=>x.banned).length}`,inline:true},
                {name:'🔒 HWID',value:`${k.filter(x=>x.hwid).length}`,inline:true}
            ).setFooter({text:'Wexize Key System'}).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
    }
});

console.log('[BOT] Iniciando login no Discord...');
client.login(TOKEN)
    .then(() => console.log('[BOT] Login OK'))
    .catch(err => { console.error('[BOT] ERRO LOGIN:', err.message); process.exit(1); });