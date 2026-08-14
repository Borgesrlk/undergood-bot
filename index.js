// HTTP keep-alive para Render.com
const http = require('http');
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); })
    .listen(process.env.PORT || 3000);
// ─────────────────────────────────────────────────────────────────────────────
//  Undergood – Discord Key Bot
//  Gerencia keys no GitHub Gist via comandos slash
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const {
    Client, GatewayIntentBits, EmbedBuilder,
    SlashCommandBuilder, REST, Routes, Events
} = require('discord.js');
const https  = require('https');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const TOKEN     = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const ADMIN_ID  = process.env.ADMIN_ID;
const GUILD_ID  = process.env.GUILD_ID;
const GIST_ID   = process.env.GIST_ID;
const GH_TOKEN  = process.env.GITHUB_TOKEN;

// ── Cores do embed ────────────────────────────────────────────────────────────
const COLOR = {
    primary:  0x8864FF,
    success:  0x00FF88,
    error:    0xFF4455,
    warning:  0xFFAA00,
    info:     0x4488FF
};

// ── GitHub Gist helpers ───────────────────────────────────────────────────────
function ghRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const options = {
            hostname: 'api.github.com',
            path,
            method,
            headers: {
                'Authorization': `token ${GH_TOKEN}`,
                'Accept':        'application/vnd.github+json',
                'User-Agent':    'UndergoodBot',
                'Content-Type':  'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            }
        };
        const req = https.request(options, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                try   { resolve(JSON.parse(raw)); }
                catch { resolve(raw); }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function readKeys() {
    try {
        const gist    = await ghRequest('GET', `/gists/${GIST_ID}`);
        const content = gist.files['keys.json'].content;
        return JSON.parse(content);
    } catch (e) {
        console.error('[Gist] Erro ao ler:', e.message);
        return { keys: [] };
    }
}

async function writeKeys(data) {
    try {
        await ghRequest('PATCH', `/gists/${GIST_ID}`, {
            files: { 'keys.json': { content: JSON.stringify(data, null, 2) } }
        });
    } catch (e) {
        console.error('[Gist] Erro ao salvar:', e.message);
    }
}

// ── Helpers de expiração ──────────────────────────────────────────────────────
function isKeyExpired(keyObj) {
    if (keyObj.duration === '9999') return false;
    if (!keyObj.activatedAt)        return false;
    const dias        = parseInt(keyObj.duration, 10);
    const activatedMs = new Date(keyObj.activatedAt).getTime();
    const expiresMs   = activatedMs + dias * 24 * 60 * 60 * 1000;
    return Date.now() > expiresMs;
}

function expiresAt(keyObj) {
    if (keyObj.duration === '9999') return '♾️ Nunca';
    if (!keyObj.activatedAt)        return '⏳ Aguardando primeiro uso';
    const dias        = parseInt(keyObj.duration, 10);
    const activatedMs = new Date(keyObj.activatedAt).getTime();
    const expiresDate = new Date(activatedMs + dias * 24 * 60 * 60 * 1000);
    return expiresDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function statusEmoji(keyObj) {
    if (isKeyExpired(keyObj))     return '❌ Expirada';
    if (!keyObj.activatedAt)      return '⏳ Aguardando uso';
    if (keyObj.hwid)              return '🔒 Ativa + HWID vinculado';
    return '✅ Ativa';
}

// ── Comandos Slash ────────────────────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder()
        .setName('gerar_key')
        .setDescription('🔑 Gera novas chaves de acesso (Admin)')
        .addStringOption(o =>
            o.setName('dias').setDescription('Duração da chave').setRequired(true)
             .addChoices(
                { name: '1 Dia',     value: '1'    },
                { name: '7 Dias',    value: '7'    },
                { name: '30 Dias',   value: '30'   },
                { name: 'Vitalício', value: '9999' }
             ))
        .addIntegerOption(o =>
            o.setName('quantidade').setDescription('Quantidade (1-99)').setMinValue(1).setMaxValue(99).setRequired(true))
        .addStringOption(o =>
            o.setName('usuario').setDescription('Nome de usuário associado (opcional)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('listar_keys')
        .setDescription('📋 Lista todas as chaves geradas')
        .addStringOption(o =>
            o.setName('filtro').setDescription('Filtrar por status').setRequired(false)
             .addChoices(
                { name: 'Todas',           value: 'all'     },
                { name: 'Ativas',          value: 'active'  },
                { name: 'Expiradas',       value: 'expired' },
                { name: 'Não Ativadas',    value: 'pending' }
             )),

    new SlashCommandBuilder()
        .setName('remover_key')
        .setDescription('🗑️ Remove uma chave existente')
        .addStringOption(o => o.setName('key').setDescription('Chave a remover').setRequired(true)),

    new SlashCommandBuilder()
        .setName('verificar_key')
        .setDescription('🔍 Verifica se uma chave é válida')
        .addStringOption(o => o.setName('key').setDescription('Chave a verificar').setRequired(true)),

    new SlashCommandBuilder()
        .setName('usar_key')
        .setDescription('✅ Ativa uma chave (inicia a contagem do tempo)')
        .addStringOption(o => o.setName('key').setDescription('Chave a ativar').setRequired(true)),

    new SlashCommandBuilder()
        .setName('resetar_hwid')
        .setDescription('🔄 Reseta o HWID vinculado a uma key (Admin)')
        .addStringOption(o => o.setName('key').setDescription('Chave para resetar HWID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('banir_key')
        .setDescription('🚫 Bane uma key (Admin)')
        .addStringOption(o => o.setName('key').setDescription('Chave a banir').setRequired(true))
        .addStringOption(o => o.setName('motivo').setDescription('Motivo do ban').setRequired(false)),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('📊 Estatísticas das chaves (Admin)'),

].map(c => c.toJSON());

// ── Registrar comandos ────────────────────────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
    try {
        console.log('Registrando comandos (/)...');
        if (GUILD_ID)
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        else
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Comandos registrados!');
    } catch (e) { console.error('[Register]', e); }
})();

// ── Discord Client ────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const ADMIN_IDS = process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(',').map(id => id.trim())
    : [ADMIN_ID];

client.once(Events.ClientReady, () => {
    console.log(`✅ Bot online como ${client.user.tag}`);
    client.user.setActivity('🔑 Undergood Keys', { type: 2 }); // Listening
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const isAdmin = ADMIN_IDS.includes(interaction.user.id) ||
        interaction.member?.roles?.cache?.some(r => r.name === (process.env.ADMIN_ROLE || 'Owner'));

    // Comandos que qualquer um pode usar
    const publicCommands = ['usar_key', 'verificar_key'];

    if (!isAdmin && !publicCommands.includes(interaction.commandName))
        return interaction.reply({ content: '❌ Você não tem permissão para usar este comando.', ephemeral: true });

    // ── /gerar_key ────────────────────────────────────────────────────────────
    if (interaction.commandName === 'gerar_key') {
        await interaction.deferReply({ ephemeral: true });

        const dias     = interaction.options.getString('dias');
        const qtd      = interaction.options.getInteger('quantidade');
        const username = interaction.options.getString('usuario') || null;
        const store    = await readKeys();
        const newKeys  = [];

        for (let i = 0; i < qtd; i++) {
            const key = `Undergood-${uuidv4().substring(0, 8).toUpperCase()}`;
            store.keys.push({
                key,
                duration:    dias,
                username:    username,
                createdAt:   new Date().toISOString(),
                activatedAt: null,
                hwid:        null,
                banned:      false,
                banReason:   '',
                role:        'User',
                createdBy:   interaction.user.id
            });
            newKeys.push(key);
        }

        await writeKeys(store);

        const durLabel = dias === '9999' ? '♾️ Vitalício' : `📅 ${dias} dia(s)`;

        const embed = new EmbedBuilder()
            .setTitle('🔑 Keys Geradas')
            .setColor(COLOR.primary)
            .addFields(
                { name: '🔢 Quantidade',  value: `**${qtd}**`,    inline: true },
                { name: '⏳ Duração',      value: durLabel,        inline: true },
                { name: '👤 Usuário',      value: username || '—', inline: true },
                { name: '🗝️ Chaves',
                  value: `\`\`\`\n${newKeys.join('\n')}\n\`\`\`` }
            )
            .setFooter({ text: `Undergood • Gerado por ${interaction.user.username}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    // ── /usar_key ─────────────────────────────────────────────────────────────
    if (interaction.commandName === 'usar_key') {
        await interaction.deferReply({ ephemeral: true });

        const keyInput = interaction.options.getString('key');
        const store    = await readKeys();
        const found    = store.keys.find(k => k.key === keyInput);

        if (!found)
            return interaction.editReply({ content: `❌ Key \`${keyInput}\` não encontrada.` });

        if (found.banned)
            return interaction.editReply({ content: `🚫 Key **banida**. Motivo: ${found.banReason || 'N/A'}` });

        if (isKeyExpired(found))
            return interaction.editReply({ content: `❌ Key \`${keyInput}\` **expirada**.` });

        if (found.activatedAt) {
            const durLabel = found.duration === '9999' ? '♾️ Vitalício' : `${found.duration} dia(s)`;
            const embed = new EmbedBuilder()
                .setTitle('✅ Key já ativa')
                .setColor(COLOR.success)
                .addFields(
                    { name: '🔑 Key',      value: `\`${keyInput}\``,     inline: true },
                    { name: '⏳ Duração',   value: durLabel,              inline: true },
                    { name: '📅 Expira em', value: expiresAt(found) }
                )
                .setFooter({ text: 'Undergood' }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // Primeira ativação
        found.activatedAt = new Date().toISOString();
        await writeKeys(store);

        const durLabel = found.duration === '9999' ? '♾️ Vitalício' : `${found.duration} dia(s)`;
        const embed = new EmbedBuilder()
            .setTitle('✅ Key Ativada!')
            .setColor(COLOR.success)
            .setDescription('Sua key foi ativada com sucesso. Agora você pode utilizá-la no loader.')
            .addFields(
                { name: '🔑 Key',      value: `\`${keyInput}\``, inline: true },
                { name: '⏳ Duração',   value: durLabel,          inline: true },
                { name: '📅 Expira em', value: expiresAt(found) }
            )
            .setFooter({ text: 'Undergood' }).setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    // ── /verificar_key ────────────────────────────────────────────────────────
    if (interaction.commandName === 'verificar_key') {
        await interaction.deferReply({ ephemeral: true });

        const keyInput = interaction.options.getString('key');
        const store    = await readKeys();
        const found    = store.keys.find(k => k.key === keyInput);

        if (!found)
            return interaction.editReply({ content: `❌ Key \`${keyInput}\` **inválida** ou não encontrada.` });

        const dur    = found.duration === '9999' ? '♾️ Vitalício' : `${found.duration} dia(s)`;
        const status = statusEmoji(found);
        const hwid   = found.hwid ? `\`${found.hwid.substring(0, 16)}...\`` : '—';

        const embed = new EmbedBuilder()
            .setTitle('🔍 Verificação de Key')
            .setColor(isKeyExpired(found) ? COLOR.error : COLOR.info)
            .addFields(
                { name: '🔑 Key',       value: `\`${keyInput}\``, inline: false },
                { name: '📊 Status',    value: status,            inline: true  },
                { name: '⏳ Duração',   value: dur,               inline: true  },
                { name: '👤 Usuário',   value: found.username || '—', inline: true },
                { name: '📅 Expira em', value: expiresAt(found),  inline: true  },
                { name: '🖥️ HWID',      value: hwid,              inline: true  },
                { name: '🛡️ Papel',     value: found.role || 'User', inline: true }
            )
            .setFooter({ text: 'Undergood' }).setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    // ── /listar_keys ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'listar_keys') {
        await interaction.deferReply({ ephemeral: true });

        const filtro = interaction.options.getString('filtro') || 'all';
        const store  = await readKeys();
        let   keys   = store.keys;

        if (filtro === 'active')  keys = keys.filter(k => !isKeyExpired(k) &&  k.activatedAt && !k.banned);
        if (filtro === 'expired') keys = keys.filter(k => isKeyExpired(k));
        if (filtro === 'pending') keys = keys.filter(k => !k.activatedAt);

        if (!keys.length)
            return interaction.editReply({ content: `📭 Nenhuma key encontrada com filtro: **${filtro}**.` });

        const total  = store.keys.length;
        const active = store.keys.filter(k => !isKeyExpired(k) && k.activatedAt).length;
        const pend   = store.keys.filter(k => !k.activatedAt).length;
        const exp    = store.keys.filter(k => isKeyExpired(k)).length;

        let list = keys.map(k => {
            const dur     = k.duration === '9999' ? 'LT' : `${k.duration}d`;
            const expired = isKeyExpired(k) ? '❌' : (k.activatedAt ? '✅' : '⏳');
            const hwid    = k.hwid ? '🔒' : '  ';
            const user    = k.username ? ` [${k.username}]` : '';
            return `${expired}${hwid} \`${k.key}\` ${dur}${user}`;
        }).join('\n');

        // Divide em chunks de 1900 chars
        const chunks = [];
        while (list.length > 0) {
            const cut = list.lastIndexOf('\n', 1900);
            if (cut === -1 || list.length <= 1900) {
                chunks.push(list);
                break;
            }
            chunks.push(list.substring(0, cut));
            list = list.substring(cut + 1);
        }

        const embed = new EmbedBuilder()
            .setTitle(`📋 Keys — ${filtro === 'all' ? 'Todas' : filtro}`)
            .setColor(COLOR.info)
            .addFields(
                { name: '📦 Total',    value: `${total}`, inline: true },
                { name: '✅ Ativas',   value: `${active}`, inline: true },
                { name: '⏳ Pendentes',value: `${pend}`,  inline: true },
                { name: '❌ Expiradas',value: `${exp}`,   inline: true },
                { name: 'Lista',       value: chunks[0] || '—' }
            )
            .setFooter({ text: `Undergood • ${keys.length} key(s) exibida(s)` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Envia chunks extras como follow-up
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({ content: chunks[i], ephemeral: true });
        }
    }

    // ── /remover_key ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'remover_key') {
        await interaction.deferReply({ ephemeral: true });

        const keyToRemove = interaction.options.getString('key');
        const store       = await readKeys();
        const before      = store.keys.length;
        store.keys        = store.keys.filter(k => k.key !== keyToRemove);

        if (store.keys.length === before)
            return interaction.editReply({ content: `❌ Chave \`${keyToRemove}\` não encontrada.` });

        await writeKeys(store);

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Key Removida')
            .setColor(COLOR.error)
            .setDescription(`Chave \`${keyToRemove}\` removida com sucesso.`)
            .setFooter({ text: 'Undergood' }).setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    // ── /resetar_hwid ─────────────────────────────────────────────────────────
    if (interaction.commandName === 'resetar_hwid') {
        await interaction.deferReply({ ephemeral: true });

        const keyInput = interaction.options.getString('key');
        const store    = await readKeys();
        const found    = store.keys.find(k => k.key === keyInput);

        if (!found)
            return interaction.editReply({ content: `❌ Key \`${keyInput}\` não encontrada.` });

        found.hwid = null;
        await writeKeys(store);

        const embed = new EmbedBuilder()
            .setTitle('🔄 HWID Resetado')
            .setColor(COLOR.warning)
            .setDescription(`HWID da key \`${keyInput}\` foi resetado.\nO próximo login irá vincular um novo HWID.`)
            .setFooter({ text: `Undergood • Reset por ${interaction.user.username}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    // ── /banir_key ────────────────────────────────────────────────────────────
    if (interaction.commandName === 'banir_key') {
        await interaction.deferReply({ ephemeral: true });

        const keyInput = interaction.options.getString('key');
        const motivo   = interaction.options.getString('motivo') || 'Sem motivo';
        const store    = await readKeys();
        const found    = store.keys.find(k => k.key === keyInput);

        if (!found)
            return interaction.editReply({ content: `❌ Key \`${keyInput}\` não encontrada.` });

        found.banned    = true;
        found.banReason = motivo;
        await writeKeys(store);

        const embed = new EmbedBuilder()
            .setTitle('🚫 Key Banida')
            .setColor(COLOR.error)
            .addFields(
                { name: '🔑 Key',    value: `\`${keyInput}\``, inline: true  },
                { name: '📝 Motivo', value: motivo,            inline: false }
            )
            .setFooter({ text: `Undergood • Ban por ${interaction.user.username}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    // ── /stats ────────────────────────────────────────────────────────────────
    if (interaction.commandName === 'stats') {
        await interaction.deferReply({ ephemeral: true });

        const store   = await readKeys();
        const total   = store.keys.length;
        const active  = store.keys.filter(k => !isKeyExpired(k) && k.activatedAt && !k.banned).length;
        const pend    = store.keys.filter(k => !k.activatedAt).length;
        const exp     = store.keys.filter(k => isKeyExpired(k)).length;
        const banned  = store.keys.filter(k => k.banned).length;
        const hwid    = store.keys.filter(k => k.hwid).length;
        const life    = store.keys.filter(k => k.duration === '9999').length;

        const embed = new EmbedBuilder()
            .setTitle('📊 Estatísticas das Keys')
            .setColor(COLOR.primary)
            .addFields(
                { name: '📦 Total',          value: `${total}`, inline: true },
                { name: '✅ Ativas',         value: `${active}`, inline: true },
                { name: '⏳ Aguardando uso', value: `${pend}`,  inline: true },
                { name: '❌ Expiradas',      value: `${exp}`,   inline: true },
                { name: '🚫 Banidas',        value: `${banned}`, inline: true },
                { name: '🔒 HWID Vinculado', value: `${hwid}`,  inline: true },
                { name: '♾️ Vitalícias',     value: `${life}`,  inline: true }
            )
            .setFooter({ text: 'Undergood Key System' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
});

client.login(TOKEN);
