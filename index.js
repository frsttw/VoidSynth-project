require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType, REST, Routes, ApplicationCommandOptionType, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { createCanvas, registerFont } = require('canvas');
const { AttachmentBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Channel, Partials.User, Partials.GuildMember]
});

const COOLDOWN = new Set();
let xpLogConfig = { enabled: false, channelId: null };

const VOICE_REWARD_INTERVAL = 300000;
const VOICE_REWARD_PER_INTERVAL = 83.35;
const CHAT_REWARD_MIN = 3.33;
const CHAT_REWARD_MAX = 6.67;
const LEVEL_UP_REWARD_BASE = 166.67;

const LEVELS = Array.from({ length: 1000 }, (_, i) => (i + 1) * (i + 1) * 100);
let xp = {}, ignoredUsers = {}, customVoiceNames = {}, autoMessageConfig = {}, voiceConfig = {}, leaderboardConfig = {}, welcomeConfig = {}, antinukeConfig = {}, logConfig = {}, autopfpConfig = {}, autoscanpfpConfig = {}, economy = {}, economyLeaderboardConfig = {}, rankingRolesConfig = {}, shopConfig = {}, verifyConfig = {}, wordFilterConfig = {}, updateLogConfig = { channelId: null }, globalConfig = { embedColor: "#000102", banners: { regras: "https://i.imgur.com/LsI8SSq.gif", loja: "https://i.imgur.com/LsI8SSq.gif", rank: "https://i.imgur.com/LsI8SSq.gif", welcome: "https://i.imgur.com/LsI8SSq.gif", voidsms: "https://i.imgur.com/LsI8SSq.gif", moderacao: "https://i.imgur.com/lNjOG8B.jpeg" } }, updateLogBuffer = [], gptConfig = {}, commandsPanelConfig = {}, ticketConfig = {};
let currentPfpSource = {};
let bumpConfig = {};
let gunsConfig = {};
let tagConfig = {};
let voidSmsConfig = { panelChannelId: null, messagesChannelId: null, logChannelId: null };

let commandsList = [];
const spotifyHistory = {};
const voiceXP = {};

const leaderboardPages = {};
const tempVcOwners = new Map();
const autopfpIntervals = new Map();
const autoscanpfpIntervals = new Map();
const autoMessageIntervals = new Map();
const IMAGE_FOLDER_BASE = path.join(process.cwd(), 'autopfp_images');
const MAX_FILES_PER_FOLDER = 1000;

let imageDatabaseConfig = {
    guildId: process.env.IMAGE_DB_GUILD_ID || "",
    categoryId: process.env.IMAGE_DB_CATEGORY_ID || "",
    currentChannelId: "",
    channels: [],
    channelCounts: {},
    hashes: {}
};
const MAX_IMAGES_PER_CHANNEL = 1000;
const UPLOAD_DELAY = 2000;

if (fs.existsSync('./imageDatabaseConfig.json')) {
    try { Object.assign(imageDatabaseConfig, JSON.parse(fs.readFileSync('./imageDatabaseConfig.json', 'utf8'))); } catch(e) {}
}
const saveImageDatabaseConfig = () => fs.writeFileSync('./imageDatabaseConfig.json', JSON.stringify(imageDatabaseConfig, null, 2));
const saveTicketConfig = () => fs.writeFileSync('./ticketConfig.json', JSON.stringify(ticketConfig, null, 2));
if (fs.existsSync('./ticketConfig.json')) {
    try { Object.assign(ticketConfig, JSON.parse(fs.readFileSync('./ticketConfig.json', 'utf8'))); } catch(e) {}
}

async function getOrCreateUploadChannel() {
    const dbGuild = client.guilds.cache.get(imageDatabaseConfig.guildId);
    if (!dbGuild) return null;
    if (imageDatabaseConfig.currentChannelId) {
        const channel = await dbGuild.channels.fetch(imageDatabaseConfig.currentChannelId).catch(() => null);
        if (channel && (imageDatabaseConfig.channelCounts[channel.id] || 0) < MAX_IMAGES_PER_CHANNEL) return channel;
    }
    const channelName = `pfp-db-${imageDatabaseConfig.channels.length + 1}`;
    const newChannel = await dbGuild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: imageDatabaseConfig.categoryId || null
    });
    imageDatabaseConfig.currentChannelId = newChannel.id;
    imageDatabaseConfig.channels.push(newChannel.id);
    imageDatabaseConfig.channelCounts[newChannel.id] = 0;
    saveImageDatabaseConfig();
    return newChannel;
}

async function uploadToDatabase(url) {
    try {
        const channel = await getOrCreateUploadChannel();
        if (!channel) return null;
        const buffer = await new Promise((resolve, reject) => {
            https.get(url, (res) => {
                if (res.statusCode !== 200) return resolve(null);
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            }).on('error', () => resolve(null));
        });
        if (!buffer) return null;

        const hash = crypto.createHash('md5').update(buffer).digest('hex');

        if (imageDatabaseConfig.hashes && imageDatabaseConfig.hashes[hash]) {
            console.log(`🔄 [AutoPFP] Imagem duplicada ignorada (Hash: ${hash})`);
            return false;
        }

        const ext = url.split('.').pop().split('?')[0] || 'png';
        const attachment = new AttachmentBuilder(buffer, { name: `${hash}.${ext}` });
        const msg = await channel.send({ files: [attachment] });

        imageDatabaseConfig.channelCounts[channel.id] = (imageDatabaseConfig.channelCounts[channel.id] || 0) + 1;

        if (!imageDatabaseConfig.hashes) imageDatabaseConfig.hashes = {};
        imageDatabaseConfig.hashes[hash] = msg.attachments.first().url;

        saveImageDatabaseConfig();
        return msg.attachments.first().url;
    } catch (e) { return null; }
}

async function getAllDatabaseImages() {
    let allImages = [];
    for (const channelId of imageDatabaseConfig.channels) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) continue;
        let lastId;
        while (true) {
            const messages = await channel.messages.fetch({ limit: 100, before: lastId });
            if (messages.size === 0) break;
            messages.forEach(msg => {
                msg.attachments.forEach(att => {
                    if (att.contentType?.startsWith('image/')) {
                        allImages.push({
                            url: att.url,
                            name: att.name,
                            channelId: channel.id,
                            messageId: msg.id,
                            hash: att.name.split('.')[0]
                        });
                    }
                });
            });
            lastId = messages.last().id;
            if (messages.size < 100) break;
        }
    }
    return allImages;
}
function migrateExistingFiles() {
    if (!fs.existsSync(IMAGE_FOLDER_BASE)) {
        fs.mkdirSync(IMAGE_FOLDER_BASE, { recursive: true });
    }

    const firstFolder = path.join(IMAGE_FOLDER_BASE, 'folder_1');
    if (!fs.existsSync(firstFolder)) {
        fs.mkdirSync(firstFolder, { recursive: true });
    }

    const items = fs.readdirSync(IMAGE_FOLDER_BASE, { withFileTypes: true });
    for (const item of items) {
        if (item.isFile() && /\.(jpe?g|png|gif)$/i.test(item.name)) {
            const oldPath = path.join(IMAGE_FOLDER_BASE, item.name);
            const newPath = path.join(firstFolder, item.name);
            try {
                fs.renameSync(oldPath, newPath);
                console.log(`📦 [Migração] Movido: ${item.name} -> folder_1`);
            } catch (e) {
                console.error(`❌ [Migração] Erro ao mover ${item.name}:`, e);
            }
        }
    }
}

function getAutoPfpFolders() {
    migrateExistingFiles();
    const folders = fs.readdirSync(IMAGE_FOLDER_BASE, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('folder_'))
        .map(dirent => dirent.name)
        .sort((a, b) => {
            const numA = parseInt(a.split('_')[1]) || 0;
            const numB = parseInt(b.split('_')[1]) || 0;
            return numA - numB;
        });

    if (folders.length === 0) {
        const firstFolder = 'folder_1';
        fs.mkdirSync(path.join(IMAGE_FOLDER_BASE, firstFolder), { recursive: true });
        return [firstFolder];
    }
    return folders;
}

function getTargetFolderForDownload() {
    const folders = getAutoPfpFolders();
    const lastFolder = folders[folders.length - 1];
    const lastFolderPath = path.join(IMAGE_FOLDER_BASE, lastFolder);
    const files = fs.readdirSync(lastFolderPath);

    if (files.length >= MAX_FILES_PER_FOLDER) {
        const nextFolderNum = parseInt(lastFolder.split('_')[1]) + 1;
        const nextFolderName = `folder_${nextFolderNum}`;
        const nextFolderPath = path.join(IMAGE_FOLDER_BASE, nextFolderName);
        fs.mkdirSync(nextFolderPath, { recursive: true });
        return nextFolderPath;
    }
    return lastFolderPath;
}

async function getAllAutoPfpFiles() { return await getAllDatabaseImages(); }

async function updateCommandsPanel(guildId) {
    const config = commandsPanelConfig[guildId];
    if (!config || !config.channelId || !config.messageId) return;

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const channel = await guild.channels.fetch(config.channelId).catch(() => null);
        if (!channel) return;

        const message = await channel.messages.fetch(config.messageId).catch(() => null);
        if (!message) return;

        const filteredCommands = commandsList
            .filter(cmd => !cmd.description.includes("(Admin)"))
            .sort((a, b) => a.name.localeCompare(b.name));
        const commandsDescription = filteredCommands.map(cmd => `<:pureza_i:1482422447444590593> **/${cmd.name}**\n\`${cmd.description || 'Sem descrição'}\``).join('\n\n');

        const embed = new EmbedBuilder()
            .setColor(globalConfig.embedColor)
            .setTitle("Painel de Comandos")
            .setDescription(commandsDescription || "Nenhum comando disponível no momento.")
            .setThumbnail(client.user.displayAvatarURL())
            .setImage("https://i.imgur.com/xcJTgbH.png")
            .setTimestamp();

        await message.edit({ embeds: [embed] });
        console.log(`✅ [Painel] Painel de comandos atualizado na guilda ${guildId}`);
    } catch (e) {
        console.error(`❌ [Painel] Erro ao atualizar painel na guilda ${guildId}:`, e);
    }
}

async function sendAutoMessage(guildId) {
    const config = autoMessageConfig[guildId];
    if (!config || !config.enabled) return;

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const channel = guild.channels.cache.get(config.channelId);
        if (!channel) return;

        let content = config.message;
        if (config.roleId) {
            content = `<@&${config.roleId}> ${content}`;
        }

        await channel.send(content);

        config.lastSent = Date.now();
        saveAutoMessageConfig();
    } catch (e) {
        console.error(`Erro ao enviar mensagem automática na guilda ${guildId}:`, e);
    }
}

function startAutoMessages(guildId) {
    const config = autoMessageConfig[guildId];
    if (!config || !config.enabled) return;

    if (autoMessageIntervals.has(guildId)) {
        clearInterval(autoMessageIntervals.get(guildId));
    }

    const now = Date.now();
    const lastSent = config.lastSent || 0;
    const timeSinceLastSent = now - lastSent;
    const timeLeft = Math.max(0, config.interval - timeSinceLastSent);

    setTimeout(async () => {
        await sendAutoMessage(guildId);

        const intervalId = setInterval(async () => {
            await sendAutoMessage(guildId);
        }, config.interval);

        autoMessageIntervals.set(guildId, intervalId);
    }, timeLeft);
}

function loadConfig(file, configVar, varName) { try { if (fs.existsSync(file)) { Object.assign(configVar, JSON.parse(fs.readFileSync(file, 'utf8'))); console.log(`✅ ${varName} carregado.`); } else { console.log(`⚠️ Arquivo de ${varName} não encontrado.`); } } catch (e) { console.error(`❌ Erro ao carregar ${varName}:`, e); } }
function saveConfig(file, configVar) { try { fs.writeFileSync(file, JSON.stringify(configVar, null, 2)); } catch (e) { console.error(`❌ Erro ao salvar ${file}:`, e); } }
function loadAllConfigs() { loadConfig('./xp.json', xp, 'XP'); loadConfig('./voiceConfig.json', voiceConfig, 'Voz Temporária'); loadConfig('./leaderboard_config.json', leaderboardConfig, 'Leaderboard'); loadConfig('./welcome_config.json', welcomeConfig, 'Boas-vindas'); loadConfig('./logConfig.json', logConfig, 'Logs'); loadConfig('./antinukeConfig.json', antinukeConfig, 'Antinuke'); loadConfig('./autopfpConfig.json', autopfpConfig, 'AutoPFP'); loadConfig('./autoscanpfpConfig.json', autoscanpfpConfig, 'AutoScanPFP'); loadConfig('./economy.json', economy, 'Economia'); loadConfig('./economy_leaderboard_config.json', economyLeaderboardConfig, 'Leaderboard Economia'); loadConfig('./ranking_roles_config.json', rankingRolesConfig, 'Cargos de Ranking'); loadConfig('./xpLogConfig.json', xpLogConfig, 'Logs de XP'); loadConfig('./shop_config.json', shopConfig, 'Loja'); loadConfig('./wordFilterConfig.json', wordFilterConfig, 'Filtro de Palavras'); loadConfig('./global_config.json', globalConfig, 'Config Global'); loadConfig('./autoMessageConfig.json', autoMessageConfig, 'Mensagens Automáticas'); loadConfig('./ignoredUsers.json', ignoredUsers, 'Usuários Ignorados'); loadConfig('./customVoiceNames.json', customVoiceNames, 'Nomes de Voz Customizados'); loadConfig('./updateLogConfig.json', updateLogConfig, 'Config de Logs de Update'); loadConfig('./updateLogBuffer.json', updateLogBuffer, 'Buffer de Logs'); loadConfig('./tell_config.json', voidSmsConfig, 'Tell Config'); loadConfig('./bumpConfig.json', bumpConfig, 'Bump Timer'); loadConfig('./verifyConfig.json', verifyConfig, 'Config de Verificação'); loadConfig('./gptConfig.json', gptConfig, 'ChatGPT'); loadConfig('./tagConfig.json', tagConfig, 'Config de Tag'); loadConfig('./guns_config.json', gunsConfig, 'Guns.lol'); loadConfig('./spotify_history.json', spotifyHistory, 'Histórico Spotify'); loadConfig('./commandsPanelConfig.json', commandsPanelConfig, 'Painel de Comandos'); }
const saveGunsConfig = () => saveConfig('./guns_config.json', gunsConfig);
const saveSpotifyHistory = () => saveConfig('./spotify_history.json', spotifyHistory);
const saveCommandsPanelConfig = () => saveConfig('./commandsPanelConfig.json', commandsPanelConfig);
const saveXP = () => saveConfig('./xp.json', xp);
const saveVoiceConfig = () => saveConfig('./voiceConfig.json', voiceConfig);
const saveLeaderboardConfig = () => saveConfig('./leaderboard_config.json', leaderboardConfig);
const saveWelcomeConfig = () => saveConfig('./welcome_config.json', welcomeConfig);
const saveLogConfig = () => saveConfig('./logConfig.json', logConfig);
const saveAntinukeConfig = () => saveConfig('./antinukeConfig.json', antinukeConfig);
const saveAutoPfpConfig = () => saveConfig('./autopfpConfig.json', autopfpConfig);
const saveAutoScanPfpConfig = () => saveConfig('./autoscanpfpConfig.json', autoscanpfpConfig);
	const saveEconomy = () => saveConfig('./economy.json', economy);
	const saveEconomyLeaderboardConfig = () => saveConfig('./economy_leaderboard_config.json', economyLeaderboardConfig);
const saveRankingRolesConfig = () => saveConfig('./ranking_roles_config.json', rankingRolesConfig);
const saveShopConfig = () => saveConfig('./shop_config.json', shopConfig);
const saveVerifyConfig = () => saveConfig('./verifyConfig.json', verifyConfig);
const saveBumpConfig = () => saveConfig('./bumpConfig.json', bumpConfig);
const saveXPLogConfig = () => saveConfig('./xpLogConfig.json', xpLogConfig);
const saveWordFilterConfig = () => saveConfig('./wordFilterConfig.json', wordFilterConfig);
const saveGlobalConfig = () => saveConfig('./global_config.json', globalConfig);
const saveAutoMessageConfig = () => saveConfig('./autoMessageConfig.json', autoMessageConfig);
const saveIgnoredUsers = () => saveConfig('./ignoredUsers.json', ignoredUsers);
const saveCustomVoiceNames = () => saveConfig('./customVoiceNames.json', customVoiceNames);
const saveUpdateLogConfig = () => saveConfig('./updateLogConfig.json', updateLogConfig);
const saveUpdateLogBuffer = () => saveConfig('./updateLogBuffer.json', updateLogBuffer);
const saveGPTConfig = () => saveConfig('./gptConfig.json', gptConfig);
const saveTagConfig = () => saveConfig('./tagConfig.json', tagConfig);

	function getUser(userId, username) {
	    if (!economy[userId]) {
	        economy[userId] = {
	            username: username,
	            wallet: 0,
	            bank: 0,
	            lastDaily: 0,
	            lastCrash: 0,
	            cooldowns: {}
	        };
	        saveEconomy();
	    }

	    if (economy[userId].username !== username) {
	        economy[userId].username = username;
	        saveEconomy();
	    }
	    return economy[userId];
	}

		function updateUser(userId, data) {
		    if (!economy[userId]) return false;
		    Object.assign(economy[userId], data);
		    saveEconomy();
		    return true;
		}

		function formatDollars(amount) {
		    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
		}

		function getLevel(xp) {
		    let level = 0;
		    while (level < LEVELS.length && xp >= LEVELS[level]) {
		        level++;
		    }
		    return level;
		}

async function addXP(guild, user, channel, interaction = null) {

			    if (user.bot || !guild) return;

			    const guildId = guild.id, userId = user.id;
    if (ignoredUsers[guildId] && ignoredUsers[guildId][userId]) return;
		    if (!xp[guildId]) xp[guildId] = {};

    const cooldownKey = `${guildId}-${userId}`;
    if (COOLDOWN.has(cooldownKey)) return;

    const chatRewardAmount = Math.floor(Math.random() * (CHAT_REWARD_MAX - CHAT_REWARD_MIN + 1)) + CHAT_REWARD_MIN;
    const userData = getUser(userId, user.tag);
    userData.bank += chatRewardAmount;

    const currentXP = xp[guildId][userId] || 0;
    const currentLevel = getLevel(currentXP);

    xp[guildId][userId] = currentXP + Math.floor(Math.random() * 11) + 15;

    const newLevel = getLevel(xp[guildId][userId]);
    if (newLevel > currentLevel) {

        const levelUpReward = LEVEL_UP_REWARD_BASE * newLevel;
        userData.bank += levelUpReward;

        const levelUpEmbed = new EmbedBuilder()
	            .setColor(globalConfig.embedColor)
	            .setAuthor({ name: "Subida de Nível!", iconURL: "https://i.imgur.com/vM8S9z0.png" })
	            .setDescription(`### <a:green:1242502724000546826> Parabéns, ${user}!\nVocê acaba de alcançar o **Nível ${newLevel}**!`)
	            .addFields({ name: "<a:green:1242502724000546826> Recompensa", value: `\`${formatDollars(levelUpReward)}\` adicionados ao seu banco.` })
	            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
	            .setTimestamp();

	        if (interaction && interaction.replied) {
	            interaction.followUp({ embeds: [levelUpEmbed], ephemeral: true }).catch(() => {});
	        } else if (interaction) {
	            interaction.reply({ embeds: [levelUpEmbed], ephemeral: true }).catch(() => {});
	        } else {
	            channel.send({ content: `${user}`, embeds: [levelUpEmbed] })
	                .then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000))
	                .catch(() => {});
	        }
	    }

    updateUser(userId, userData);

if (xpLogConfig.enabled && xpLogConfig.channelId) {
	        const logChannel = guild.channels.cache.get(xpLogConfig.channelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor(globalConfig.embedColor)
                .setAuthor({ name: `Log de Recompensas | ${user.username}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
	                .setDescription(`### Recompensa de Chat
O usuário **${user.username}** interagiu no chat e recebeu suas recompensas!`)
	                .addFields(
	                    { name: "Canal", value: `<#${channel.id}>`, inline: true },
	                    { name: "XP Ganho", value: `\`+${xp[guildId][userId] - currentXP} XP\``, inline: true },
	                    { name: "Dinheiro", value: `\`${formatDollars(chatRewardAmount)}\``, inline: true },
	                    { name: "Nível Atual", value: `\`Lvl ${getLevel(xp[guildId][userId])}\``, inline: true },
	                    { name: "XP Total", value: `\`${xp[guildId][userId]}\``, inline: true }
	                )
                .setFooter({ text: "Void Economy • Logs", iconURL: client.user.displayAvatarURL() })
                .setTimestamp();
            logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }
    }

                        saveXP();

		    COOLDOWN.add(cooldownKey);
		    setTimeout(() => COOLDOWN.delete(cooldownKey), 60000);
		}

function rewardVoiceUsers() {
    const now = Date.now();

    client.guilds.cache.forEach(guild => {
        const guildId = guild.id;

        guild.channels.cache.filter(c => c.type === 2).forEach(channel => {
            const channelId = channel.id;

            channel.members.forEach(member => {
                if (member.user.bot || (ignoredUsers[guildId] && ignoredUsers[guildId][member.id])) return;
                const userId = member.id;

                if (!voiceXP[userId]) voiceXP[userId] = {};
                if (!voiceXP[userId][guildId]) voiceXP[userId][guildId] = {};
                if (!voiceXP[userId][guildId][channelId]) {
                    voiceXP[userId][guildId][channelId] = now;
                    return;
                }

                const lastRewardTime = voiceXP[userId][guildId][channelId];
                const timeElapsed = now - lastRewardTime;

                if (timeElapsed >= VOICE_REWARD_INTERVAL) {
                    const intervals = Math.floor(timeElapsed / VOICE_REWARD_INTERVAL);
                    const rewardAmount = intervals * VOICE_REWARD_PER_INTERVAL;
                    const xpGain = intervals * 50;

                    if (!xp[guildId]) xp[guildId] = {};
                    const currentXP = xp[guildId][userId] || 0;
                    const currentLevel = getLevel(currentXP);
                    xp[guildId][userId] = currentXP + xpGain;
                    saveXP();

                    const userData = getUser(userId, member.user.tag);
                    userData.bank += rewardAmount;

                    const newLevel = getLevel(xp[guildId][userId]);
                    if (newLevel > currentLevel) {
                        const levelUpReward = LEVEL_UP_REWARD_BASE * newLevel;
                        userData.bank += levelUpReward;
                    }

                    updateUser(userId, userData);

                    if (xpLogConfig.enabled && xpLogConfig.channelId) {
                        const logChannel = guild.channels.cache.get(xpLogConfig.channelId);
                        if (logChannel) {
                            const logEmbed = new EmbedBuilder()
                                .setColor(globalConfig.embedColor)
                                .setAuthor({ name: `Log de Recompensas | ${member.user.username}`, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
                                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
	                                .setDescription(`### Recompensa de Voz\nO usuário **${member.user.username}** recebeu recompensas por seu tempo em call!`)
	                                .addFields(
	                                    { name: "Canal", value: `\`${channel.name}\``, inline: true },
	                                    { name: "Tempo", value: `\`${intervals} min\``, inline: true },
	                                    { name: "XP Ganho", value: `\`+${xpGain} XP\``, inline: true },
	                                    { name: "Dinheiro", value: `\`${formatDollars(rewardAmount)}\``, inline: true },
	                                    { name: "Nível Atual", value: `\`Lvl ${getLevel(xp[guildId][userId])}\``, inline: true },
	                                    { name: "XP Total", value: `\`${xp[guildId][userId]}\``, inline: true }
	                                )
                                .setFooter({ text: "Void Economy • Logs", iconURL: client.user.displayAvatarURL() })
                                .setTimestamp();
                            logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                        }
                    }

                    voiceXP[userId][guildId][channelId] = now - (timeElapsed % VOICE_REWARD_INTERVAL);
                }
            });
        });
    });

    for (const userId in voiceXP) {
        for (const guildId in voiceXP[userId]) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) { delete voiceXP[userId][guildId]; continue; }
            for (const channelId in voiceXP[userId][guildId]) {
                const channel = guild.channels.cache.get(channelId);
                if (!channel || !channel.members.has(userId)) {
                    delete voiceXP[userId][guildId][channelId];
                }
            }
            if (Object.keys(voiceXP[userId][guildId]).length === 0) delete voiceXP[userId][guildId];
        }
        if (Object.keys(voiceXP[userId]).length === 0) delete voiceXP[userId];
    }
}

async function handleSetRulesChannel(interaction) {

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
            content: 'Você não tem permissão para usar este comando. Apenas Administradores podem definir as regras do VoidSynth.',
            ephemeral: true
        });
    }

    const channel = interaction.options.getChannel('channel');

    const rulesEmbed = new EmbedBuilder()
        .setColor(globalConfig.embedColor)
        .setTitle('Regras do Servidor')
        .setDescription(
            `> Bem-vindo ao VoidSynth. Para garantir uma experiência positiva para todos os membros, estabelecemos as seguintes regras do servidor:\n\n` +
            `**1.** Seja respeitoso e gentil com os outros.\n` +
            `**2.** Sem spam.\n` +
            `**3.** Não use canais de forma errada. *(ex: enviar sua bio no #midia)*\n` +
            `**4.** Sem conteúdo NSFW ou explícito.\n` +
            `**5.** Sem anúncios não autorizados.\n` +
            `**6.** Respeite a privacidade e não compartilhe informações pessoais.\n` +
            `**7.** Proibido fingir ser outra pessoa ou enganar. *(especialmente fingir ser da staff)*\n` +
            `**8.** Siga os Termos de Serviço do Discord.\n` +
            `**9.** Respeite os moderadores e suas decisões.\n` +
            `**10.** Evite dramas e conflitos.\n` +
            `**11.** Use linguagem apropriada *(insultos raciais são estritamente proibidos)*\n` +
            `**12.** Apenas inglês e português *(Excluindo canais de suporte/tickets)*\n` +
            `**13.** Burlar o auto-mod é estritamente proibido.\n` +
            `**14.** Qualquer tipo de assédio/referência sexual, seja brincadeira ou não, resultará em aviso ou banimento imediato.\n` +
            `**15.** Imagens e conteúdos considerados inapropriados são estritamente proibidos.\n\n` +
            `Se uma regra não estiver listada, use o bom senso; a staff tem o direito de punir por qualquer coisa não listada aqui, se julgar apropriado.`
        );

    try {
        await channel.send({ embeds: [rulesEmbed] });

        await interaction.reply({
            content: `✅ Regras enviadas com sucesso no canal ${channel}!`,
            ephemeral: true
        });
    } catch (error) {
        console.error('Erro ao enviar as regras:', error);
        await interaction.reply({
            content: '❌ Ocorreu um erro ao tentar enviar as regras. Verifique minhas permissões no canal.',
            ephemeral: true
        });
    }
}

	async function handleDaily(interaction) {
	    const userId = interaction.user.id;
	    const user = getUser(userId, interaction.user.tag);
	    const now = Date.now();
	    const oneDay = 24 * 60 * 60 * 1000;

	    if (now - user.lastDaily < oneDay) {
	        const remainingTime = user.lastDaily + oneDay - now;
	        const hours = Math.floor(remainingTime / (1000 * 60 * 60));
	        const minutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
	        const seconds = Math.floor((remainingTime % (1000 * 60)) / 1000);

	        const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
	            .setColor(globalConfig.embedColor)
	            .setTitle("⏳ Resgate Diário")
	            .setDescription(`Você já resgatou sua recompensa diária!\nVolte em **${hours}h ${minutes}m ${seconds}s** para resgatar novamente.`);

	        return interaction.reply({ embeds: [embed] });
	    }

	    const dailyAmount = Math.floor(Math.random() * 500) + 1000;

	    user.bank += dailyAmount;
	    user.lastDaily = now;
	    updateUser(userId, user);

	    const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
	        .setColor(globalConfig.embedColor)
	        .setTitle("<a:green:1242502724000546826> Resgate Diário Concluído!")
	    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
	        .setDescription(`Você resgatou **${formatDollars(dailyAmount)}** e depositou no seu banco.\n\nSeu saldo bancário atual é de **${formatDollars(user.bank)}**.`);

	    return interaction.reply({ embeds: [embed] });
	}

	async function handleBalance(interaction) {
	    const userId = interaction.user.id;
	    const user = getUser(userId, interaction.user.tag);

	    const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
	        .setColor(globalConfig.embedColor)
	        .setTitle(`Carteira de ${interaction.user.tag}`)
	    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
	        .addFields(
	            { name: '<a:green:1242502724000546826> Carteira (Wallet)', value: formatDollars(user.wallet), inline: true },
	            { name: '🏦 Banco (Bank)', value: formatDollars(user.bank), inline: true }
	        )
	        .setFooter({ text: "Use /daily para resgatar dólares diariamente." })
	        .setTimestamp();

	    return interaction.reply({ embeds: [embed] });
	}

	async function handleTransfer(interaction) {
	    const senderId = interaction.user.id;
	    const receiver = interaction.options.getUser('user');
	    const amount = interaction.options.getNumber('amount');

	    if (amount <= 0 || !Number.isInteger(amount)) {
	        return interaction.reply({ content: "A quantia a ser transferida deve ser um número inteiro positivo.", ephemeral: true });
	    }

	    const sender = getUser(senderId, interaction.user.tag);
	    const receiverUser = getUser(receiver.id, receiver.tag);

	    if (sender.bank < amount) {
	        return interaction.reply({ content: `Você não tem ${formatDollars(amount)} no banco para transferir.`, ephemeral: true });
	    }

	    sender.bank -= amount;
	    receiverUser.bank += amount;
	    updateUser(senderId, sender);
	    updateUser(receiver.id, receiverUser);

	    const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
	        .setColor(globalConfig.embedColor)
	        .setTitle("💸 Transferência Concluída")
	        .setDescription(`Você transferiu **${formatDollars(amount)}** do seu banco para ${receiver}.`)
	        .addFields(
	            { name: 'Seu Novo Saldo Bancário', value: formatDollars(sender.bank), inline: true },
	            { name: 'Saldo Bancário do Destinatário', value: formatDollars(receiverUser.bank), inline: true }
	        );

	    return interaction.reply({ embeds: [embed] });
	}

	async function handleCrash(interaction) {
	    const userId = interaction.user.id;
	    const user = getUser(userId, interaction.user.tag);
	    const bet = interaction.options.getNumber('bet');

	    if (bet <= 0 || !Number.isInteger(bet)) {
	        return interaction.reply({ content: "A aposta deve ser um número inteiro positivo.", ephemeral: true });
	    }

	    if (user.wallet < bet) {
	        return interaction.reply({ content: `Você não tem ${formatDollars(bet)} na carteira para apostar.`, ephemeral: true });
	    }

	    const now = Date.now();
	    const cooldownTime = 10000;

	    if (now - user.lastCrash < cooldownTime) {
	        const remainingTime = user.lastCrash + cooldownTime - now;
	        const seconds = Math.ceil(remainingTime / 1000);
	        return interaction.reply({ content: `Você deve esperar ${seconds} segundos antes de jogar Crash novamente.`, ephemeral: true });
	    }

	    user.wallet -= bet;
	    user.lastCrash = now;
	    updateUser(userId, user);

	    const crashPoint = Math.random() < 0.05 ? 1.00 : (Math.random() * 10) + 1.01;
	    let hasCashedOut = false;

	    const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
	        .setColor(globalConfig.embedColor)
	        .setTitle("<a:rocket:1466151179049238549> CRASH - O Foguete está Subindo!")
	        .setDescription(`Aposta: **${formatDollars(bet)}**\nMultiplicador Atual: **1.00x**\n\nClique em "Cash Out" para sacar seus ganhos!`);

	    const cashOutButton = new ButtonBuilder()
	        .setCustomId('crash_cashout')
	        .setLabel('Cash Out (1.00x)')
	        .setStyle(ButtonStyle.Success);

	    const message = await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(cashOutButton)], fetchReply: true });

	    const filter = i => i.customId === 'crash_cashout' && i.user.id === userId;
	    const collector = message.createMessageComponentCollector({ filter, time: 60000 });

	    let multiplier = 1.00;
	    const interval = setInterval(() => {
	        if (hasCashedOut) return clearInterval(interval);

	        multiplier += 0.5;

	        if (multiplier >= crashPoint) {
	            clearInterval(interval);
	            if (!hasCashedOut) {
	                const resultEmbed = new EmbedBuilder().setColor(globalConfig.embedColor)
	                    .setColor(globalConfig.embedColor)
	                    .setTitle("<a:crash:1466151722698408016> CRASH!")
	                    .setDescription(`Você perdeu **${formatDollars(bet)}**.\n\nO foguete explodiu em **${crashPoint.toFixed(2)}x**!`);

	                cashOutButton.setDisabled(true).setLabel('Explodiu!');
	                message.edit({ embeds: [resultEmbed], components: [new ActionRowBuilder().addComponents(cashOutButton)] }).catch(() => {});
	            }
	            collector.stop('crash');
	            return;
	        }

	        embed.setDescription(`Aposta: **${formatDollars(bet)}**\nMultiplicador Atual: **${multiplier.toFixed(2)}x**\n\nClique em "Cash Out" para sacar seus ganhos!`);
	        cashOutButton.setLabel(`Cash Out (${multiplier.toFixed(2)}x)`);
	        message.edit({ embeds: [embed], components: [new ActionRowBuilder().addComponents(cashOutButton)] }).catch(() => {});
	    }, 500);

	    collector.on('collect', async i => {
	        if (hasCashedOut) return i.reply({ content: "Você já sacou!", ephemeral: true });
	        hasCashedOut = true;
	        clearInterval(interval);

	        const winnings = Math.floor(bet * multiplier);
	        const profit = winnings - bet;
	        user.wallet += winnings;
	        updateUser(userId, user);

	        const resultEmbed = new EmbedBuilder().setColor(globalConfig.embedColor)
	            .setColor(globalConfig.embedColor)
	            .setTitle("<a:checkmark_void88:1320743200591188029> CASH OUT!")
	            .setDescription(`Você sacou em **${multiplier.toFixed(2)}x** e ganhou **${formatDollars(winnings)}** (Lucro: ${formatDollars(profit)}).\n\nSeu novo saldo na carteira é de **${formatDollars(user.wallet)}**.`);

	        cashOutButton.setDisabled(true).setLabel(`Sacou em ${multiplier.toFixed(2)}x`);
	        i.update({ embeds: [resultEmbed], components: [new ActionRowBuilder().addComponents(cashOutButton)] });
	        collector.stop('cashout');
	    });

	    collector.on('end', (collected, reason) => {
	        if (reason === 'time') {
	            if (!hasCashedOut) {
	                const resultEmbed = new EmbedBuilder().setColor(globalConfig.embedColor)
	                    .setColor(globalConfig.embedColor)
	                    .setTitle("<a:crash:1466151722698408016> CRASH!")
	                    .setDescription(`Você perdeu **${formatDollars(bet)}**.\n\nO tempo acabou e o foguete explodiu em **${crashPoint.toFixed(2)}x**!`);

	                cashOutButton.setDisabled(true).setLabel('Explodiu!');
	                message.edit({ embeds: [resultEmbed], components: [new ActionRowBuilder().addComponents(cashOutButton)] }).catch(() => {});
	            }
	        } else if (reason === 'crash' && !hasCashedOut) {

	            const resultEmbed = new EmbedBuilder().setColor(globalConfig.embedColor)
	                .setColor(globalConfig.embedColor)
	                .setTitle("<a:crash:1466151722698408016> CRASH!")
	                .setDescription(`Você perdeu **${formatDollars(bet)}**.\n\nO foguete explodiu em **${crashPoint.toFixed(2)}x**!`);

	            cashOutButton.setDisabled(true).setLabel('Explodiu!');
	            message.edit({ embeds: [resultEmbed], components: [new ActionRowBuilder().addComponents(cashOutButton)] }).catch(() => {});
	        }
	    });
	}
async function sendLog(guild, embed) { const config = logConfig[guild.id]; if (!config?.channelId) return; try { const channel = await guild.channels.fetch(config.channelId); if (channel?.isTextBased()) await channel.send({ embeds: [embed] }); } catch (e) {} }
function getLevel(currentXP) { let level = 0; for (let i = 0; i < LEVELS.length; i++) { if (currentXP >= LEVELS[i]) level = i + 1; else break; } return level; }
async function updateRankingRoles(guild) {
    const config = rankingRolesConfig[guild.id];
    if (!config || !config.roleId1 || !config.roleId2 || !config.roleId3) return;

    const guildXP = xp[guild.id] || {};
    const sortedXP = Object.entries(guildXP)
        .sort(([, xpA], [, xpB]) => xpB - xpA)
        .slice(0, 3);

    const topUsers = sortedXP.map(([userId]) => userId);
    const roleIds = [config.roleId1, config.roleId2, config.roleId3];
    const currentTopUsers = config.currentTopUsers || {};

    for (let i = 0; i < 3; i++) {
        const position = i + 1;
        const roleId = roleIds[i];
        const newTopUserId = topUsers[i];
        const oldTopUserId = currentTopUsers[position];

        if (oldTopUserId && oldTopUserId !== newTopUserId) {
            try {
                const oldMember = await guild.members.fetch(oldTopUserId).catch(() => null);
                if (oldMember) {
                    await oldMember.roles.remove(roleId, `Perdeu a posição #${position} no ranking de XP.`);
                    console.log(`[RankingRoles] Cargo #${position} removido de ${oldMember.user.tag}.`);
                }
            } catch (e) {
                console.error(`[RankingRoles] Erro ao remover cargo #${position} de ${oldTopUserId}:`, e);
            }
        }

        if (newTopUserId && newTopUserId !== oldTopUserId) {
            try {
                const newMember = await guild.members.fetch(newTopUserId).catch(() => null);
                if (newMember) {
                    await newMember.roles.add(roleId, `Alcançou a posição #${position} no ranking de XP.`);
                    console.log(`[RankingRoles] Cargo #${position} atribuído a ${newMember.user.tag}.`);
                }
            } catch (e) {
                console.error(`[RankingRoles] Erro ao atribuir cargo #${position} a ${newTopUserId}:`, e);
            }
        }

        if (newTopUserId) {
            currentTopUsers[position] = newTopUserId;
        } else {
            delete currentTopUsers[position];
        }
    }

    config.currentTopUsers = currentTopUsers;
    saveRankingRolesConfig();
}

async function getLeaderboardEmbed(guild, page = 0) {
    const guildXP = xp[guild.id] || {};
    const sortedXP = Object.entries(guildXP).filter(([userId]) => !(ignoredUsers[guild.id] && ignoredUsers[guild.id][userId])).sort(([, xpA], [, xpB]) => xpB - xpA);
    const totalPages = Math.ceil(sortedXP.length / 10) || 1;
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));

    const start = currentPage * 10;
    const end = start + 10;
    const pageXP = sortedXP.slice(start, end);

    const embed = new EmbedBuilder()
        .setColor(globalConfig.embedColor)
        .setTitle("<a:black:1482415076622467183> Rank - " + guild.name)
        .setDescription("### <a:nitro:1465295896936841369> Bônus de Impulso\nQuem der **impulso (boost)** no servidor tem direito a **1.5x mais XP e Dinheiro**!\n\nO XP e o Dinheiro são dropados via **chat de voz**, **interações no chat** e muito mais. Continue ativo para subir no ranking!\n\n### <a:green:1242502724000546826> Cargos de Recompensa\n- **TOP 1:** <@&1434914289143250954>\n- **TOP 2:** <@&1434914684561002506>\n- **TOP 3:** <@&1434914601094348880>\n\n### <a:green:1242502724000546826> Comandos de Economia\n- **/bank** - depósito e saque.\n- **/crash** - aposte seu dinheiro.\n- **/balance** - veja seu saldo.\n- **/daily** - receba uma quantidade de dinheiro diariamente.")
        .setFooter({ text: "Página " + (currentPage + 1) + " de " + totalPages + " • Ranking" })
        .setImage(globalConfig.banners?.rank === 'none' ? null : (globalConfig.banners?.rank || "https://i.imgur.com/LsI8SSq.gif"))
	        .setTimestamp();

    if (sortedXP.length === 0) {
        embed.setDescription("Ninguém ainda ganhou XP neste servidor.");
        return { embeds: [embed], components: [] };
    } else {
        const leftColumn = pageXP.slice(0, 5);
        const rightColumn = pageXP.slice(5, 10);

        const formatEntry = async (userId, userXP, index) => {
            const absoluteIndex = start + index;
            const medal = absoluteIndex === 0 ? "🥇" : absoluteIndex === 1 ? "🥈" : absoluteIndex === 2 ? "🥉" : "**#" + (absoluteIndex + 1) + "**";

            let namePrefix = "";
            let userName = "Usuário Desconhecido";
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    userName = member.user.username;
                    if (member.premiumSince) {
                        namePrefix = "<a:nitro:1465295896936841369> ";
                    }
                } else {

                    if (xp[guild.id] && xp[guild.id][userId]) {
                        delete xp[guild.id][userId];
                        saveXP();
                    }
                    if (economy[userId]) {
                        delete economy[userId];
                        saveEconomy();
                    }
                    console.log(`🗑️ [Auto-Limpeza] Usuário ${userId} removido por não estar no servidor.`);
                    return null;
                }
            } catch (e) {
                return null;
            }

            const userData = economy[userId] || { wallet: 0, bank: 0 };
            const totalMoney = userData.wallet + userData.bank;

            return medal + " " + namePrefix + "**" + userName + "**\n└ <a:xp:1320858569037582336> **Lvl " + getLevel(userXP) + "** | `" + userXP + " XP`\n└ <a:black666:1242505308442595408> **" + formatDollars(totalMoney) + "**";
        };

        const leftResults = await Promise.all(leftColumn.map(([userId, userXP], i) => formatEntry(userId, userXP, i)));
        const rightResults = await Promise.all(rightColumn.map(([userId, userXP], i) => formatEntry(userId, userXP, i + 5)));

        const leftContent = leftResults.filter(content => content !== null);
        const rightContent = rightResults.filter(content => content !== null);

        embed.addFields(
            {
                name: "TOP " + (start + 1) + "-" + (start + 5),
                value: leftContent.join("\n\n") || "—",
                inline: true
            },
            {
                name: "TOP " + (start + 6) + "-" + (start + 10),
                value: rightContent.join("\n\n") || "—",
                inline: true
            }
        );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("lb_prev_" + currentPage)
                .setEmoji('<a:left:1465298232140627969>')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 0),
            new ButtonBuilder()
                .setCustomId("lb_next_" + currentPage)
                .setEmoji('<a:Right:1465298137890422786>')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage >= totalPages - 1)
        );

        return { embeds: [embed], components: [row] };
    }
}
async function updateAllLeaderboards() {

		    for (const guildId in rankingRolesConfig) {
		        const guild = client.guilds.cache.get(guildId);
		        if (guild) {
		            await updateRankingRoles(guild);
		        }
		    }

		    for (const guildId in leaderboardConfig) {
		        const config = leaderboardConfig[guildId];
		        const guild = client.guilds.cache.get(guildId);
		        if (!guild) {
		            delete leaderboardConfig[guildId];
		            saveLeaderboardConfig();
		            continue;
		        }
		        try {
		            const channel = await guild.channels.fetch(config.channelId);
		            const message = await channel.messages.fetch(config.messageId);
		            const lbData = await getLeaderboardEmbed(guild); await message.edit({ embeds: lbData.embeds, components: lbData.components });
		        } catch (e) {
		            if ([10003, 10008, 10004].includes(e.code)) {
		                delete leaderboardConfig[guildId];
		                saveLeaderboardConfig();
		            }
		        }
		    }

		    for (const guildId in economyLeaderboardConfig) {
		        const config = economyLeaderboardConfig[guildId];
		        const guild = client.guilds.cache.get(guildId);
		        if (!guild) {
		            delete economyLeaderboardConfig[guildId];
		            saveEconomyLeaderboardConfig();
		            continue;
		        }
		        try {
		            const channel = await guild.channels.fetch(config.channelId);
		            const message = await channel.messages.fetch(config.messageId);
		            const econData = await getEconomyLeaderboardEmbed(guild); await message.edit({ embeds: econData.embeds, components: econData.components });
		        } catch (e) {
		            if ([10003, 10008, 10004].includes(e.code)) {
		                delete economyLeaderboardConfig[guildId];
		                saveEconomyLeaderboardConfig();
		            }
		        }
		    }
		}

async function getChatGPTResponse(prompt) {
    const apiKey = ';
    const data = JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000
    });

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.openai.com',
            port: 443,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (response.choices && response.choices[0]) {
                        resolve(response.choices[0].message.content.trim());
                    } else {
                        console.error('Erro na resposta da OpenAI:', response);
                        resolve("❌ Desculpe, ocorreu um erro ao processar sua solicitação na API da OpenAI.");
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(data);
        req.end();
    });
}

function sanitizeFileName(fileName) {
    const ext = path.extname(fileName);
    const name = path.basename(fileName, ext);

    const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '_') || 'image';
    return sanitized + ext;
}

async function downloadImage(url) {
    const targetFolder = getTargetFolderForDownload();
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(null);
            }

            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', async () => {
                const buffer = Buffer.concat(chunks);
                const hash = crypto.createHash('md5').update(buffer).digest('hex');

                const allFiles = await getAllAutoPfpFiles();
                for (const file of allFiles) {
                    if (file.name.startsWith(hash)) {
                        return resolve(false);
                    }
                }

                const ext = url.split('.').pop().split('?')[0] || 'png';
                const fileName = `${hash}.${ext}`;
                const filePath = path.join(targetFolder, fileName);

                fs.writeFileSync(filePath, buffer);
                resolve(true);
            });
        }).on('error', (e) => {
            console.error(`Erro ao baixar imagem ${url}:`, e);
            resolve(null);
        });
    });
}

async function cleanupDuplicates() {
    console.log("🧹 [AutoPFP] Iniciando limpeza de duplicatas no banco de dados...");
    const allImages = await getAllDatabaseImages();
    const seenHashes = new Map();
    let removedCount = 0;

    imageDatabaseConfig.hashes = {};

    for (const img of allImages) {
        if (seenHashes.has(img.hash)) {
            try {
                const channel = await client.channels.fetch(img.channelId).catch(() => null);
                if (channel) {
                    const msg = await channel.messages.fetch(img.messageId).catch(() => null);
                    if (msg) {
                        await msg.delete();
                        removedCount++;
                        imageDatabaseConfig.channelCounts[img.channelId]--;
                        console.log(`🗑️ [AutoPFP] Duplicata removida: ${img.hash}`);
                    }
                }
            } catch (e) {
                console.error(`❌ Erro ao remover mensagem duplicada:`, e);
            }
        } else {
            seenHashes.set(img.hash, img.url);
            imageDatabaseConfig.hashes[img.hash] = img.url;
        }
    }

    saveImageDatabaseConfig();
    console.log(`✅ [AutoPFP] Limpeza concluída. ${removedCount} imagens removidas.`);
    return removedCount;
}

function getNextSequentialImage(allFiles, guildId) {
    if (!autopfpConfig[guildId]) autopfpConfig[guildId] = {};
    const config = autopfpConfig[guildId];

    let filteredFiles = allFiles;
    if (config.filter === 'gif') {
        filteredFiles = allFiles.filter(f => f.name.toLowerCase().endsWith('.gif'));
    }

    if (filteredFiles.length === 0) return null;

    let currentIndex = config.lastIndex || 0;
    if (currentIndex >= filteredFiles.length) currentIndex = 0;

    const selectedImage = filteredFiles[currentIndex];

    config.lastIndex = currentIndex + 1;
    saveAutoPfpConfig();

    return selectedImage;
}

async function runAutoPfp(guildId) {
    const config = autopfpConfig[guildId];
    if (!config || !config.enabled || !config.channelId) return;

    try {
        const allFiles = await getAllAutoPfpFiles();
        if (allFiles.length === 0) {
            console.warn(`⚠️ Nenhuma imagem encontrada nas pastas de AutoPFP.`);
            return;
        }

        const channel = await client.channels.fetch(config.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            console.error(`❌ [AutoPFP] Canal ${config.channelId} não encontrado ou não é um canal de texto.`);
            return;
        }

        const IMAGES_TO_SEND = 3;
        let sentCount = 0;

        for (let i = 0; i < IMAGES_TO_SEND; i++) {
            const fileData = getNextSequentialImage(allFiles, guildId);
            if (!fileData) {
                console.warn(`⚠️ Nenhuma imagem correspondente ao filtro encontrada na iteração ${i+1}.`);
                continue;
            }

            let currentFile = fileData.name;
            let imageUrl = fileData.url;

            currentPfpSource[guildId] = {
                channelId: fileData.channelId,
                messageId: fileData.messageId,
                url: fileData.url,
                dbGuildId: imageDatabaseConfig.guildId
            };

            const now = new Date();
            const brtTime = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

            const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
                .setImage(imageUrl)
                .setFooter({ text: `VoidSynth | Postado às ${brtTime}` });

            await channel.send({ embeds: [embed] });
            sentCount++;
        }

        if (sentCount > 0) {
            console.log(`✅ [AutoPFP] Enviadas ${sentCount} imagens para o canal ${channel.id} no servidor ${guildId}`);
        }
    } catch (e) {
        console.error(`❌ Erro no loop AutoPFP para o servidor ${guildId}:`, e);
    }
}

function startAutoPfpLoop(guildId) {
    if (autopfpIntervals.has(guildId)) {
        clearInterval(autopfpIntervals.get(guildId));
    }

    const interval = setInterval(() => runAutoPfp(guildId), 60000);
    autopfpIntervals.set(guildId, interval);
    runAutoPfp(guildId);
}

function stopAutoPfpLoop(guildId) {
    if (autopfpIntervals.has(guildId)) {
        clearInterval(autopfpIntervals.get(guildId));
        autopfpIntervals.delete(guildId);
        return true;
    }
    return false;
}

function restartAllAutoPfpLoops() {
    for (const guildId in autopfpConfig) {
        const config = autopfpConfig[guildId];
        if (config.enabled) {
            startAutoPfpLoop(guildId);
        }
    }
}

async function runAutoScanPfp(guildId) {
    const config = autoscanpfpConfig[guildId];
    if (!config || !config.enabled || !config.scanChannelId || !config.logChannelId) return;

    try {
        const scanChannel = await client.channels.fetch(config.scanChannelId).catch(() => null);
        const logChannel = await client.channels.fetch(config.logChannelId).catch(() => null);

        if (!scanChannel || !scanChannel.isTextBased()) return;

        const messages = await scanChannel.messages.fetch({ limit: 100 });
        let captured = 0;
        let duplicates = 0;
        let errors = 0;

        for (const msg of messages.values()) {
            const imageUrls = new Set();
            msg.attachments.forEach(att => { if (att.contentType?.startsWith('image/')) imageUrls.add(att.url); });
            msg.embeds.forEach(embed => {
                if (embed.image) imageUrls.add(embed.image.url);
                if (embed.thumbnail) imageUrls.add(embed.thumbnail.url);
            });

            for (const url of imageUrls) {
                const result = await uploadToDatabase(url);
                if (result) { captured++; await msg.delete().catch(() => {}); }
                else if (result === false) duplicates++;
                else if (result === null) errors++;
            }
        }

        const cleanedCount = await cleanupDuplicates();

        if (logChannel && logChannel.isTextBased()) {
            const logEmbed = new EmbedBuilder()
                .setColor(globalConfig.embedColor)
                .setTitle('AutoScanPFP: Relatório Periódico')
                .setDescription(`Varredura automática concluída no canal ${scanChannel}.`)
                .addFields(
                    { name: 'Capturadas', value: `\`${captured}\` novas imagens`, inline: true },
                    { name: 'Duplicadas', value: `\`${duplicates + cleanedCount}\` ignoradas/removidas`, inline: true },
                    { name: 'Erros', value: `\`${errors}\` falhas`, inline: true }
                )
                .setFooter({ text: `Executado a cada 12 horas.` })
                .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
        }
    } catch (e) {
        console.error(`❌ Erro no AutoScanPFP para o servidor ${guildId}:`, e);
    }
}

function startAutoScanPfpLoop(guildId) {
    if (autoscanpfpIntervals.has(guildId)) {
        clearInterval(autoscanpfpIntervals.get(guildId));
    }

    runAutoScanPfp(guildId);

    const interval = setInterval(() => runAutoScanPfp(guildId), 43200000);
    autoscanpfpIntervals.set(guildId, interval);
}

function stopAutoScanPfpLoop(guildId) {
    if (autoscanpfpIntervals.has(guildId)) {
        clearInterval(autoscanpfpIntervals.get(guildId));
        autoscanpfpIntervals.delete(guildId);
        return true;
    }
    return false;
}

function restartAllAutoScanPfpLoops() {
    for (const guildId in autoscanpfpConfig) {
        const config = autoscanpfpConfig[guildId];
        if (config.enabled) {
            startAutoScanPfpLoop(guildId);
        }
    }
}

client.on("ready", async () => {

    client.on('presenceUpdate', (oldPresence, newPresence) => {
        if (!newPresence || !newPresence.activities) return;

        const userId = newPresence.userId;
        const spotifyActivity = newPresence.activities.find(
            activity => activity.name === 'Spotify' && activity.type === ActivityType.Listening
        );

        if (spotifyActivity && spotifyActivity.details && spotifyActivity.state && spotifyActivity.assets) {
            const trackName = spotifyActivity.details;
            const artist = spotifyActivity.state;
            const album = spotifyActivity.assets.largeText || 'Desconhecido';
            const albumArtURL = spotifyActivity.assets.largeImage ? `https://i.scdn.co/image/${spotifyActivity.assets.largeImage.replace('spotify:', '')}` : null;

            const currentSong = {
                trackName: trackName,
                artist: artist,
                album: album,
                albumArtURL: albumArtURL,
                listenedAt: Date.now()
            };

            if (!spotifyHistory[userId]) {
                spotifyHistory[userId] = [];
            }

            const userHistory = spotifyHistory[userId];
            if (userHistory.length === 0 || userHistory[0].trackName !== currentSong.trackName || userHistory[0].artist !== currentSong.artist) {
                userHistory.unshift(currentSong);
                if (userHistory.length > 5) {
                    userHistory.pop();
                }
                saveSpotifyHistory();
            }
        }
    });
    client.user.setActivity('.gg/voidsynth', { type: ActivityType.Watching });

    console.log("🔄 [Painel] Iniciando atualização automática dos painéis de comandos...");
    for (const guildId in commandsPanelConfig) {
        updateCommandsPanel(guildId).catch(err => console.error(`❌ Erro ao atualizar painel na guild ${guildId}:`, err));
    }

    if (!fs.existsSync('./economy_leaderboard_config.json')) {
        fs.writeFileSync('./economy_leaderboard_config.json', '{}');
    }
    if (!fs.existsSync('./global_config.json')) {
        fs.writeFileSync('./global_config.json', JSON.stringify({ embedColor: "#000102" }, null, 2));
    }
    if (!fs.existsSync('./tagConfig.json')) {
        fs.writeFileSync('./tagConfig.json', '{}');
    }
    console.log(`✅ Logado como ${client.user.tag}!`);
    loadAllConfigs();

    client.guilds.cache.forEach(async (guild) => {
        if (tagConfig[guild.id]) {
            try {
                const members = await guild.members.fetch();
                members.forEach(member => checkUserTag(member));
                console.log(`🔍 [Tag Check] Verificação inicial concluída no servidor: ${guild.name}`);
            } catch (e) {
                console.error(`Erro ao verificar tags no servidor ${guild.name}:`, e);
            }
        }
    });

    setInterval(() => {
        client.user.setActivity('.gg/voidsynth', { type: ActivityType.Watching });

    console.log("🔄 [Painel] Iniciando atualização automática dos painéis de comandos...");
    for (const guildId in commandsPanelConfig) {
        updateCommandsPanel(guildId).catch(err => console.error(`❌ Erro ao atualizar painel na guild ${guildId}:`, err));
    }
    }, 30000);
    const syncInterval = async () => {
        await rewardVoiceUsers();
        await updateAllLeaderboards();
    };
    syncInterval();
    setInterval(syncInterval, 60000);

	    restartAllAutoPfpLoops();
	    restartAllAutoScanPfpLoops();

    for (const guildId in autoMessageConfig) {
        if (autoMessageConfig[guildId].enabled) {
            startAutoMessages(guildId);
        }
    }

    console.log("✅ Sistemas iniciados.");

    setInterval(() => {
        for (const guildId in commandsPanelConfig) {
            updateCommandsPanel(guildId);
        }
    }, 24 * 60 * 60 * 1000);

    if (updateLogBuffer && updateLogBuffer.length > 0) {
        console.log("📦 [AutoLog] Novas atualizações detectadas no buffer. Iniciando envio automático...");

        for (const guildId in updateLogConfig) {
            const config = updateLogConfig[guildId];
            if (!config || !config.channelId) continue;

            try {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;

                const channel = await guild.channels.fetch(config.channelId).catch(() => null);
                if (channel && channel.isTextBased()) {
                    const embed = new EmbedBuilder()
                        .setColor("#000102")
                        .setAuthor({ name: "VoidSynth | System Update", iconURL: client.user.displayAvatarURL() })
                        .setTitle("Changelog de Atualização")
                        .setDescription("As seguintes alterações foram aplicadas ao núcleo do sistema para melhorar a performance e experiência do usuário.")
                        .setTimestamp()
                        .setFooter({ text: " ", iconURL: guild.iconURL() });

                    const changesText = updateLogBuffer.map(log => `### ${log.title}\n${log.description}`).join('\n\n');
                    embed.addFields({ name: "Alterações Técnicas", value: changesText.substring(0, 1024) });

                    await channel.send({ embeds: [embed] });
                    console.log(`✅ [AutoLog] Log enviado automaticamente para a guilda ${guildId} no canal ${config.channelId}`);
                }
            } catch (e) {
                console.error(`❌ [AutoLog] Erro ao enviar log automático na guilda ${guildId}:`, e);
            }
        }

        updateLogBuffer = [];
        saveUpdateLogBuffer();
        console.log("🧹 [AutoLog] Buffer de logs limpo e salvo após envio automático.");
    }

    commandsList = [
        {
            name: 'spotify',
            description: 'Exibe o perfil e as últimas músicas ouvidas de um usuário no Spotify.',
            options: [
                {
                    name: 'usuario',
                    description: 'O usuário para ver o histórico do Spotify.',
                    type: ApplicationCommandOptionType.User,
                    required: false
                }
            ]
        },
	        { name: 'help', description: 'Exibe a lista de comandos.' },
	        { name: 'paineldecomandos', description: 'Cria um painel estático de comandos para usuários comuns. (Admin)', options: [{ name: 'canal', description: 'O canal onde o painel será enviado.', type: ApplicationCommandOptionType.Channel, required: true }] },
        {
            name: 'settag',
            description: 'Configura a Clan Tag e o cargo para atribuição automática. (Admin)',
            options: [
                {
                    name: 'tag',
                    description: 'A Clan Tag (Guild Tag) que o usuário deve ter.',
                    type: ApplicationCommandOptionType.String,
                    required: true
                },
                {
                    name: 'cargo',
                    description: 'O cargo que será dado ao usuário.',
                    type: ApplicationCommandOptionType.Role,
                    required: true
                }
            ]
        },
        {
            name: 'updatebanner',
            description: 'Altera o banner de um sistema específico. (Admin)',
            options: [
                {
                    name: 'sistema',
                    description: 'O sistema que deseja alterar o banner.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: 'Regras', value: 'regras' },
                        { name: 'Loja', value: 'loja' },
                        { name: 'Rank/Leaderboard', value: 'rank' },
                        { name: 'Boas-vindas (Welcome)', value: 'welcome' },
                        { name: 'Void SMS', value: 'voidsms' },
                        { name: 'Painel de Moderação', value: 'moderacao' }
                    ]
                },
                {
                    name: 'url',
                    description: 'A nova URL da imagem ou GIF do banner. (Escreva "remover" para tirar o banner)',
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        },
		        { name: 'setgpt', description: 'Configura o canal exclusivo para o ChatGPT. (Admin)', options: [{ name: 'canal', description: 'O canal de texto.', type: ApplicationCommandOptionType.Channel, required: true }] },
		        { name: 'msg', description: 'Envia uma mensagem em um canal específico. (Admin)', options: [
		            { name: 'canal', description: 'O canal de texto.', type: ApplicationCommandOptionType.Channel, required: true },
		            { name: 'mensagem', description: 'A mensagem que será enviada.', type: ApplicationCommandOptionType.String, required: true }
		        ]},
        { name: 'updatelog', description: 'Envia o log das últimas atualizações do bot. (Admin)' },
        { name: 'setupdatelog', description: 'Configura o canal para logs automáticos de atualização. (Admin)', options: [{ name: 'channel', description: 'O canal de texto.', type: ApplicationCommandOptionType.Channel, required: true }] },
        {
            name: 'testwelcome',
            description: 'Testa o embed de boas-vindas marcando um usuário específico. (Admin)',
            options: [
                {
                    name: 'usuario',
                    type: ApplicationCommandOptionType.User,
                    description: 'O usuário para simular a entrada.',
                    required: true
                }
            ]
        },
        {
            name: 'ocultrank',
            description: 'Remove um usuário do sistema de XP, economia e ranking. (Admin)',
            options: [
                {
                    name: 'usuario',
                    type: ApplicationCommandOptionType.User,
                    description: 'O usuário a ser ignorado/restaurado (deixe vazio para ver a lista).',
                    required: false
                }
            ]
        },
                { name: 'auto-mensagem', description: 'Configura mensagens automáticas recorrentes. (Admin)', options: [
            { name: 'acao', description: 'Ativar, desativar ou ver config.', type: ApplicationCommandOptionType.String, required: true, choices: [{ name: 'Ativar/Configurar', value: 'on' }, { name: 'Desativar', value: 'off' }, { name: 'Configuração Atual', value: 'status' }] },
            { name: 'canal', description: 'Canal onde a mensagem será enviada.', type: ApplicationCommandOptionType.Channel, required: false },
            { name: 'mensagem', description: 'A mensagem que será enviada.', type: ApplicationCommandOptionType.String, required: false },
            { name: 'intervalo', description: 'Intervalo em minutos.', type: ApplicationCommandOptionType.Integer, required: false, minValue: 1 },
            { name: 'cargo', description: 'Cargo para marcar na mensagem.', type: ApplicationCommandOptionType.Role, required: false }
        ] },
        { name: 'ping', description: 'Exibe a latência do bot.' },
        { name: 'supportpainel', description: 'Envia o painel de suporte/ticket do servidor. (Admin)', options: [
            { name: 'canal', description: 'O canal onde o painel será enviado.', type: ApplicationCommandOptionType.Channel, required: true },
            { name: 'categoria', description: 'A categoria onde os tickets serão criados.', type: ApplicationCommandOptionType.Channel, required: true },
            { name: 'cargo_suporte', description: 'O cargo que terá acesso aos tickets.', type: ApplicationCommandOptionType.Role, required: true },
            { name: 'canal_logs', description: 'O canal onde os logs dos tickets serão enviados.', type: ApplicationCommandOptionType.Channel, required: true }
        ]},
        { name: 'setup-imgdb', description: 'Configura o servidor de banco de imagens. (Admin)', options: [{ name: 'guild_id', description: 'ID do servidor privado.', type: ApplicationCommandOptionType.String, required: true }, { name: 'category_id', description: 'ID da categoria.', type: ApplicationCommandOptionType.String, required: true }] },
        { name: 'rank', description: 'Mostra seu nível e XP atual.' },
        { name: 'rankvoid', description: 'Mostra o canal do Rank (XP e Economia).' },
        { name: 'daily', description: 'Resgate sua recompensa diária de dólares.' },
        { name: 'balance', description: 'Mostra seu saldo de Dollars (carteira e banco).' },
        { name: 'transfer', description: 'Transfere dólares para outro usuário.', options: [{ name: 'user', description: 'O usuário para quem transferir.', type: ApplicationCommandOptionType.User, required: true }, { name: 'amount', description: 'A quantidade de dólares a transferir.', type: ApplicationCommandOptionType.Number, required: true }] },
        { name: 'setruleschannel', description: 'Define o canal e envia o Embed de Regras do servidor Void. (Admin)', options: [{ name: 'channel', description: 'O canal de texto onde as regras serão enviadas.', type: ApplicationCommandOptionType.Channel, required: true }] },
        { name: 'setrankingroles', description: 'Configura os cargos para o Top 1, Top 2 e Top 3 do ranking de XP. (Admin)', options: [
            { name: 'top1_role', description: 'O cargo para o Top 1.', type: ApplicationCommandOptionType.Role, required: true },
            { name: 'top2_role', description: 'O cargo para o Top 2.', type: ApplicationCommandOptionType.Role, required: true },
            { name: 'top3_role', description: 'O cargo para o Top 3.', type: ApplicationCommandOptionType.Role, required: true }
        ] },
        { name: 'crash', description: 'Jogue o famoso Crash e tente multiplicar seus dólares.', options: [{ name: 'bet', description: 'A quantidade de dólares a apostar.', type: ApplicationCommandOptionType.Number, required: true }] },
        { name: 'bank', description: 'Abre o menu do banco para depositar e sacar.' },
        { name: 'avatar', description: 'Mostra o avatar de um usuário.', options: [{ name: 'user', description: 'O usuário.', type: ApplicationCommandOptionType.User, required: false }] },
        { name: 'banner', description: 'Mostra o banner de um usuário.', options: [{ name: 'user', description: 'O usuário.', type: ApplicationCommandOptionType.User, required: false }] },

        { name: 'clear', description: 'Apaga mensagens. (Admin)', options: [{ name: 'amount', description: 'Número de mensagens (1-100).', type: ApplicationCommandOptionType.Integer, required: true, minValue: 1, maxValue: 100 }] },
        { name: 'setrankvoid', description: 'Configura o Rank (XP e Economia). (Admin)', options: [{ name: 'channel', description: 'O canal de texto.', type: ApplicationCommandOptionType.Channel, required: true }] },
        { name: 'setupvoice', description: 'Configura o sistema de voz temporário. (Admin)', options: [{ name: 'channel', description: 'O canal para criar salas.', type: ApplicationCommandOptionType.Channel, required: true }, { name: 'category', description: 'A categoria para as novas salas.', type: ApplicationCommandOptionType.Channel, required: true }] },
        { name: 'vcpanel', description: 'Envia o painel de controle de voz. (Admin)' },
        { name: 'setregister', description: 'Envia a mensagem de registro. (Admin)', options: [{ name: 'channel', description: 'O canal.', type: ApplicationCommandOptionType.Channel, required: true }, { name: 'role', description: 'O cargo a ser concedido.', type: ApplicationCommandOptionType.Role, required: true }, { name: 'gif_url', description: 'URL de uma imagem/GIF (opcional).', type: ApplicationCommandOptionType.String, required: false }] },
        { name: 'setwelcome', description: 'Configura as boas-vindas. (Admin)', options: [{ name: 'channel', description: 'O canal.', type: ApplicationCommandOptionType.Channel, required: true }] },
        { name: 'setlogchannel', description: 'Configura o canal de logs. (Admin)', options: [{ name: 'channel', description: 'O canal.', type: ApplicationCommandOptionType.Channel, required: true }] },
        { name: 'antinuke', description: 'Configura o sistema Antinuke. (Admin)', options: [{ name: 'action', description: 'Ativar ou desativar.', type: ApplicationCommandOptionType.String, required: true, choices: [{ name: 'ativar', value: 'enable' }, { name: 'desativar', value: 'disable' }] }] },
        { name: 'adminpanel', description: 'Envia o painel de moderação estático no canal atual. (Admin)' },
        { name: 'autopfp', description: 'Configura o loop de envio de imagens automáticas (AutoPFP). (Admin)', options: [
            { name: 'action', description: 'Ação a ser executada.', type: ApplicationCommandOptionType.String, required: true, choices: [{ name: 'start', value: 'start' }, { name: 'stop', value: 'stop' }] },
            { name: 'channel', description: 'O canal de texto para o AutoPFP (apenas para "start").', type: ApplicationCommandOptionType.Channel, required: false },
            { name: 'filter', description: 'Tipo de imagens a enviar.', type: ApplicationCommandOptionType.String, required: false, choices: [{ name: 'Todas as Imagens', value: 'all' }, { name: 'Apenas GIFs', value: 'gif' }] }
        ] },
        { name: 'scan-pfp', description: 'Varre um canal em busca de imagens para a pasta AutoPFP. (Admin)', options: [
            { name: 'channel', description: 'O canal para varrer.', type: ApplicationCommandOptionType.Channel, required: true },
            { name: 'limit', description: 'Limite de mensagens para varrer (padrão 100).', type: ApplicationCommandOptionType.Integer, required: false }
        ] },
        { name: 'autoscanpfp', description: 'Configura o scan automático de imagens a cada 12 horas. (Admin)', options: [
            { name: 'acao', description: 'Ativar ou desativar o autoscan.', type: ApplicationCommandOptionType.String, required: true, choices: [{ name: 'Ativar', value: 'on' }, { name: 'Desativar', value: 'off' }] },
            { name: 'canal_scan', description: 'Canal para varrer as imagens.', type: ApplicationCommandOptionType.Channel, required: false },
            { name: 'canal_log', description: 'Canal para enviar os logs do scan.', type: ApplicationCommandOptionType.Channel, required: false }
        ] },
        { name: 'config-loja', description: 'Configura a loja do servidor. (Admin)', options: [
            { name: 'banner', description: 'URL da imagem/GIF do banner da loja.', type: ApplicationCommandOptionType.String, required: true },
            { name: 'cargo1', description: 'Cargo 1', type: ApplicationCommandOptionType.Role, required: true },
            { name: 'preco1', description: 'Preço 1', type: ApplicationCommandOptionType.Number, required: true },
            { name: 'cargo2', description: 'Cargo 2', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco2', description: 'Preço 2', type: ApplicationCommandOptionType.Number, required: false },
            { name: 'cargo3', description: 'Cargo 3', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco3', description: 'Preço 3', type: ApplicationCommandOptionType.Number, required: false },
            { name: 'cargo4', description: 'Cargo 4', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco4', description: 'Preço 4', type: ApplicationCommandOptionType.Number, required: false },
            { name: 'cargo5', description: 'Cargo 5', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco5', description: 'Preço 5', type: ApplicationCommandOptionType.Number, required: false },
            { name: 'cargo6', description: 'Cargo 6', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco6', description: 'Preço 6', type: ApplicationCommandOptionType.Number, required: false },
            { name: 'cargo7', description: 'Cargo 7', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco7', description: 'Preço 7', type: ApplicationCommandOptionType.Number, required: false },
            { name: 'cargo8', description: 'Cargo 8', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco8', description: 'Preço 8', type: ApplicationCommandOptionType.Number, required: false },
            { name: 'cargo9', description: 'Cargo 9', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco9', description: 'Preço 9', type: ApplicationCommandOptionType.Number, required: false },
            { name: 'cargo10', description: 'Cargo 10', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco10', description: 'Preço 10', type: ApplicationCommandOptionType.Number, required: false }
        ] },
        { name: 'editar-loja', description: 'Edita o visual da loja (Banner, Título, Descrição). (Admin)', options: [
{ name: 'message_id', description: 'ID da mensagem da loja a ser editada.', type: ApplicationCommandOptionType.String, required: true },
	            { name: 'banner', description: 'Novo URL do banner ou "remover" para tirar.', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'thumbnail', description: 'Novo URL da thumbnail ou "remover" para tirar.', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'titulo', description: 'Novo título personalizado da loja.', type: ApplicationCommandOptionType.String, required: false },
            { name: 'descricao', description: 'Nova descrição personalizada da loja.', type: ApplicationCommandOptionType.String, required: false }
        ] },
        { name: 'editar-item', description: 'Edita um cargo específico da loja. (Admin)', options: [
            { name: 'message_id', description: 'ID da mensagem da loja.', type: ApplicationCommandOptionType.String, required: true },
            { name: 'item_numero', description: 'Número do item a editar (1-10).', type: ApplicationCommandOptionType.Integer, required: true, minValue: 1, maxValue: 10 },
            { name: 'cargo', description: 'Novo Cargo.', type: ApplicationCommandOptionType.Role, required: false },
            { name: 'preco', description: 'Novo Preço.', type: ApplicationCommandOptionType.Number, required: false },
            { name: 'emoji', description: 'Novo Emoji.', type: ApplicationCommandOptionType.String, required: false }
        ] },
        { name: 'atualizar-loja', description: 'Atualiza o visual de uma loja existente sem mudar os itens. (Admin)', options: [
            { name: 'message_id', description: 'ID da mensagem da loja a ser atualizada.', type: ApplicationCommandOptionType.String, required: true }
        ] },
        { name: 'joinvc', description: 'Conecta o bot ao seu canal de voz e o mantém lá por 24 horas. (Admin)' },
        { name: 'xplog', description: 'Ativa/Desativa os logs de XP em tempo real. (Admin)', options: [{ name: 'status', description: 'Ativar ou Desativar', type: ApplicationCommandOptionType.String, required: true, choices: [{ name: 'Ativar', value: 'on' }, { name: 'Desativar', value: 'off' }] }, { name: 'canal', description: 'Canal para enviar os logs', type: ApplicationCommandOptionType.Channel, required: false }] },
{ name: 'atualizarembedscolor', description: 'Atualiza a cor de todos os embeds do bot. (Admin)', options: [
	            { name: 'cor', description: 'A cor em formato HEX (ex: #000102).', type: ApplicationCommandOptionType.String, required: true }
	        ] },
	        { name: 'verify', description: 'Configura o painel de resgate de cargos. (Admin)', options: [
	            { name: 'titulo', description: 'Título do embed.', type: ApplicationCommandOptionType.String, required: true },
	            { name: 'descricao', description: 'Descrição do embed.', type: ApplicationCommandOptionType.String, required: true },
	            { name: 'cargo1', description: 'Cargo 1', type: ApplicationCommandOptionType.Role, required: true },
	            { name: 'banner', description: 'URL da imagem/GIF do banner.', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'emoji1', description: 'Emoji 1', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'cargo2', description: 'Cargo 2', type: ApplicationCommandOptionType.Role, required: false },
	            { name: 'emoji2', description: 'Emoji 2', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'cargo3', description: 'Cargo 3', type: ApplicationCommandOptionType.Role, required: false },
	            { name: 'emoji3', description: 'Emoji 3', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'cargo4', description: 'Cargo 4', type: ApplicationCommandOptionType.Role, required: false },
	            { name: 'emoji4', description: 'Emoji 4', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'cargo5', description: 'Cargo 5', type: ApplicationCommandOptionType.Role, required: false },
	            { name: 'emoji5', description: 'Emoji 5', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'cargo6', description: 'Cargo 6', type: ApplicationCommandOptionType.Role, required: false },
	            { name: 'emoji6', description: 'Emoji 6', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'cargo7', description: 'Cargo 7', type: ApplicationCommandOptionType.Role, required: false },
	            { name: 'emoji7', description: 'Emoji 7', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'cargo8', description: 'Cargo 8', type: ApplicationCommandOptionType.Role, required: false },
	            { name: 'emoji8', description: 'Emoji 8', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'cargo9', description: 'Cargo 9', type: ApplicationCommandOptionType.Role, required: false },
	            { name: 'emoji9', description: 'Emoji 9', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'cargo10', description: 'Cargo 10', type: ApplicationCommandOptionType.Role, required: false },
	            { name: 'emoji10', description: 'Emoji 10', type: ApplicationCommandOptionType.String, required: false }
	        ] },
	        { name: 'edit-verify', description: 'Edita um painel de verificação existente. (Admin)', options: [
{ name: 'message_id', description: 'ID da mensagem do painel.', type: ApplicationCommandOptionType.String, required: true },
		            { name: 'banner', description: 'Novo URL do banner ou "remover" para tirar.', type: ApplicationCommandOptionType.String, required: false },
		            { name: 'thumbnail', description: 'Novo URL da thumbnail ou "remover" para tirar.', type: ApplicationCommandOptionType.String, required: false },
		            { name: 'titulo', description: 'Novo título.', type: ApplicationCommandOptionType.String, required: false },
	            { name: 'descricao', description: 'Nova descrição.', type: ApplicationCommandOptionType.String, required: false }
	        ] },
        { name: 'filtro', description: 'Configura o filtro de palavras do servidor. (Admin)', options: [
            { name: 'acao', description: 'Adicionar ou remover palavra.', type: ApplicationCommandOptionType.String, required: true, choices: [{ name: 'Adicionar', value: 'add' }, { name: 'Remover', value: 'remove' }, { name: 'Listar', value: 'list' }] },
            { name: 'palavra', description: 'A palavra a ser filtrada (não necessária para "Listar").', type: ApplicationCommandOptionType.String, required: false }
        ] },
        {
            name: 'embed',
            description: 'Cria um embed personalizado. (Admin)',
            options: [
                { name: 'titulo', description: 'O título do embed.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'descricao', description: 'A descrição do embed.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'cor', description: 'A cor do embed em HEX (ex: #FF0000).', type: ApplicationCommandOptionType.String, required: false },
                { name: 'imagem', description: 'URL da imagem do embed.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'arquivo', description: 'Upe um arquivo (imagem, gif ou vídeo) do seu PC.', type: ApplicationCommandOptionType.Attachment, required: false },
                { name: 'thumbnail', description: 'URL da thumbnail do embed.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'rodape', description: 'Texto do rodapé.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'canal', description: 'Canal onde o embed será enviado.', type: ApplicationCommandOptionType.Channel, required: false },
                { name: 'botao_label', description: 'O texto que aparecerá no botão.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'botao_link', description: 'O link (URL) que o botão abrirá.', type: ApplicationCommandOptionType.String, required: false }
            ]
        },
        {
            name: 'edit-embed',
            description: 'Edita um embed já enviado pelo bot. (Admin)',
            options: [
                { name: 'message_id', description: 'O ID da mensagem do embed a ser editado.', type: ApplicationCommandOptionType.String, required: true },
                { name: 'titulo', description: 'O novo título do embed.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'descricao', description: 'A nova descrição do embed.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'cor', description: 'A nova cor do embed em HEX.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'imagem', description: 'Nova URL da imagem.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'arquivo', description: 'Upe um novo arquivo do seu PC.', type: ApplicationCommandOptionType.Attachment, required: false },
                { name: 'thumbnail', description: 'Nova URL da thumbnail.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'rodape', description: 'Novo texto do rodapé.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'canal', description: 'Canal onde a mensagem está (se não for o atual).', type: ApplicationCommandOptionType.Channel, required: false },
                { name: 'botao_label', description: 'Novo texto do botão.', type: ApplicationCommandOptionType.String, required: false },
                { name: 'botao_link', description: 'Novo link do botão.', type: ApplicationCommandOptionType.String, required: false }
            ]
        },
{ name: 'voidsms-config', description: 'Configurar canais do Correio Elegante. (Admin)', options: [{ name: 'tipo', description: 'painel, mensagens ou logs', type: ApplicationCommandOptionType.String, required: true, choices: [{name: 'painel', value: 'painel'}, {name: 'mensagens', value: 'mensagens'}, {name: 'logs', value: 'logs'}]}, { name: 'canal', description: 'O canal', type: ApplicationCommandOptionType.Channel, required: true }] },
	        { name: 'voidsms-painel', description: 'Enviar o painel de Correio Elegante. (Admin)' },
        {
            name: 'bumptime',
            description: 'Configura o painel de timer para o Bump. (Admin)',
            options: [
                { name: 'canal', description: 'Canal onde o painel será enviado.', type: ApplicationCommandOptionType.Channel, required: false },
                { name: 'cargo', description: 'Cargo que será notificado no privado.', type: ApplicationCommandOptionType.Role, required: false }
            ]
        },
        { name: 'scanemoji', description: 'Escaneia um canal em busca de emojis customizados e os adiciona ao servidor. (Admin)', options: [{ name: 'canal', description: 'O canal para escanear.', type: ApplicationCommandOptionType.Channel, required: true }, { name: 'limite', description: 'Número de mensagens para escanear (padrão 100).', type: ApplicationCommandOptionType.Integer, required: false }, { name: 'duplicatas', description: 'Permitir emojis duplicados? (Padrão: Não)', type: ApplicationCommandOptionType.Boolean, required: false }] },
        {
            name: 'copiar-sticker',
            description: 'Copia uma figurinha de uma mensagem para este servidor. (Admin)',
            options: [
                {
                    name: 'message_id',
                    description: 'O ID da mensagem que contém a figurinha.',
                    type: ApplicationCommandOptionType.String,
                    required: true
                },
                {
                    name: 'nome',
                    description: 'O nome que a figurinha terá no servidor.',
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        },
        {
            name: 'downloademoji',
            description: 'Baixa a imagem de um emoji do servidor. (Admin)',
            options: [
                {
                    name: 'emoji',
                    description: 'O emoji que você deseja baixar.',
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        }
        ,{
            name: 'setguns',
            description: 'Configura o canal onde os perfis do guns.lol serão postados. (Admin)',
            options: [
                {
                    name: 'canal',
                    description: 'O canal de destino',
                    type: ApplicationCommandOptionType.Channel,
                    required: true
                }
            ]
        },
        {
            name: 'mygun',
            description: 'Posta seu perfil do guns.lol no canal configurado.',
            options: [
                {
                    name: 'link',
                    description: 'O link do seu perfil (ex: guns.lol/seu-nome)',
                    type: ApplicationCommandOptionType.String,
                    required: true
                },
                {
                    name: 'imagem',
                    description: 'Link de uma imagem ou GIF para o seu embed',
                    type: ApplicationCommandOptionType.String,
                    required: false
                }
            ]
        },
        {
            name: 'pfpfoldernow',
            description: 'Mostra a origem da última imagem enviada pelo AutoPFP. (Admin)'
        }
    ];

    const commands = commandsList;
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        console.log('⏳ Iniciando sincronização instantânea de comandos...');

        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log('   - Comandos globais limpos (para evitar atrasos).');

        const guilds = await client.guilds.fetch();
        for (const [guildId] of guilds) {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
            console.log(`✅ Comandos registrados instantaneamente no servidor: ${guildId}`);
        }

        console.log(`🚀 Sincronização concluída! ${commands.length} comandos ativos.`);
        console.log('💡 Dica: Se ainda não vir, reinicie seu Discord (Ctrl+R).');
    } catch (error) {
        console.error('❌ Erro ao sincronizar comandos:', error);
    }

    });

async function checkUserTag(member) {
    const config = tagConfig[member.guild.id];
    if (!config || !config.tag || !config.roleId) return;

    const clanTag = member.user.primaryGuild?.tag;
    console.log(`[DEBUG TAG] Membro: ${member.user.tag}, primaryGuild: ${member.user.primaryGuild}, Clan Tag: ${clanTag}`);
    const hasTag = clanTag && clanTag === config.tag;

    const role = member.guild.roles.cache.get(config.roleId);
    if (!role) return;

    try {
        if (hasTag) {

            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
                console.log(`✅ [TAG] Cargo ${role.name} adicionado a ${member.user.tag} (Tag: ${clanTag})`);
            }
        } else {

            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
                console.log(`❌ [TAG] Cargo ${role.name} removido de ${member.user.tag} (Tag atual: ${clanTag || 'Nenhuma'})`);
            }
        }
    } catch (e) {
        console.error(`Erro ao gerenciar cargo de tag para ${member.user.tag}:`, e);
    }
}

client.on('guildMemberUpdate', (oldMember, newMember) => {
    checkUserTag(newMember);
});

client.on('userUpdate', (oldUser, newUser) => {

    client.guilds.cache.forEach(async (guild) => {
        try {
            const member = await guild.members.fetch(newUser.id).catch(() => null);
            if (member) checkUserTag(member);
        } catch (e) {}
    });
});

client.on('interactionCreate', async interaction => {

    if (interaction.isCommand() && interaction.commandName === 'spotify') {
        await interaction.deferReply({ ephemeral: false });

        const targetUser = interaction.options.getUser('usuario') || interaction.user;
        const userHistory = spotifyHistory[targetUser.id];

        const embed = new EmbedBuilder()
            .setColor(globalConfig.embedColor)
            .setTitle(`Spotify: ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

        if (!userHistory || userHistory.length === 0) {
            embed.setDescription(`Nenhum registro de atividade no Spotify foi encontrado para o usuário ${targetUser.username}.`);
        } else {
            const latestSong = userHistory[0];

            embed.setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                 .setTitle(latestSong.trackName)
                 .setURL(latestSong.albumArtURL ? latestSong.albumArtURL.replace('i.scdn.co/image/', 'open.spotify.com/track/') : 'https://open.spotify.com/')
                 .setThumbnail(latestSong.albumArtURL || targetUser.displayAvatarURL({ dynamic: true }));

            let description = `**${latestSong.artist}**\n\n**Queue**\n\n`;

            if (userHistory.length > 1) {
                const queueList = userHistory.slice(1).map((song) => {
                    const trackLink = song.albumArtURL ? song.albumArtURL.replace('i.scdn.co/image/', 'open.spotify.com/track/') : 'https://open.spotify.com/';
                    return `**[${song.trackName}](${trackLink})**\n${song.artist}`;
                }).join('\n\n');
                description += queueList;
            } else {
                description += `*Nenhuma música anterior no histórico.*`;
            }

            embed.setDescription(description);
        }

        return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.isCommand() && interaction.commandName === 'settag') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Você precisa de permissão de Administrador para usar este comando.', ephemeral: true });
        }

        const tag = interaction.options.getString('tag');
        const role = interaction.options.getRole('cargo');

        tagConfig[interaction.guildId] = {
            tag: tag,
            roleId: role.id
        };
        saveTagConfig();

        const embed = new EmbedBuilder()
            .setColor(globalConfig.embedColor)
            .setTitle('🏷️ Configuração de Clan Tag')
            .setDescription(`Sistema configurado com sucesso!\n\n**Clan Tag:** \`${tag}\`\n**Cargo:** ${role}`)
            .setFooter({ text: 'O bot verificará automaticamente quando os usuários mudarem a Clan Tag.' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.isCommand() && interaction.commandName === 'setguns') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Você precisa de permissão de Administrador para usar este comando.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('canal');

        if (!gunsConfig[interaction.guildId]) gunsConfig[interaction.guildId] = {};
        gunsConfig[interaction.guildId].channelId = channel.id;
        saveGunsConfig();

        const embed = new EmbedBuilder()
            .setColor(globalConfig.embedColor)
            .setTitle('✅ Configuração Guns.lol')
            .setDescription(`Canal de postagens definido para ${channel}.`)
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.isCommand() && interaction.commandName === 'mygun') {
        const rawLink = interaction.options.getString('link');
        const imageUrl = interaction.options.getString('imagem');

        const gunsRegex = /^(https?:\/\/)?(www\.)?guns\.lol\/([a-zA-Z0-9_.-]+)$/i;
        const match = rawLink.match(gunsRegex);

        if (!match) {
            return interaction.reply({
                content: '❌ Link inválido! Você deve fornecer um link válido do `guns.lol`. Exemplo: `guns.lol/frstt`',
                ephemeral: true
            });
        }

        const username = match[3];
        const shortLink = `guns.lol/${username}`;
        const fullLink = `https://guns.lol/${username}`;

        const config = gunsConfig[interaction.guildId];
        if (!config || !config.channelId) {
            return interaction.reply({
                content: '❌ O canal de postagens ainda não foi configurado pelos administradores. Use `/setguns`.',
                ephemeral: true
            });
        }

        const targetChannel = interaction.guild.channels.cache.get(config.channelId);
        if (!targetChannel) {
            return interaction.reply({
                content: '❌ O canal configurado não foi encontrado. Peça a um admin para reconfigurar com `/setguns`.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(shortLink)
            .setDescription(`${interaction.user}`)
            .setColor(globalConfig.embedColor);

        if (imageUrl) {
            embed.setImage(imageUrl);
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('acessar')
                    .setURL(fullLink)
                    .setStyle(ButtonStyle.Link)
            );

        try {
            await targetChannel.send({ embeds: [embed], components: [row] });
            await interaction.reply({
                content: `✅ Seu perfil foi postado com sucesso em ${targetChannel}!`,
                ephemeral: true
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: '❌ Ocorreu um erro ao tentar postar no canal. Verifique se eu tenho permissão para enviar mensagens lá.',
                ephemeral: true
            });
        }
        return;
    }
    if (interaction.isCommand() && interaction.commandName === 'pfpfoldernow') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Você precisa de permissão de Administrador para usar este comando.', ephemeral: true });
        }

        const source = currentPfpSource[interaction.guildId];

        if (!source) {
            return interaction.reply({
                content: '❌ Nenhuma imagem foi enviada pelo AutoPFP nesta sessão ainda.',
                ephemeral: true
            });
        }

        const dbGuild = client.guilds.cache.get(source.dbGuildId);
        const channel = dbGuild?.channels.cache.get(source.channelId);
        const channelName = channel ? channel.name : 'Canal Desconhecido';

        const embed = new EmbedBuilder()
            .setColor(globalConfig.embedColor)
            .setTitle('Origem da Imagem AutoPFP')
            .setDescription(`A última imagem enviada está armazenada na seguinte pasta do banco de dados:`)
            .addFields(
                { name: 'Pasta (Canal)', value: `\`${channelName}\``, inline: true }
            )
            .setThumbnail(source.url)
            .setFooter({ text: 'VoidSynth Database System' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.isCommand() && interaction.commandName === 'bumptime') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Você precisa de permissão de Administrador para usar este comando.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('canal') || interaction.channel;
        const role = interaction.options.getRole('cargo');

        const embed = new EmbedBuilder()
            .setColor(globalConfig.embedColor)
            .setTitle('<a:rocket:1466151179049238549> Sistema de Bump')
            .setDescription('Clique no botão abaixo para iniciar o timer de **2 horas** para o próximo bump.\n\nQuando o tempo acabar, os responsáveis serão notificados no privado!')
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('bumptime_start')
                .setLabel('Iniciar Timer')
                .setEmoji('⏰')
                .setStyle(ButtonStyle.Primary)
        );

        await channel.send({ embeds: [embed], components: [row] });

        bumpConfig[interaction.guildId] = {
            roleId: role ? role.id : null,
            nextBump: 0,
            notified: true
        };
        saveBumpConfig();

        return interaction.reply({ content: `✅ Painel de Bump configurado em ${channel}${role ? ` com notificação para o cargo ${role}` : ''}.`, ephemeral: true });
    }

    if (interaction.isCommand() && interaction.commandName === 'downloademoji') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Você precisa de permissão de Administrador para usar este comando.', ephemeral: true });
        }

        const emojiInput = interaction.options.getString('emoji');
        const emojiRegex = /<(a?):(\w+):(\d+)>/;
        const match = emojiInput.match(emojiRegex);

        if (!match) {
            return interaction.reply({ content: '❌ Por favor, forneça um emoji válido do servidor.', ephemeral: true });
        }

        const isAnimated = match[1] === 'a';
        const emojiName = match[2];
        const emojiId = match[3];
        const extension = isAnimated ? 'gif' : 'png';
        const url = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?quality=lossless`;

        await interaction.deferReply();

        try {
            const attachment = new AttachmentBuilder(url, { name: `${emojiName}.${extension}` });
            await interaction.editReply({
                content: `✅ Aqui está a imagem do emoji **:${emojiName}:**`,
                files: [attachment]
            });
        } catch (error) {
            console.error('Erro ao baixar emoji:', error);
            await interaction.editReply({ content: '❌ Ocorreu um erro ao tentar baixar a imagem do emoji.' });
        }
        return;
    }

    if (interaction.isCommand() && interaction.commandName === 'copiar-sticker') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Você precisa de permissão de Administrador para usar este comando.', ephemeral: true });
        }

        const messageId = interaction.options.getString('message_id');
        const stickerName = interaction.options.getString('nome');

        await interaction.deferReply({ ephemeral: true });

        try {
            const message = await interaction.channel.messages.fetch(messageId);
            if (!message.stickers || message.stickers.size === 0) {
                return interaction.editReply({ content: '❌ Essa mensagem não contém nenhuma figurinha.' });
            }

            const sticker = message.stickers.first();

            const guildStickers = await interaction.guild.stickers.fetch();
            if (guildStickers.size >= 50) {
                return interaction.editReply({ content: '❌ O servidor atingiu o limite de figurinhas.' });
            }

            const newSticker = await interaction.guild.stickers.create({
                file: sticker.url,
                name: stickerName,
                tags: sticker.tags || 'sticker'
            });

            const embed = new EmbedBuilder()
                .setColor(globalConfig.embedColor)
                .setTitle('✅ Figurinha Copiada!')
                .setDescription(`A figurinha **${stickerName}** foi adicionada com sucesso ao servidor!`)
                .setThumbnail(newSticker.url)
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Erro ao copiar figurinha:', error);
            if (error.code === 10008) {
                return interaction.editReply({ content: '❌ Mensagem não encontrada. Verifique se o ID está correto e se a mensagem está neste canal.' });
            }
            return interaction.editReply({ content: `❌ Ocorreu um erro ao tentar copiar a figurinha: ${error.message}` });
        }
    }
    if (interaction.isButton() && interaction.customId === 'bumptime_start') {
        const config = bumpConfig[interaction.guildId];
        if (!config) return interaction.reply({ content: '❌ Este painel não está configurado corretamente. Use `/bumptime` novamente.', ephemeral: true });

        const now = Date.now();
        if (config.nextBump > now) {
            const timeLeft = config.nextBump - now;
            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            return interaction.reply({ content: `⏳ O timer já está rodando! Faltam **${hours}h ${minutes}m** para o próximo bump.`, ephemeral: true });
        }

        config.nextBump = now + (2 * 60 * 60 * 1000);
        config.notified = false;
        saveBumpConfig();

        const embed = new EmbedBuilder()
            .setColor('#000102')
            .setTitle('⏰ Timer Iniciado!')
            .setDescription(`O timer de 2 horas foi iniciado por ${interaction.user}.\n\nNotificarei os responsáveis quando o bump estiver pronto!`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    if (interaction.isCommand()) {
        if (interaction.commandName === 'voidsms-config') {
            const tipo = interaction.options.getString('tipo');
            const canal = interaction.options.getChannel('canal');
            if (tipo === 'painel') voidSmsConfig.panelChannelId = canal.id;
            else if (tipo === 'mensagens') voidSmsConfig.messagesChannelId = canal.id;
            else voidSmsConfig.logChannelId = canal.id;
            saveVoidSmsConfig();
            return interaction.reply({ content: `✅ Canal de ${tipo} definido para ${canal}`, ephemeral: true });
        }
        if (interaction.commandName === 'voidsms-painel') {
            const embed = new EmbedBuilder()
                .setColor(globalConfig.embedColor)
                .setTitle('<a:1689ringingphone:1477618983724253326> Void SMS')
                .setDescription('**Bem-vindo ao Void SMS!**\n\nEnvie mensagens anônimas ou públicas para outros membros do servidor.\n\n**Como funciona:**\n<a:Seta:1470422235083702520> Clique no botão "Enviar" abaixo\n<a:Seta:1470422235083702520> Escolha o destinatário pelo nome\n<a:Seta:1470422235083702520> Escreva sua mensagem\n<a:Seta:1470422235083702520> Escolha se quer ser anônimo ou não\n<a:Seta:1470422235083702520> Pague **$2.500** do seu banco\n\n**Observações:**\n• Mensagens são entregues em um card visual profissional\n• Você precisa ter saldo suficiente no banco\n• Mensagens anônimas não revelam seu nome\n\n<a:blackheart:1362050539042377758> Aproveite!')
                .setImage(globalConfig.banners?.voidsms === 'none' ? null : (globalConfig.banners?.voidsms || 'https://i.imgur.com/LsI8SSq.gif'));
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('voidsms_send').setLabel('Enviar').setStyle(ButtonStyle.Primary));
            return interaction.reply({ embeds: [embed], components: [row] });
        }
    }
    if (interaction.isButton() && interaction.customId === 'voidsms_send') {
        const modal = new ModalBuilder().setCustomId('voidsms_modal').setTitle('Void SMS - Enviar Mensagem');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('voidsms_recipient').setLabel('Nome do Destinatário').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Digite o nome ou menção')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('voidsms_message').setLabel('Sua Mensagem').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Escreva sua mensagem aqui...')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('voidsms_anonymous').setLabel('Anônimo? (sim/não)').setStyle(TextInputStyle.Short).setValue('não').setRequired(true).setPlaceholder('Digite: sim ou não'))
        );
        return interaction.showModal(modal);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'voidsms_modal') {
        return handleVoidSmsModal(interaction);
    }

    if (interaction.isButton()) {
        const [type, action, currentPageStr] = (interaction.customId || "").split('_');

        if (type === 'ticket') {
            const config = ticketConfig[interaction.guildId];
            if (!config) return interaction.reply({ content: "❌ O sistema de tickets não foi configurado corretamente neste servidor.", ephemeral: true });

            const category = interaction.guild.channels.cache.get(config.categoryId);
            if (!category) return interaction.reply({ content: "❌ A categoria de tickets não foi encontrada.", ephemeral: true });

            const supportRole = interaction.guild.roles.cache.get(config.supportRoleId);
            const ticketType = action === 'support' ? 'Suporte' : 'Orçamento';
            const ticketName = `${ticketType.toLowerCase()}-${interaction.user.username}`;

            const existingChannel = interaction.guild.channels.cache.find(c => c.name === ticketName && c.parentId === category.id);
            if (existingChannel) return interaction.reply({ content: `❌ Você já possui um ticket aberto em ${existingChannel}.`, ephemeral: true });

            await interaction.deferReply({ ephemeral: true });

            try {
                const channel = await interaction.guild.channels.create({
                    name: ticketName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
                        { id: supportRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] }
                    ]
                });

                const embed = new EmbedBuilder()
                    .setColor(globalConfig.embedColor)
                    .setTitle(`VoidSynth | Ticket de ${ticketType}`)
                    .setDescription(`Olá ${interaction.user}, bem-vindo ao seu ticket de **${ticketType}**.\n\nAguarde um momento enquanto nossa equipe de suporte visualiza sua solicitação.\n\n**Assunto:** ${ticketType === 'Suporte' ? 'Dúvidas e Suporte Geral' : 'Orçamento de Bot/Servidor'}`)
                    .setFooter({ text: "Para fechar este ticket, clique no botão abaixo." })
                    .setTimestamp();

                const closeButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger)
                );

                await channel.send({ content: `${interaction.user} | ${supportRole}`, embeds: [embed], components: [closeButton] });

                if (config.logChannelId) {
                    const logChannel = interaction.guild.channels.cache.get(config.logChannelId);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setColor(globalConfig.embedColor)
                            .setTitle("Log: Ticket Aberto")
                            .addFields(
                                { name: "Usuario", value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                                { name: "Tipo", value: ticketType, inline: true },
                                { name: "Canal", value: `${channel.name} (${channel.id})`, inline: false }
                            )
                            .setTimestamp();
                        logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }

                return interaction.editReply({ content: `Seu ticket foi criado com sucesso: ${channel}` });
            } catch (e) {
                console.error(e);
                return interaction.editReply({ content: "❌ Ocorreu um erro ao tentar criar o seu ticket." });
            }
        }

        if (interaction.customId === 'close_ticket') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return interaction.reply({ content: "❌ Apenas membros com permissão de Gerenciar Canais podem fechar tickets.", ephemeral: true });
            }

            const config = ticketConfig[interaction.guildId];
                if (config && config.logChannelId) {
                const logChannel = interaction.guild.channels.cache.get(config.logChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(globalConfig.embedColor)
                        .setTitle("Log: Ticket Fechado")
                        .addFields(
                            { name: "Canal", value: interaction.channel.name, inline: true },
                            { name: "Fechado por", value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }
                        )
                        .setTimestamp();
                    logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }

            await interaction.reply({ content: "O ticket será fechado em 5 segundos..." });
            setTimeout(() => {
                interaction.channel.delete().catch(() => {});
            }, 5000);
            return;
        }        if (type === 'lb' && ['prev', 'next'].includes(action)) {
            const currentPage = parseInt(currentPageStr);
            const newPage = action === 'next' ? currentPage + 1 : currentPage - 1;
            await interaction.deferUpdate();
            const data = await getLeaderboardEmbed(interaction.guild, newPage);
            await interaction.editReply({ embeds: data.embeds, components: data.components });
            return;
        }
    }

    if (interaction.isModalSubmit()) {
        const userId = interaction.user.id;
        const user = getUser(userId, interaction.user.tag);

		        if (interaction.customId === 'modal_deposit') {
		            await interaction.deferReply({ ephemeral: true });
		            const amountStr = interaction.fields.getTextInputValue('deposit_amount').toLowerCase();
		            let amount = amountStr === 'all' ? user.wallet : parseInt(amountStr.replace(/[,.]/g, ''));

		            if (isNaN(amount) || amount <= 0) {
		                return interaction.editReply({ content: 'Por favor, insira um número válido ou "all".' });
		            }
		            if (amount > user.wallet) {
		                return interaction.editReply({ content: `Você não tem ${formatDollars(amount)} para depositar.` });
		            }

		            user.wallet -= amount;
		            user.bank += amount;
		            updateUser(userId, user);

		            const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
		                .setColor(globalConfig.embedColor)
		                .setTitle("<a:checkmark_void88:1320743200591188029> Depósito Realizado")
		        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
		                .setDescription(`Você depositou **${formatDollars(amount)}** no seu banco.`)
		                .addFields(
		                    { name: '<a:green:1242502724000546826> Carteira', value: formatDollars(user.wallet), inline: true },
		                    { name: '🏦 Banco', value: formatDollars(user.bank), inline: true }
		                );
		            await interaction.deleteReply();
		            await interaction.channel.send({ content: `${interaction.user}`, embeds: [embed] });

		            await addXP(interaction.guild, interaction.user, interaction.channel, interaction);

		            return;
		        }

			        if (interaction.customId === 'modal_withdraw') {
			            await interaction.deferReply({ ephemeral: true });
			            const amountStr = interaction.fields.getTextInputValue('withdraw_amount').toLowerCase();
			            let amount = amountStr === 'all' ? user.bank : parseInt(amountStr.replace(/[,.]/g, ''));

			            if (isNaN(amount) || amount <= 0) {
			                return interaction.editReply({ content: 'Por favor, insira um número válido ou "all".' });
			            }
			            if (amount > user.bank) {
			                return interaction.editReply({ content: `Você não tem ${formatDollars(amount)} para sacar.` });
			            }

			            user.bank -= amount;
			            user.wallet += amount;
			            updateUser(userId, user);

			            const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
			                .setColor(globalConfig.embedColor)
			                .setTitle("<a:checkmark_void88:1320743200591188029> Saque Realizado")
			        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
			                .setDescription(`Você sacou **${formatDollars(amount)}** do seu banco.`)
			                .addFields(
			                    { name: '<a:green:1242502724000546826> Carteira', value: formatDollars(user.wallet), inline: true },
			                    { name: '🏦 Banco', value: formatDollars(user.bank), inline: true }
			                );
			            await interaction.deleteReply();
			            await interaction.channel.send({ content: `${interaction.user}`, embeds: [embed] });

			            await addXP(interaction.guild, interaction.user, interaction.channel, interaction);

			            return;
			        }

			        if (interaction.customId.startsWith('modalAdmin_')) {
			            await interaction.deferReply({ ephemeral: true });
			            const subAction = interaction.customId.split('_')[1];
			            const targetId = interaction.fields.getTextInputValue('targetId');
			            const reason = interaction.fields.getTextInputValue('reason');

			            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
			            if (!targetMember && subAction !== 'economy' && subAction !== 'xp') {
			                return interaction.editReply("❌ Não consegui encontrar este membro no servidor.");
			            }

				            const logEmbed = new EmbedBuilder()
				                .setTitle(`<a:_dev1:1329746208553701376> Ação de Moderação: ${subAction.toUpperCase()}`)
				                .setColor(globalConfig.embedColor)
			                .addFields(
			                    { name: "Membro", value: targetMember ? `${targetMember.user.tag} (\`${targetId}\`)` : `ID: \`${targetId}\``, inline: true },
			                    { name: "Staff", value: `${interaction.user.tag}`, inline: true },
			                    { name: "Motivo", value: reason, inline: false }
			                )
			                .setTimestamp();

			            try {
			                switch(subAction) {
			                    case 'ban':
			                        if (!targetMember.bannable) return interaction.editReply("❌ Não posso banir este membro.");
			                        await targetMember.ban({ reason });
			                        break;
			                    case 'kick':
			                        if (!targetMember.kickable) return interaction.editReply("❌ Não posso expulsar este membro.");
			                        await targetMember.kick(reason);
			                        break;
			                    case 'timeout':
			                        const duration = parseInt(interaction.fields.getTextInputValue('duration'));
			                        if (isNaN(duration)) return interaction.editReply("❌ Duração inválida.");
			                        await targetMember.timeout(duration * 60000, reason);
			                        logEmbed.addFields({ name: "Duração", value: `${duration} minutos`, inline: true });
			                        break;
			                    case 'mute':
			                        if (!targetMember.voice.channel) return interaction.editReply("❌ O membro não está em um canal de voz.");
			                        await targetMember.voice.setMute(true, reason);
			                        break;
			                    case 'warn':
			                        await targetMember.send(`⚠️ **Aviso em ${interaction.guild.name}**\n**Motivo:** ${reason}`).catch(() => {});
			                        break;
			                    case 'economy':
			                        const amount = parseFloat(interaction.fields.getTextInputValue('amount'));
			                        if (isNaN(amount)) return interaction.editReply("❌ Quantidade inválida.");
			                        const userData = getUser(targetId, targetMember ? targetMember.user.tag : "Usuário Desconhecido");
			                        userData.bank += amount;
			                        updateUser(targetId, userData);
			                        logEmbed.addFields({ name: "Alteração", value: formatDollars(amount), inline: true });
			                        break;
			                    case 'xp':
			                        const xpAmount = parseInt(interaction.fields.getTextInputValue('amount'));
			                        if (isNaN(xpAmount)) return interaction.editReply("❌ Quantidade de XP inválida.");
			                        if (!xp[interaction.guildId]) xp[interaction.guildId] = {};
			                        xp[interaction.guildId][targetId] = (xp[interaction.guildId][targetId] || 0) + xpAmount;
			                        saveXP();
			                        logEmbed.addFields({ name: "XP Alterado", value: `${xpAmount} XP`, inline: true });
			                        break;
			                }

			                await interaction.editReply(`✅ Ação **${subAction}** executada com sucesso!`);

			                if (logConfig[interaction.guildId]?.channelId) {
			                    const logChannel = interaction.guild.channels.cache.get(logConfig[interaction.guildId].channelId);
			                    if (logChannel) logChannel.send({ embeds: [logEmbed] });
			                }
			            } catch (e) {
			                console.error(e);
			                return interaction.editReply(`❌ Erro ao executar ação: ${e.message}`);
			            }
			            return;
			        }
	    }
	    if (interaction.isButton()) {
if (interaction.customId === 'bank_deposit') {
			            return handleDeposit(interaction);
			        }
			        if (interaction.customId === 'bank_withdraw') {
			            return handleWithdraw(interaction);
			        }

			        const [action] = interaction.customId.split('_');

					        if (interaction.customId === 'crash_cashout') return;

			        const reply = (c, e = true) => interaction.reply({ content: c, ephemeral: e });

			        if (action === 'admin' || action === 'mod') {

			            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
			                return reply("❌ Você não tem permissão de staff para usar este painel.");
			            }

			            if (action === 'admin') {
			                const subAction = interaction.customId.split('_')[1];
			                const modal = new ModalBuilder().setCustomId(`modalAdmin_${subAction}`).setTitle(`Moderação: ${subAction.toUpperCase()}`);

			                const idInput = new TextInputBuilder().setCustomId('targetId').setLabel('ID do Membro').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 123456789012345678').setRequired(true);
			                const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Motivo').setStyle(TextInputStyle.Paragraph).setPlaceholder('Descreva o motivo da ação...').setRequired(true);

			                const rows = [new ActionRowBuilder().addComponents(idInput)];

			                if (subAction === 'timeout') {
			                    const durationInput = new TextInputBuilder().setCustomId('duration').setLabel('Duração (em minutos)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 60').setRequired(true);
			                    rows.push(new ActionRowBuilder().addComponents(durationInput));
			                } else if (subAction === 'economy' || subAction === 'xp') {
			                    const amountInput = new TextInputBuilder().setCustomId('amount').setLabel('Quantidade (Use - para remover)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 5000 ou -1000').setRequired(true);
			                    rows.push(new ActionRowBuilder().addComponents(amountInput));
			                }

			                rows.push(new ActionRowBuilder().addComponents(reasonInput));
			                modal.addComponents(...rows);
			                return interaction.showModal(modal);
			            }

			            const [_, targetId] = interaction.customId.split('_');
			            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
			            if (!targetMember) return reply("❌ O membro não está mais no servidor.");
			            if (targetMember.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) return reply("❌ Você não pode moderar alguém com cargo igual ou superior ao seu.");
			            if (!targetMember.manageable) return reply("❌ Não tenho permissão para moderar este membro.");

			            switch(action) {
				                case 'modKick': {
				                    const modal = new ModalBuilder().setCustomId(`modalKick_${targetMember.id}`).setTitle('Expulsar Membro').addComponents(
				                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kickReason').setLabel('Motivo da Expulsão').setStyle(TextInputStyle.Paragraph).setRequired(true))
				                    );
				                    return interaction.showModal(modal);
				                }
				                case 'modBan': {
				                    const modal = new ModalBuilder().setCustomId(`modalBan_${targetMember.id}`).setTitle('Banir Membro').addComponents(
				                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('banReason').setLabel('Motivo do Banimento').setStyle(TextInputStyle.Paragraph).setRequired(true))
				                    );
				                    return interaction.showModal(modal);
				                }
			                case 'modTimeout': {
			                    const modal = new ModalBuilder().setCustomId(`modalTimeout_${targetMember.id}`).setTitle('Aplicar Castigo (Timeout)').addComponents(
			                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('timeoutDuration').setLabel('Duração (em minutos)').setStyle(TextInputStyle.Short).setRequired(true)),
			                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('timeoutReason').setLabel('Motivo').setStyle(TextInputStyle.Paragraph).setRequired(false))
			                    );
			                    return interaction.showModal(modal);
			                }
				                case 'modMute': {
				                    if (!targetMember.voice.channel) return reply("❌ O membro não está em um canal de voz.");
				                    const modal = new ModalBuilder().setCustomId(`modalMute_${targetMember.id}`).setTitle('Mutar Membro').addComponents(
				                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('muteReason').setLabel('Motivo do Mute').setStyle(TextInputStyle.Paragraph).setRequired(true))
				                    );
				                    return interaction.showModal(modal);
				                }
			            }
			            return;
			        }

		        if (action === 'register') {
			            const [_, roleId] = interaction.customId.split('_');
			            const role = interaction.guild.roles.cache.get(roleId);
	            if (!role) return reply("❌ Cargo não encontrado.");
	            if (interaction.member.roles.cache.has(role.id)) return reply("✅ Você já tem este cargo!");
	            await interaction.member.roles.add(role).then(() => reply(`✅ Cargo **${role.name}** concedido!`)).catch(() => reply("❌ Erro ao dar o cargo."));
	            return;
	        }

		        if (action.startsWith('vc')) {
		            const userChannel = interaction.member.voice.channel;
		            if (!userChannel || !tempVcOwners.has(userChannel.id)) return reply("❌ Você precisa estar em um canal de voz temporário para usar isto.");

		            const isOwner = tempVcOwners.get(userChannel.id) === interaction.member.id;

		            switch(action) {
	            case 'vcRename': {
	                if (!isOwner) return reply("❌ Apenas o dono do canal pode renomeá-lo.");
	                const modal = new ModalBuilder().setCustomId(`modalRename_${userChannel.id}`).setTitle('Renomear Canal').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('newNameInput').setLabel('Novo nome').setStyle(TextInputStyle.Short).setRequired(true)));
	                return interaction.showModal(modal);
	            }
	            case 'vcLimit': {
	                if (!isOwner) return reply("❌ Apenas o dono do canal pode alterar o limite.");
	                const modal = new ModalBuilder().setCustomId(`modalLimit_${userChannel.id}`).setTitle('Definir Limite').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('newLimitInput').setLabel('Novo limite (0 para ilimitado)').setStyle(TextInputStyle.Short).setRequired(true).setValue(userChannel.userLimit.toString())));
	                return interaction.showModal(modal);
	            }
	            case 'vcKick': {
	                if (!isOwner) return reply("❌ Apenas o dono do canal pode expulsar membros.");
	                const members = userChannel.members.filter(m => m.id !== interaction.member.id);
	                if (members.size === 0) return reply("❌ Não há outros membros para expulsar.");
	                const menu = new StringSelectMenuBuilder().setCustomId(`kickMenu_${userChannel.id}`).setPlaceholder('Selecione um membro para expulsar').addOptions(members.map(m => ({ label: m.user.username, value: m.id })));
	                return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
	            }
	            case 'vcLock': if (isOwner) { await userChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: false }); return reply("🔒 Canal trancado."); } else return reply("❌ Apenas o dono pode trancar.");
	            case 'vcUnlock': if (isOwner) { await userChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: true }); return reply("🔓 Canal destrancado."); } else return reply("❌ Apenas o dono pode destrancar.");
	            case 'vcHide': if (isOwner) { await userChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }); return reply("👁️ Canal ocultado."); } else return reply("❌ Apenas o dono pode ocultar.");
	            case 'vcReveal': if (isOwner) { await userChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: true }); return reply("📢 Canal revelado."); } else return reply("❌ Apenas o dono pode revelar.");
	            case 'vcClaim': {
	                const ownerId = tempVcOwners.get(userChannel.id);
	                const owner = interaction.guild.members.cache.get(ownerId);
	                if (owner && owner.voice.channelId === userChannel.id) return reply("❌ O dono ainda está no canal.");
	                tempVcOwners.set(userChannel.id, interaction.member.id);
	                await userChannel.permissionOverwrites.edit(interaction.member.id, { ManageChannels: true });
	                return reply("👑 Você reivindicou a posse do canal!");
	            }
	            case 'vcIncrease': if (isOwner) { const newLimit = Math.min(userChannel.userLimit + 1, 99); await userChannel.setUserLimit(newLimit); return reply(`➕ Limite aumentado para ${newLimit}.`); } else return reply("❌ Apenas o dono pode aumentar o limite.");
	            case 'vcDecrease': if (isOwner) { const newLimit = Math.max(userChannel.userLimit - 1, 0); await userChannel.setUserLimit(newLimit); return reply(`➖ Limite diminuído para ${newLimit}.`); } else return reply("❌ Apenas o dono pode diminuir o limite.");
		            case 'vcDelete': if (isOwner) { await userChannel.delete("Deletado pelo dono."); return reply("🗑️ Canal deletado."); } else return reply("❌ Apenas o dono pode deletar o canal.");

		            }
		            return;
		        }
		    }

if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'ticket_select') {
            const config = ticketConfig[interaction.guildId];
            if (!config) return interaction.reply({ content: "❌ O sistema de tickets não foi configurado corretamente neste servidor.", ephemeral: true });

            const category = interaction.guild.channels.cache.get(config.categoryId);
            if (!category) return interaction.reply({ content: "❌ A categoria de tickets não foi encontrada.", ephemeral: true });

            const supportRole = interaction.guild.roles.cache.get(config.supportRoleId);
            const action = interaction.values[0];
            const ticketType = action === 'support' ? 'Suporte' : 'Orçamento';
            const ticketName = `${ticketType.toLowerCase()}-${interaction.user.username}`;

            const existingChannel = interaction.guild.channels.cache.find(c => c.name === ticketName && c.parentId === category.id);
            if (existingChannel) return interaction.reply({ content: `❌ Você já possui um ticket aberto em ${existingChannel}.`, ephemeral: true });

            await interaction.deferReply({ ephemeral: true });

            try {
                const channel = await interaction.guild.channels.create({
                    name: ticketName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
                        { id: supportRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] }
                    ]
                });

                const embed = new EmbedBuilder()
                    .setColor(globalConfig.embedColor)
                    .setTitle(`VoidSynth | Ticket de ${ticketType}`)
                    .setDescription(`Olá ${interaction.user}, bem-vindo ao seu ticket de **${ticketType}**.\n\nAguarde um momento enquanto nossa equipe de suporte visualiza sua solicitação.\n\n**Assunto:** ${ticketType === 'Suporte' ? 'Dúvidas e Suporte Geral' : 'Orçamento de Bot/Servidor'}`)
                    .setFooter({ text: "Para fechar este ticket, clique no botão abaixo." })
                    .setTimestamp();

                const closeButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger)
                );

                await channel.send({ content: `${interaction.user} | ${supportRole}`, embeds: [embed], components: [closeButton] });
                return interaction.editReply({ content: `Seu ticket foi criado com sucesso: ${channel}` });
            } catch (e) {
                console.error(e);
                return interaction.editReply({ content: "❌ Ocorreu um erro ao tentar criar o seu ticket." });
            }
        }
			        if (interaction.customId === 'verify_select_menu') {
			            const roleId = interaction.values[0];
			            const role = interaction.guild.roles.cache.get(roleId);

			            if (!role) return interaction.reply({ content: "❌ Cargo não encontrado.", ephemeral: true });

			            try {
			                if (interaction.member.roles.cache.has(roleId)) {
			                    await interaction.member.roles.remove(roleId);
			                    return interaction.reply({ content: `✅ Você removeu o cargo **${role.name}**.`, ephemeral: true });
			                } else {
			                    await interaction.member.roles.add(roleId);
			                    return interaction.reply({ content: `✅ Você resgatou o cargo **${role.name}**!`, ephemeral: true });
			                }
			            } catch (e) {
			                return interaction.reply({ content: "❌ Erro ao gerenciar cargo. Verifique minhas permissões.", ephemeral: true });
			            }
			        }

			        if (interaction.customId === 'shop_buy_menu') {
		            const roleId = interaction.values[0];
		            const guildId = interaction.guildId;
		            const shop = shopConfig[guildId];
		            if (!shop) return interaction.reply({ content: "❌ Loja não configurada.", ephemeral: true });

		            const item = shop.items.find(i => i.roleId === roleId);
		            if (!item) return interaction.reply({ content: "❌ Item não encontrado na loja.", ephemeral: true });

		            const userId = interaction.user.id;
		            const user = getUser(userId, interaction.user.tag);

		            if (interaction.member.roles.cache.has(roleId)) {
		                return interaction.reply({ content: "✅ Você já possui este cargo!", ephemeral: true });
		            }

		            if (user.bank < item.price) {
		                return interaction.reply({ content: `<a:xo_cross:1477009057427624072> Você não tem saldo suficiente no banco. Preço: **${formatDollars(item.price)}**`, ephemeral: true });
		            }

		            try {
		                await interaction.member.roles.add(roleId);
		                user.bank -= item.price;
		                updateUser(userId, user);
		                return interaction.reply({ content: `✅ Você comprou o cargo <@&${roleId}> por **${formatDollars(item.price)}**!`, ephemeral: true });
		            } catch (e) {
		                console.error(e);
		                return interaction.reply({ content: "❌ Erro ao atribuir o cargo. Verifique minhas permissões.", ephemeral: true });
		            }
		        }

		        const [action, targetId] = interaction.customId.split('_');
		        if (action === 'kickMenu') {
		            const userToKickId = interaction.values[0];
		            const memberToKick = await interaction.guild.members.fetch(userToKickId);
		            if (memberToKick) {
		                await memberToKick.voice.disconnect("Expulso pelo dono do canal.");
		                return interaction.update({ content: `✅ ${memberToKick.user.username} foi expulso do canal.`, components: [] });
		            }
		        }
		        return;
		    }

		    if (interaction.isModalSubmit()) {
		        const [action, targetId] = interaction.customId.split('_');

			        if (action === 'modalKick') {
			            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
			            if (!targetMember) return interaction.reply({ content: "❌ O membro não está mais no servidor.", ephemeral: true });
			            const reason = interaction.fields.getTextInputValue('kickReason') || 'Sem motivo especificado.';
			            try {
			                await targetMember.kick(reason);
			                return interaction.reply({ content: `✅ Membro **${targetMember.user.tag}** expulso. Motivo: ${reason}`, ephemeral: true });
			            } catch (e) {
			                return interaction.reply({ content: "❌ Não foi possível expulsar o membro. Verifique minhas permissões.", ephemeral: true });
			            }
			        }

			        if (action === 'modalBan') {
			            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
			            if (!targetMember) return interaction.reply({ content: "❌ O membro não está mais no servidor.", ephemeral: true });
			            const reason = interaction.fields.getTextInputValue('banReason') || 'Sem motivo especificado.';
			            try {
			                await targetMember.ban({ reason });
			                return interaction.reply({ content: `✅ Membro **${targetMember.user.tag}** banido. Motivo: ${reason}`, ephemeral: true });
			            } catch (e) {
			                return interaction.reply({ content: "❌ Não foi possível banir o membro. Verifique minhas permissões.", ephemeral: true });
			            }
			        }

			        if (action === 'modalMute') {
			            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
			            if (!targetMember) return interaction.reply({ content: "❌ O membro não está mais no servidor.", ephemeral: true });
			            const reason = interaction.fields.getTextInputValue('muteReason') || 'Sem motivo especificado.';
			            if (!targetMember.voice.channel) return interaction.reply({ content: "❌ O membro não está em um canal de voz para ser mutado.", ephemeral: true });
			            try {
			                await targetMember.voice.setMute(true, reason);
			                return interaction.reply({ content: `✅ Membro **${targetMember.user.tag}** mutado no canal de voz. Motivo: ${reason}`, ephemeral: true });
			            } catch (e) {
			                return interaction.reply({ content: "❌ Não foi possível mutar o membro. Verifique minhas permissões.", ephemeral: true });
			            }
			        }

			        if (action === 'modalTimeout') {
		            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
		            if (!targetMember) return interaction.reply({ content: "❌ O membro não está mais no servidor.", ephemeral: true });

		            const duration = parseInt(interaction.fields.getTextInputValue('timeoutDuration'));
		            const reason = interaction.fields.getTextInputValue('timeoutReason') || 'Sem motivo especificado.';

		            if (isNaN(duration) || duration <= 0) return interaction.reply({ content: "❌ Duração de castigo inválida. Use um número inteiro positivo (em minutos).", ephemeral: true });

		            const durationMs = duration * 60 * 1000;
		            const maxDurationMs = 2419200000;

		            if (durationMs > maxDurationMs) return interaction.reply({ content: "❌ A duração máxima de castigo é de 28 dias.", ephemeral: true });

		            try {
		                await targetMember.timeout(durationMs, reason);
		                return interaction.reply({ content: `✅ Membro **${targetMember.user.tag}** castigado por ${duration} minutos. Motivo: ${reason}`, ephemeral: true });
		            } catch (e) {
		                return interaction.reply({ content: "❌ Não foi possível aplicar o castigo. Verifique minhas permissões.", ephemeral: true });
		            }
		        }

		        const channel = interaction.guild.channels.cache.get(targetId);
		        if (!channel) return interaction.reply({ content: "❌ Canal não encontrado.", ephemeral: true });

		        if (action === 'modalRename') {
		            await channel.setName(interaction.fields.getTextInputValue('newNameInput'));
		            return interaction.reply({ content: `✅ Canal renomeado.`, ephemeral: true });
		        }

		        if (action === 'modalLimit') {
		            const limit = parseInt(interaction.fields.getTextInputValue('newLimitInput'));
		            if (isNaN(limit) || limit < 0 || limit > 99) return interaction.reply({ content: "❌ Limite inválido.", ephemeral: true });
		            await channel.setUserLimit(limit);
		            return interaction.reply({ content: `✅ Limite definido para ${limit === 0 ? 'ilimitado' : limit}.`, ephemeral: true });
		        }

		        return;
		    }
	    if (!interaction.isCommand()) return;

	    const { commandName, options } = interaction;
	    const reply = (content, ephemeral = true) => {
	        if (typeof content === 'object') return interaction.reply({ ...content, ephemeral });
	        return interaction.reply({ content, ephemeral });
	    };

		    const noXpCommands = ['setruleschannel', 'supportpainel', 'setrankvoid', 'setrankingroles', 'clear', 'setupvoice', 'vcpanel', 'setregister', 'setwelcome', 'setlogchannel', 'antinuke', 'adminpanel', 'autopfp', 'config-loja', 'embed', 'edit-embed'];

			    if (!noXpCommands.includes(commandName)) {
			        await addXP(interaction.guild, interaction.user, interaction.channel, interaction);
			    }

			    if (commandName === 'xplog') {
			        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
			            return interaction.reply({ content: "❌ Você precisa ser administrador para usar este comando.", ephemeral: true });
			        }
			        const status = options.getString('status');
			        const channel = options.getChannel('canal') || interaction.channel;

if (status === 'on') {
				            xpLogConfig.enabled = true;
				            xpLogConfig.channelId = channel.id;
				            saveXPLogConfig();
				            await interaction.reply({ content: `✅ Logs de XP ativados no canal ${channel}!`, ephemeral: true });
				        } else {
				            xpLogConfig.enabled = false;
				            saveXPLogConfig();
				            await interaction.reply({ content: `❌ Logs de XP desativados!`, ephemeral: true });
				        }
			        return;
			    }

    if (commandName === 'auto-mensagem') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ Você precisa ser administrador para usar este comando.", ephemeral: true });
        }

        const acao = options.getString('acao');
        const guildId = interaction.guildId;

        if (acao === 'off') {
            if (autoMessageConfig[guildId]) {
                autoMessageConfig[guildId].enabled = false;
                saveAutoMessageConfig();
                if (autoMessageIntervals.has(guildId)) {
                    clearInterval(autoMessageIntervals.get(guildId));
                    autoMessageIntervals.delete(guildId);
                }
                return interaction.reply({ content: "✅ Mensagens automáticas desativadas neste servidor.", ephemeral: true });
            }
            return interaction.reply({ content: "❌ As mensagens automáticas já estão desativadas.", ephemeral: true });
        }

        if (acao === 'status') {
            const config = autoMessageConfig[guildId];
            if (!config || !config.enabled) {
                return interaction.reply({ content: "❌ Mensagens automáticas não estão configuradas ou estão desativadas.", ephemeral: true });
            }
            const embed = new EmbedBuilder()
                .setColor(globalConfig.embedColor)
                .setTitle("📢 Configuração de Auto-Mensagem")
                .addFields(
                    { name: "Canal", value: `<#${config.channelId}>`, inline: true },
                    { name: "Intervalo", value: `${config.interval / 60000} minutos`, inline: true },
                    { name: "Cargo", value: config.roleId ? `<@&${config.roleId}>` : "Nenhum", inline: true },
                    { name: "Mensagem", value: config.message }
                );
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (acao === 'on') {
            const canal = options.getChannel('canal');
            const mensagem = options.getString('mensagem');
            const intervaloMin = options.getInteger('intervalo');
            const cargo = options.getRole('cargo');

            if (!canal || !mensagem || !intervaloMin) {
                return interaction.reply({ content: "❌ Para ativar, você deve fornecer o canal, a mensagem e o intervalo.", ephemeral: true });
            }

            autoMessageConfig[guildId] = {
                enabled: true,
                channelId: canal.id,
                message: mensagem,
                interval: intervaloMin * 60000,
                roleId: cargo ? cargo.id : null,
                lastSent: Date.now()
            };

            saveAutoMessageConfig();
            startAutoMessages(guildId);

            return interaction.reply({ content: `✅ Mensagens automáticas configuradas com sucesso! Elas serão enviadas em <#${canal.id}> a cada ${intervaloMin} minutos.`, ephemeral: true });
        }
    }

    if (commandName === 'testwelcome') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ Você precisa ser administrador para usar este comando.", ephemeral: true });
        }

        const targetMember = options.getMember('usuario');
        const config = welcomeConfig[interaction.guildId];

        if (!config?.welcomeChannelId) {
            return interaction.reply({ content: "❌ O canal de boas-vindas não está configurado. Use `/setwelcome` primeiro.", ephemeral: true });
        }

        const channel = await interaction.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
        if (!channel) {
            return interaction.reply({ content: "❌ Não consegui encontrar o canal de boas-vindas configurado.", ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(globalConfig.embedColor)
            .setTitle(`Bem vindo ao VoidSynth`)
            .setDescription(`> <#1495734185833271488>\n> <#1418634171164921919>\n\nPor favor, não ping a staff`)
            .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true, size: 512 }));

        await channel.send({ content: `${targetMember}`, embeds: [embed] });
        return interaction.reply({ content: `✅ Teste de boas-vindas enviado para ${channel}!`, ephemeral: true });
    }

    if (commandName === 'ocultrank') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ Você precisa ser administrador para usar este comando.", ephemeral: true });
        }

        const targetUser = options.getUser('usuario');
        const guildId = interaction.guildId;

        if (!ignoredUsers[guildId]) ignoredUsers[guildId] = {};

        if (!targetUser) {
            const ignoredList = Object.keys(ignoredUsers[guildId]);
            if (ignoredList.length === 0) {
                return interaction.reply({ content: "ℹ️ Não há nenhum usuário na lista de ocultos no momento.", ephemeral: true });
            }

            const listString = ignoredList.map(id => `<@${id}> (\`${id}\`)`).join('\n');
            const embed = new EmbedBuilder()
                .setColor(globalConfig.embedColor)
                .setTitle("🚫 Usuários Ocultos do Ranking")
                .setDescription(`Estes usuários não recebem XP/Dinheiro e não aparecem no rank:\n\n${listString}`)
                .setFooter({ text: "Para remover alguém, use /ocultrank @usuario" });

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (ignoredUsers[guildId][targetUser.id]) {
            delete ignoredUsers[guildId][targetUser.id];
            saveIgnoredUsers();
            return interaction.reply({ content: `✅ ${targetUser} foi removido da lista de ocultos e voltará a receber XP e aparecer no rank.`, ephemeral: true });
        } else {
            ignoredUsers[guildId][targetUser.id] = true;
            saveIgnoredUsers();
            return interaction.reply({ content: `✅ ${targetUser} agora está sendo ignorado pelo sistema de XP, economia e ranking.`, ephemeral: true });
        }
    }
    if (commandName === 'ping') return reply(`🏓 Latência: ${client.ws.ping}ms`, false);

    if (commandName === 'supportpainel') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ Você precisa ser administrador para usar este comando.", ephemeral: true });
        }

        const canal = options.getChannel('canal');
        const categoria = options.getChannel('categoria');
        const cargoSuporte = options.getRole('cargo_suporte');
        const canalLogs = options.getChannel('canal_logs');

        if (categoria.type !== ChannelType.GuildCategory) {
            return interaction.reply({ content: "❌ O canal de categoria deve ser uma categoria válida.", ephemeral: true });
        }

        ticketConfig[interaction.guildId] = {
            categoryId: categoria.id,
            supportRoleId: cargoSuporte.id,
            logChannelId: canalLogs.id
        };
        saveTicketConfig();

        const embed = new EmbedBuilder()
            .setColor(globalConfig.embedColor)
            .setTitle("VoidSynth Ticket Support")
            .setDescription(`Se você precisa de ajuda, por favor selecione uma opção abaixo.`)
            .setImage("https://i.imgur.com/P3vd2eg.png")
            .setFooter({ text: "VoidSynth Support - discord.gg/voidsynth" });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket_select')
            .setPlaceholder('Selecione uma opção')
            .addOptions([
                {
                    label: 'Dúvidas e Suporte',
                    description: 'Obtenha ajuda com dúvidas gerais ou problemas.',
                    value: 'support',
                    emoji: '<:pink:1483442571308044320>'
                },
                {
                    label: 'Orçamento',
                    description: 'Faça o orçamento do seu código.',
                    value: 'budget',
                    emoji: '<:pink:1483442595882467400>'
                }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        try {
            await canal.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: `✅ Painel de suporte enviado com sucesso em ${canal}!`, ephemeral: true });
        } catch (e) {
            return interaction.reply({ content: "❌ Erro ao enviar o painel. Verifique minhas permissões no canal.", ephemeral: true });
        }
    }

    if (commandName === 'embed') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ Você precisa ser administrador para usar este comando.", ephemeral: true });
        }

        const titulo = options.getString('titulo');
        const descricao = options.getString('descricao');
        const cor = options.getString('cor') || globalConfig.embedColor;
        const imagem = options.getString('imagem');
        const arquivo = options.getAttachment('arquivo');
        const thumbnail = options.getString('thumbnail');
        const rodape = options.getString('rodape');
        const canal = options.getChannel('canal') || interaction.channel;
        const botaoLabel = options.getString('botao_label');
        const botaoLink = options.getString('botao_link');

        if (!titulo && !descricao && !arquivo && !imagem && !thumbnail) {
            return interaction.reply({ content: "❌ Você precisa fornecer pelo menos um título, uma descrição, uma imagem ou um arquivo.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const embed = new EmbedBuilder()
            .setColor(cor.startsWith('#') ? cor : globalConfig.embedColor);

        if (titulo) embed.setTitle(titulo);
        if (descricao) embed.setDescription(descricao.replace(/\\n/g, '\n').replace(/\/n/g, '\n').replace(/<br>/g, '\n'));
        if (imagem) embed.setImage(imagem);
        if (thumbnail) embed.setThumbnail(thumbnail);
        if (rodape) embed.setFooter({ text: rodape });

        const files = [];
        if (arquivo) {
            const isVideo = arquivo.contentType?.startsWith('video/');
            if (isVideo) {

                files.push(new AttachmentBuilder(arquivo.url, { name: arquivo.name }));
            } else {

                embed.setImage(arquivo.url);
            }
        }

        const components = [];
        if (botaoLabel && botaoLink) {
            try {
                const button = new ButtonBuilder()
                    .setLabel(botaoLabel)
                    .setURL(botaoLink)
                    .setStyle(ButtonStyle.Link);
                components.push(new ActionRowBuilder().addComponents(button));
            } catch (e) {
                return interaction.editReply({ content: "❌ O link fornecido para o botão é inválido. Certifique-se de que começa com http:// ou https://" });
            }
        }

        try {
            await canal.send({ embeds: [embed], components: components, files: files });
            return interaction.editReply({ content: `✅ Embed enviado com sucesso em ${canal}!` });
        } catch (error) {
            console.error("Erro ao enviar embed:", error);
            return interaction.editReply({ content: "❌ Ocorreu um erro ao tentar enviar o embed. Verifique se os links ou arquivos são válidos." });
        }
    }

    if (commandName === 'edit-embed') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ Você precisa ser administrador para usar este comando.", ephemeral: true });
        }

        const messageId = options.getString('message_id');
        const canal = options.getChannel('canal') || interaction.channel;

        try {
            const targetMessage = await canal.messages.fetch(messageId);
            if (!targetMessage) return interaction.reply({ content: "❌ Mensagem não encontrada.", ephemeral: true });
            if (targetMessage.author.id !== client.user.id) return interaction.reply({ content: "❌ Eu só posso editar mensagens enviadas por mim.", ephemeral: true });
            if (!targetMessage.embeds[0]) return interaction.reply({ content: "❌ Esta mensagem não possui um embed para editar.", ephemeral: true });

            const oldEmbed = targetMessage.embeds[0];
            const newEmbed = EmbedBuilder.from(oldEmbed);

            const titulo = options.getString('titulo');
            const descricao = options.getString('descricao');
            const cor = options.getString('cor');
            const imagem = options.getString('imagem');
            const arquivo = options.getAttachment('arquivo');
            const thumbnail = options.getString('thumbnail');
            const rodape = options.getString('rodape');
            const botaoLabel = options.getString('botao_label');
            const botaoLink = options.getString('botao_link');

            if (titulo !== null) newEmbed.setTitle(titulo);
            if (descricao !== null) newEmbed.setDescription(descricao.replace(/\\n/g, '\n').replace(/\/n/g, '\n').replace(/<br>/g, '\n'));
            if (cor !== null) newEmbed.setColor(cor.startsWith('#') ? cor : oldEmbed.color);

            await interaction.deferReply({ ephemeral: true });

            const files = [];
            if (arquivo) {
                const isVideo = arquivo.contentType?.startsWith('video/');
                if (isVideo) {
                    files.push(new AttachmentBuilder(arquivo.url, { name: arquivo.name }));
                    newEmbed.setImage(null);
                } else {
                    newEmbed.setImage(arquivo.url);
                }
            } else if (imagem !== null) {
                newEmbed.setImage(imagem === 'remover' ? null : imagem);
            }

            if (thumbnail !== null) {
                newEmbed.setThumbnail(thumbnail === 'remover' ? null : thumbnail);
            }

            if (rodape !== null) {
                newEmbed.setFooter({ text: rodape === 'remover' ? null : rodape });
            }

            let components = targetMessage.components;
            if (botaoLabel !== null || botaoLink !== null) {
                if (botaoLabel === 'remover' || botaoLink === 'remover') {
                    components = [];
                } else {
                    const currentButton = targetMessage.components[0]?.components[0];
                    const finalLabel = botaoLabel || currentButton?.label;
                    const finalLink = botaoLink || currentButton?.url;

                    if (finalLabel && finalLink) {
                        try {
                            const button = new ButtonBuilder()
                                .setLabel(finalLabel)
                                .setURL(finalLink)
                                .setStyle(ButtonStyle.Link);
                            components = [new ActionRowBuilder().addComponents(button)];
                        } catch (e) {
                            return interaction.reply({ content: "❌ O link fornecido para o botão é inválido.", ephemeral: true });
                        }
                    }
                }
            }

            await targetMessage.edit({ embeds: [newEmbed.toJSON()], components: components, files: files });
            return interaction.editReply({ content: `✅ Embed editado com sucesso em ${canal}!` });
        } catch (error) {
            console.error("Erro ao editar embed:", error);
            return interaction.editReply({ content: "❌ Ocorreu um erro ao tentar editar o embed. Verifique o ID da mensagem e o canal." });
        }
    }
		    if (commandName === 'rank') {
            const userXP = xp[interaction.guildId]?.[interaction.user.id] || 0;
            const level = getLevel(userXP);
            const nextLevelXP = LEVELS[level] || "MAX";
            const progress = nextLevelXP === "MAX" ? 100 : (userXP / nextLevelXP) * 100;

            const progressBarLength = 10;
            const filledBlocks = Math.round((progress / 100) * progressBarLength);
            const emptyBlocks = progressBarLength - filledBlocks;
            const progressBar = "▰".repeat(filledBlocks) + "▱".repeat(emptyBlocks);

            const embed = new EmbedBuilder()
                .setColor(globalConfig.embedColor)
                .setAuthor({ name: `Perfil de XP | ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                .setDescription(`### <a:xp:1320858569037582336> Informações de Nível\nAtualmente você está no **Nível ${level}**.\n\n**Progresso:**\n\`${progressBar}\` **${progress.toFixed(1)}%**\n\n**XP Atual:** \`${userXP}\` / \`${nextLevelXP}\`\n\n### <a:green:1242502724000546826> Cargos de Recompensa\n- **TOP 1:** <@&1434914289143250954>\n- **TOP 2:** <@&1434914684561002506>\n- **TOP 3:** <@&1434914601094348880>\n\n### <a:green:1242502724000546826> Comandos de Economia\n- **/bank** - depósito e saque.\n- **/crash** - aposte seu dinheiro.\n- **/balance** - veja seu saldo.\n- **/daily** - receba uma quantidade de dinheiro diariamente.`)
                .setFooter({ text: "Ranking • Continue interagindo para subir!" })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
			    if (commandName === 'rankvoid') return reply(leaderboardConfig[interaction.guildId]?.channelId ? `O Rank está em <#${leaderboardConfig[interaction.guildId].channelId}>.` : "O Rank não foi configurado.");
		    if (commandName === 'avatar') { const user = options.getUser('user') || interaction.user; const embed = new EmbedBuilder().setColor(globalConfig.embedColor).setTitle(`🖼️ Avatar de ${user.tag}`).setImage(user.displayAvatarURL({ dynamic: true, size: 1024 })).setColor(globalConfig.embedColor); return interaction.reply({ embeds: [embed], ephemeral: true }); }
		    if (commandName === 'banner') {
		        const user = options.getUser('user') || interaction.user;
		        const fetchedUser = await client.users.fetch(user.id, { force: true });
		        const bannerUrl = fetchedUser.bannerURL({ dynamic: true, size: 1024 });

		        if (!bannerUrl) return reply(`❌ O usuário **${user.tag}** não possui um banner.`);

		        const embed = new EmbedBuilder()
		            .setColor(globalConfig.embedColor)
		            .setTitle(`🖼️ Banner de ${user.tag}`)
		            .setImage(bannerUrl);

		        return interaction.reply({ embeds: [embed], ephemeral: true });
		    }

				    if (commandName === 'help') {
				        try {

					            const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
					            const filteredCommands = commandsList.filter(cmd => {
					                if (isAdmin) return true;
					                return !cmd.description.includes("(Admin)");
					            });

					            const commandsDescription = filteredCommands.map(cmd => `**/${cmd.name}**\n\`${cmd.description || 'Sem descrição'}\``).join('\n\n');

				            const embed = new EmbedBuilder()
				                .setColor(globalConfig.embedColor)
				                .setTitle("📚 Lista de Comandos")
				                .setDescription(commandsDescription || "Nenhum comando disponível no momento.");

				            return interaction.reply({ embeds: [embed], ephemeral: true });
				        } catch (error) {
				            console.error("Erro ao gerar lista de comandos para o /help:", error);
				            return reply("❌ Ocorreu um erro ao carregar a lista de comandos.");
				        }
				    }

			    switch (commandName) {

			        case 'daily':
			            await handleDaily(interaction);
			            return;
	        case 'balance':
	            await handleBalance(interaction);
	            return;
	        case 'transfer':
	            await handleTransfer(interaction);
	            return;
	        case 'crash':
	            await handleCrash(interaction);
	            return;

	        case 'bank':
	            await handleBank(interaction);
	            return;
	    }

		    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return reply("❌ Você precisa ser administrador para usar este comando.");

					    if (commandName === 'joinvc') {
					        await handleJoinVC(interaction);
					        return;
					    }

					    if (commandName === 'paineldecomandos') {
					        const channel = options.getChannel('canal');
					        if (!channel.isTextBased()) return reply("❌ Por favor, selecione um canal de texto.");

					        const filteredCommands = commandsList.filter(cmd => !cmd.description.includes("(Admin)"));
					        const commandsDescription = filteredCommands.map(cmd => `<:pureza_i:1482422447444590593> **/${cmd.name}**\n\`${cmd.description || 'Sem descrição'}\``).join('\n\n');

					        const embed = new EmbedBuilder()
					            .setColor(globalConfig.embedColor)
					            .setTitle("Painel de Comandos")
					            .setDescription(commandsDescription || "Nenhum comando disponível no momento.")
					            .setThumbnail(client.user.displayAvatarURL())
					            .setImage("https://i.imgur.com/xcJTgbH.png")
					            .setTimestamp();

					        try {
					            const message = await channel.send({ embeds: [embed] });
					            commandsPanelConfig[interaction.guildId] = { channelId: channel.id, messageId: message.id };
					            saveCommandsPanelConfig();
					            return interaction.reply({ content: `✅ Painel de comandos enviado com sucesso em ${channel}!`, ephemeral: true });
					        } catch (error) {
					            console.error("Erro ao enviar painel de comandos:", error);
					            return reply("❌ Ocorreu um erro ao enviar o painel.");
					        }
					    }

					    switch(commandName) {

							        case 'updatebanner': {
							            const sistema = options.getString('sistema');
							            const url = options.getString('url');

							            if (!globalConfig.banners) globalConfig.banners = {};

							            if (url.toLowerCase() === 'remover') {

							                globalConfig.banners[sistema] = 'none';
							                saveGlobalConfig();

							                const embed = new EmbedBuilder()
							                    .setColor(globalConfig.embedColor)
							                    .setTitle("✅ Banner Removido")
							                    .setDescription(`O banner do sistema **${sistema}** foi removido. Agora este sistema não exibirá nenhum banner.`)
							                    .setTimestamp();

							                return interaction.reply({ embeds: [embed], ephemeral: true });
							            }

							            if (!url.startsWith('http')) return reply("❌ Por favor, insira uma URL válida de imagem ou escreva 'remover' para tirar o banner.");

						            globalConfig.banners[sistema] = url;
						            saveGlobalConfig();

						            const embed = new EmbedBuilder()
						                .setColor(globalConfig.embedColor)
						                .setTitle("✅ Banner Atualizado")
						                .setDescription(`O banner do sistema **${sistema}** foi atualizado com sucesso!`)
						                .setImage(url)
						                .setTimestamp();

						            return interaction.reply({ embeds: [embed], ephemeral: true });
						        }
					        case 'setgpt': {
				            const channel = options.getChannel('canal');
				            if (!channel.isTextBased()) return reply("❌ Por favor, selecione um canal de texto.");

				            gptConfig[interaction.guildId] = { channelId: channel.id };
				            saveGPTConfig();

				            return reply(`✅ Canal do ChatGPT configurado para ${channel}!`);
				        }
				        case 'msg': {
				            const channel = options.getChannel('canal');
				            const content = options.getString('mensagem');
				            if (!channel.isTextBased()) return reply("❌ Por favor, selecione um canal de texto.");

				            try {
				                await channel.send(content);
				                return interaction.reply({ content: `✅ Mensagem enviada com sucesso em ${channel}!`, ephemeral: true });
				            } catch (error) {
				                console.error("Erro no comando /msg:", error);
				                return interaction.reply({ content: "❌ Ocorreu um erro ao tentar enviar a mensagem.", ephemeral: true });
				            }
				        }
			        case 'atualizarembedscolor': {
		            const novaCor = options.getString('cor');

		            if (!/^#[0-9A-F]{6}$/i.test(novaCor)) {
		                return reply("❌ Formato de cor inválido! Use o formato HEX (ex: #000102).");
		            }

		            globalConfig.embedColor = novaCor;
		            saveGlobalConfig();

		            const embed = new EmbedBuilder()
		                .setColor(globalConfig.embedColor)
		                .setTitle("🎨 Cor Atualizada")
		                .setDescription(`A cor de todos os novos embeds foi alterada para \`${novaCor}\`.`);

		            return interaction.reply({ embeds: [embed], ephemeral: true });
		        }
		        case 'autopfp': {
	            const action = options.getString('action');
	            const channel = options.getChannel('channel');
	            const filter = options.getString('filter') || 'all';

	            if (action === 'start') {
	                if (!channel || !channel.isTextBased()) return reply("❌ Para iniciar, você deve fornecer um canal de texto válido.");

	                const allFiles = await getAllAutoPfpFiles();
	                if (allFiles.length === 0) return reply(`❌ Nenhuma imagem encontrada nas pastas de AutoPFP. Use \`/scan-pfp\` ou adicione imagens manualmente em \`${IMAGE_FOLDER_BASE}/folder_1\`.`);

	                autopfpConfig[interaction.guildId] = {
	                    enabled: true,
	                    channelId: channel.id,
	                    filter: filter,
	                    lastIndex: 0
	                };
	                saveAutoPfpConfig();
	                startAutoPfpLoop(interaction.guildId);

	                const filterText = filter === 'gif' ? 'apenas GIFs' : 'todas as imagens';
	                return reply(`✅ AutoPFP iniciado! Enviando 1 imagem (${filterText}) a cada 1 minuto em ${channel}.`);
	            }

	            if (action === 'stop') {
	                if (stopAutoPfpLoop(interaction.guildId)) {
	                    autopfpConfig[interaction.guildId] = { enabled: false, channelId: autopfpConfig[interaction.guildId]?.channelId };
	                    saveAutoPfpConfig();
	                    return reply("✅ AutoPFP parado com sucesso.");
	                } else {
	                    return reply("❌ O AutoPFP não estava ativo neste servidor.");
	                }
	            }
	            return reply("❌ Ação inválida. Use 'start' ou 'stop'.");
	        }

		        case 'scan-pfp': {
		            const channel = options.getChannel('channel');
		            const limit = options.getInteger('limit') || 100;

		            if (!channel || !channel.isTextBased()) return reply('❌ O canal deve ser um canal de texto.');

		            await interaction.deferReply();

		            try {
		                const messages = await channel.messages.fetch({ limit: limit });
		                let captured = 0;
		                let duplicates = 0;
		                let errors = 0;

		                for (const msg of messages.values()) {
		                    const imageUrls = new Set();

		                    msg.attachments.forEach(att => {
		                        if (att.contentType?.startsWith('image/')) imageUrls.add(att.url);
		                    });

		                    msg.embeds.forEach(embed => {
		                        if (embed.image) imageUrls.add(embed.image.url);
		                        if (embed.thumbnail) imageUrls.add(embed.thumbnail.url);
		                    });

		                    for (const url of imageUrls) {
		                        const result = await uploadToDatabase(url);
		                        if (result) { captured++; await msg.delete().catch(() => {}); }
		                        else if (result === false) duplicates++;
		                        else if (result === null) errors++;
		                    }
		                }

		                const cleanedCount = cleanupDuplicates();

		                const logEmbed = new EmbedBuilder()
		                    .setColor(globalConfig.embedColor)
		                    .setTitle('📊 Log de Varredura AutoPFP')
		                    .setDescription(`Varredura concluída no canal ${channel}.`)
		                    .addFields(
		                        { name: '📸 Capturadas', value: `\`${captured}\` novas imagens`, inline: true },
		                        { name: '🔄 Duplicadas', value: `\`${duplicates + cleanedCount}\` ignoradas/removidas`, inline: true },
		                        { name: '⚠️ Erros', value: `\`${errors}\` falhas`, inline: true }
		                    )
		                    .setFooter({ text: `Limite de mensagens: ${limit} | Limpeza global realizada.` })
		                    .setTimestamp();

		                await interaction.editReply({ embeds: [logEmbed] });
		            } catch (e) {
		                console.error('Erro ao varrer canal:', e);
		                await interaction.editReply('❌ Ocorreu um erro ao tentar varrer o canal.');
		            }
		            break;
		        }
		        case 'scanemoji': {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return reply('❌ Você precisa de permissão de Administrador para usar este comando.');
            }

            const channel = options.getChannel('canal');
            const limit = options.getInteger("limite") || 100;
            const allowDuplicates = options.getBoolean("duplicatas") || false;

            if (!channel || !channel.isTextBased()) return reply('❌ O canal deve ser um canal de texto.');

            await interaction.deferReply({ ephemeral: true });

            try {
                const messages = await channel.messages.fetch({ limit: limit });
                let addedEmojis = 0;
                let failedEmojis = 0;
                let duplicateEmojis = 0;

                const existingEmojiNames = new Set(interaction.guild.emojis.cache.map(e => e.name));
                const existingEmojiIds = new Set(interaction.guild.emojis.cache.map(e => e.id));

                const emojisToUpload = [];
                const processedEmojiStrings = new Set();

                for (const msg of messages.values()) {
                    const customEmojis = msg.content.match(/<(a)?:[a-zA-Z0-9_]+:[0-9]+>/g);
                    if (!customEmojis) continue;

                    for (const emojiString of customEmojis) {
                        if (processedEmojiStrings.has(emojiString)) {
                            continue;
                        }
                        processedEmojiStrings.add(emojiString);

                        const animated = emojiString.startsWith('<a:');
                        const emojiMatch = emojiString.match(/:(.*?):([0-9]+)/);
                        if (!emojiMatch) continue;

                        const emojiName = emojiMatch[1];
                        const emojiId = emojiMatch[2];
                        const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${animated ? 'gif' : 'png'}`;

                        if (!allowDuplicates && (existingEmojiNames.has(emojiName) || existingEmojiIds.has(emojiId))) {
                            duplicateEmojis++;
                            continue;
                        }

                        emojisToUpload.push({ url: emojiUrl, name: emojiName });
                    }
                }

                const chunkSize = 5;
                const delayMs = 5000;

                for (let i = 0; i < emojisToUpload.length; i += chunkSize) {
                    const chunk = emojisToUpload.slice(i, i + chunkSize);
                    const chunkPromises = chunk.map(async (emoji) => {
                        try {
                            await interaction.guild.emojis.create({
                                attachment: emoji.url,
                                name: emoji.name
                            });
                            addedEmojis++;
                        } catch (e) {
                            console.error(`Erro ao adicionar emoji ${emoji.name}:`, e);
                            failedEmojis++;
                        }
                    });
                    await Promise.all(chunkPromises);

                    if (i + chunkSize < emojisToUpload.length) {
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor(globalConfig.embedColor)
                    .setTitle('📊 Relatório de Scan de Emojis')
                    .setDescription(`Varredura concluída no canal ${channel}.`)
                    .addFields(
                        { name: '✅ Emojis Adicionados', value: `\`${addedEmojis}\``, inline: true },
                        { name: '🔄 Emojis Duplicados', value: `\`${duplicateEmojis}\``, inline: true },
                        { name: '❌ Falhas', value: `\`${failedEmojis}\``, inline: true }
                    )
                    .setFooter({ text: `Limite de mensagens: ${limit}` })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });

            } catch (e) {
                console.error('Erro ao escanear emojis:', e);
                await interaction.editReply('❌ Ocorreu um erro ao tentar escanear o canal em busca de emojis.');
            }
            break;
        }
        case 'autoscanpfp': {
		            const acao = options.getString('acao');
		            const canalScan = options.getChannel('canal_scan');
		            const canalLog = options.getChannel('canal_log');

		            if (acao === 'on') {
		                if (!canalScan || !canalLog) return reply("❌ Para ativar, você deve fornecer o canal de scan e o canal de log.");
		                if (!canalScan.isTextBased() || !canalLog.isTextBased()) return reply("❌ Ambos os canais devem ser canais de texto.");

		                autoscanpfpConfig[interaction.guildId] = {
		                    enabled: true,
		                    scanChannelId: canalScan.id,
		                    logChannelId: canalLog.id
		                };
		                saveAutoScanPfpConfig();
		                startAutoScanPfpLoop(interaction.guildId);

		                return reply(`✅ AutoScanPFP ativado! Varrendo ${canalScan} a cada 12 horas e enviando logs em ${canalLog}. A primeira varredura foi iniciada agora.`);
		            } else {
		                if (stopAutoScanPfpLoop(interaction.guildId)) {
		                    autoscanpfpConfig[interaction.guildId].enabled = false;
		                    saveAutoScanPfpConfig();
		                    return reply("✅ AutoScanPFP desativado com sucesso.");
		                } else {
		                    return reply("❌ O AutoScanPFP não estava ativo neste servidor.");
		                }
		            }
		        }

        case 'setup-imgdb': {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return reply("❌ Sem permissão.");
            const guildId = options.getString('guild_id');
            const categoryId = options.getString('category_id');
            imageDatabaseConfig.guildId = guildId;
            imageDatabaseConfig.categoryId = categoryId;
            saveImageDatabaseConfig();
            return reply(`✅ Banco de imagens configurado para o servidor \`${guildId}\`!`);
        }

        case 'clear': await interaction.channel.bulkDelete(options.getInteger('amount'), true).catch(() => {}); return reply(`✅ Mensagens apagadas.`);

				            case 'setruleschannel': {
                                await handleSetRulesChannel(interaction);
                                break;
                            }
				            case 'setrankingroles': {
			                const role1 = options.getRole('top1_role');
			                const role2 = options.getRole('top2_role');
			                const role3 = options.getRole('top3_role');

			                if (!role1 || !role2 || !role3) return reply("❌ Por favor, forneça os 3 cargos (Top 1, Top 2, Top 3).");

			                rankingRolesConfig[interaction.guildId] = {
			                    roleId1: role1.id,
			                    roleId2: role2.id,
			                    roleId3: role3.id,
			                    currentTopUsers: {}
			                };
			                saveRankingRolesConfig();

			                await updateRankingRoles(interaction.guild);

			                return reply(`✅ Cargos de Ranking configurados! Top 1: ${role1}, Top 2: ${role2}, Top 3: ${role3}. Os cargos serão atualizados a cada 1 minuto.`);
			            }
				            case 'setrankvoid': { const channel = options.getChannel('channel'); if (!channel.isTextBased()) return reply("❌ O canal deve ser de texto."); await interaction.deferReply({ ephemeral: true }); try { const lbData = await getLeaderboardEmbed(interaction.guild); const message = await channel.send({ embeds: lbData.embeds, components: lbData.components }); leaderboardConfig[interaction.guildId] = { channelId: channel.id, messageId: message.id }; saveLeaderboardConfig(); return interaction.editReply(`✅ Rank configurado em ${channel}.`); } catch (e) { return interaction.editReply("❌ Erro. Verifique minhas permissões no canal."); } }
	        case 'setupvoice': { const channel = options.getChannel('channel'); const category = options.getChannel('category'); if (channel.type !== 2) return reply("❌ O canal de criação deve ser de voz."); if (category.type !== 4) return reply("❌ A categoria deve ser uma categoria."); voiceConfig[interaction.guildId] = { categoryId: category.id, createChannelId: channel.id }; saveVoiceConfig(); return reply(`✅ Sistema de voz temporária configurado!`); }
	        case 'adminpanel': {
	            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return reply("❌ Apenas administradores podem configurar o painel estático.");

	            const embed = new EmbedBuilder()
	                .setTitle("<a:_dev1:1329746208553701376> Centro de Comando de Moderação")
	                .setDescription("Bem-vindo ao painel de moderação oficial. Este painel é uma ferramenta estática para a equipe de staff gerenciar membros com rapidez e eficiência.\n\n**Como usar:**\n1. Clique no botão da ação desejada.\n2. Uma janela (modal) será aberta para você inserir o ID do membro e o motivo.\n3. A ação será executada e registrada nos logs.")
		                .addFields(
		                    { name: "🔨 Punições Pesadas", value: "Banimentos e Expulsões permanentes ou temporárias.", inline: false },
		                    { name: "⏱️ Controle de Comportamento", value: "Castigos (Timeout), Mutes de voz e Avisos.", inline: false }
		                )
	                .setColor(globalConfig.embedColor)
	                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
		                .setImage(globalConfig.banners?.moderacao === 'none' ? null : (globalConfig.banners?.moderacao || "https://i.imgur.com/lNjOG8B.jpeg"))
	                .setFooter({ text: `Painel de Moderação • ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() })
	                .setTimestamp();

	            const row1 = new ActionRowBuilder().addComponents(
	                new ButtonBuilder().setCustomId('admin_ban').setLabel('Banir').setStyle(ButtonStyle.Danger).setEmoji('🔨'),
	                new ButtonBuilder().setCustomId('admin_kick').setLabel('Expulsar').setStyle(ButtonStyle.Danger).setEmoji('🚪'),
	                new ButtonBuilder().setCustomId('admin_timeout').setLabel('Castigar').setStyle(ButtonStyle.Secondary).setEmoji('⏱️'),
	                new ButtonBuilder().setCustomId('admin_mute').setLabel('Mutar Voz').setStyle(ButtonStyle.Secondary).setEmoji('🔇')
	            );

	            const row2 = new ActionRowBuilder().addComponents(
	                new ButtonBuilder().setCustomId('admin_warn').setLabel('Avisar').setStyle(ButtonStyle.Primary).setEmoji('⚠️')
	            );

		            await interaction.channel.send({ embeds: [embed], components: [row1, row2] });
		            return reply("✅ Painel de moderação estático enviado com sucesso!", true);
		        }
		        case 'updatelog': {
		            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return reply("❌ Você precisa ser administrador.");

		            if (!updateLogBuffer || updateLogBuffer.length === 0) return reply("ℹ️ Não há novas atualizações registradas no momento.");

		            const embed = new EmbedBuilder()
		                .setColor("#000102")
		                .setAuthor({ name: "VoidSynth | System Update", iconURL: client.user.displayAvatarURL() })
		                .setTitle("Changelog de Atualização")
		                .setDescription("As seguintes alterações foram aplicadas ao núcleo do sistema para melhorar a performance e experiência do usuário.")
		                .setTimestamp()
		                .setFooter({ text: " ", iconURL: interaction.guild.iconURL() });

		            const changesText = updateLogBuffer.map(log => `### ${log.title}\n${log.description}`).join('\n\n');
		            embed.addFields({ name: "Alterações Técnicas", value: changesText.substring(0, 1024) });

                    await interaction.channel.send({ embeds: [embed] });

                    updateLogBuffer = [];
                    saveUpdateLogBuffer();

                    return reply({ content: "✅ Log de atualização enviado e buffer limpo.", ephemeral: true });
		        }
		        case 'setupdatelog': {
		            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return reply("❌ Você precisa ser administrador.");
		            const channel = options.getChannel('channel');
		            if (!channel.isTextBased()) return reply("❌ O canal deve ser de texto.");

		            updateLogConfig[interaction.guildId] = { channelId: channel.id };
		            saveUpdateLogConfig();
		            return reply(`✅ Canal de logs de atualização configurado para ${channel}.`);
		        }

	        case 'vcpanel': {
	            const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
	                .setAuthor({ name: interaction.guild.name, iconURL: interaction.guild.iconURL() })
	                .setTitle("Menu do Gerenciador de Voz")
	                .setDescription("Bem-vindo à interface do Gerenciador de Voz! Aqui você pode gerenciar seus canais de voz com facilidade. Abaixo estão as opções disponíveis.")
	                .addFields(
	                    { name: "🔒 Trancar", value: "Tranca seu canal de voz.", inline: true },
	                    { name: "🔓 Destrancar", value: "Destranca seu canal de voz.", inline: true },
	                    { name: "👁️ Ocultar", value: "Oculta seu canal de voz.", inline: true },
	                    { name: "📢 Revelar", value: "Revela seu canal de voz oculto.", inline: true },
	                    { name: "✏️ Renomear", value: "Renomeia seu canal de voz.", inline: true },
	                    { name: "👑 Reivindicar", value: "Reivindica um canal de voz sem dono.", inline: true },
	                    { name: "➕ Aumentar", value: "Aumenta o limite de usuários.", inline: true },
	                    { name: "➖ Diminuir", value: "Diminui o limite de usuários.", inline: true },
	                    { name: "🚫 Expulsar", value: "Expulsa um usuário do seu canal.", inline: true }
	                )
	                .setThumbnail(client.user.displayAvatarURL());
	            const row1 = new ActionRowBuilder().addComponents(
	                new ButtonBuilder().setCustomId('vcLock').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
	                new ButtonBuilder().setCustomId('vcUnlock').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
	                new ButtonBuilder().setCustomId('vcHide').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
	                new ButtonBuilder().setCustomId('vcReveal').setEmoji('📢').setStyle(ButtonStyle.Secondary),
	                new ButtonBuilder().setCustomId('vcRename').setEmoji('✏️').setStyle(ButtonStyle.Secondary)
	            );
	            const row2 = new ActionRowBuilder().addComponents(
	                new ButtonBuilder().setCustomId('vcClaim').setEmoji('👑').setStyle(ButtonStyle.Secondary),
	                new ButtonBuilder().setCustomId('vcIncrease').setEmoji('➕').setStyle(ButtonStyle.Secondary),
	                new ButtonBuilder().setCustomId('vcDecrease').setEmoji('➖').setStyle(ButtonStyle.Secondary),
	                new ButtonBuilder().setCustomId('vcKick').setEmoji('🚫').setStyle(ButtonStyle.Secondary)
	            );
	            await interaction.channel.send({ embeds: [embed], components: [row1, row2] });
	            return reply("✅ Painel de controle de voz enviado!");
	        }
	        case 'setregister': { const channel = options.getChannel('channel'); const role = options.getRole('role'); const gifUrl = options.getString('gif_url'); if (!channel.isTextBased()) return reply("❌ O canal deve ser de texto."); const description = `Clique no botão para receber o cargo **${role.name}** e acessar o servidor.`; const embed = new EmbedBuilder().setColor(globalConfig.embedColor).setTitle("🚨 Verificação").setDescription(description).setColor(globalConfig.embedColor); if (gifUrl) embed.setImage(gifUrl); const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`register_${role.id}`).setLabel('Verificar').setStyle(ButtonStyle.Success)); await channel.send({ embeds: [embed], components: [row] }).then(() => reply(`✅ Mensagem de registro enviada.`)).catch(() => reply("❌ Erro ao enviar a mensagem.")); return; }
	        case 'setwelcome': case 'setlogchannel': { const channel = options.getChannel('channel'); if (!channel.isTextBased()) return reply("❌ O canal deve ser de texto."); const config = commandName === 'setwelcome' ? welcomeConfig : logConfig; const key = commandName === 'setwelcome' ? 'welcomeChannelId' : 'channelId'; config[interaction.guildId] = { [key]: channel.id }; commandName === 'setwelcome' ? saveWelcomeConfig() : saveLogConfig(); return reply(`✅ Canal de ${commandName === 'setwelcome' ? 'boas-vindas' : 'logs'} configurado para ${channel}.`); }
case 'antinuke': { if (!antinukeConfig[interaction.guildId]) antinukeConfig[interaction.guildId] = { enabled: false, maxDeletes: 3, timeWindow: 10 }; antinukeConfig[interaction.guildId].enabled = options.getString('action') === 'enable'; saveAntinukeConfig(); return reply(`✅ Sistema Antinuke **${options.getString('action') === 'enable' ? 'ATIVADO' : 'DESATIVADO'}**.`); }
case 'verify':
						        case 'edit-verify': {
						            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return reply("❌ Você precisa ser administrador.");

						            const isEdit = commandName === 'edit-verify';
						            const messageId = isEdit ? options.getString('message_id') : null;
						            let currentVerify = isEdit ? verifyConfig[messageId] : null;

						            if (isEdit && !currentVerify) return reply("❌ Painel não encontrado. Verifique o ID da mensagem.");

let bannerInput = options.getString('banner');
							            let newBanner = isEdit ? (bannerInput === 'remover' ? null : (bannerInput || currentVerify.banner)) : bannerInput;
							            let thumbInput = options.getString('thumbnail');
							            let newThumb = isEdit ? (thumbInput === 'remover' ? null : (thumbInput || (currentVerify ? currentVerify.thumbnail : null))) : thumbInput;
							            let newTitle = isEdit ? (options.getString('titulo') || (currentVerify ? currentVerify.title : null)) : options.getString('titulo');
							            let newDescription = isEdit ? (options.getString('descricao') || (currentVerify ? currentVerify.description : null)) : options.getString('descricao');
						            let items = isEdit ? JSON.parse(JSON.stringify(currentVerify.items)) : [];

						            if (!isEdit) {
						                items = [];
						                for (let i = 1; i <= 10; i++) {
						                    const role = options.getRole(`cargo${i}`);
						                    const emoji = options.getString(`emoji${i}`);
						                    if (role) {
						                        items.push({ roleId: role.id, roleName: role.name, emoji: emoji || '🔹' });
						                    }
						                }
						            }

						            if (items.length === 0) return reply("❌ Você precisa adicionar pelo menos um cargo.");

						            let listText = "";
						            const selectMenu = new StringSelectMenuBuilder()
						                .setCustomId('verify_select_menu')
						                .setPlaceholder('Selecione um cargo para resgatar...');

						            items.forEach(item => {
						                listText += `${item.emoji} <@&${item.roleId}>\n`;
						                selectMenu.addOptions({
						                    label: item.roleName,
						                    value: item.roleId,
						                    emoji: item.emoji
						                });
						            });

							            const embed = new EmbedBuilder()
							                .setColor(globalConfig.embedColor)
							                .setTitle(newTitle)
							                .setDescription(`${newDescription}\n\n${listText}`);

							            if (newThumb) embed.setThumbnail(newThumb);

							            if (newBanner) embed.setImage(newBanner);

						            const row = new ActionRowBuilder().addComponents(selectMenu);

						            if (isEdit) {
						                try {
						                    const message = await interaction.channel.messages.fetch(messageId);
						                    await message.edit({ embeds: [embed], components: [row] });
						                    verifyConfig[messageId] = { banner: newBanner, thumbnail: newThumb, title: newTitle, description: newDescription, items: items };
						                    saveVerifyConfig();
						                    return reply("✅ Painel de verificação editado com sucesso!");
						                } catch (e) {
						                    return reply("❌ Erro ao editar a mensagem. Verifique se ela está neste canal.");
						                }
						            } else {
						                const sent = await interaction.channel.send({ embeds: [embed], components: [row] });
						                verifyConfig[sent.id] = { banner: newBanner, thumbnail: newThumb, title: newTitle, description: newDescription, items: items };
						                saveVerifyConfig();
						                return reply(`✅ Painel enviado! ID: \`${sent.id}\``);
						            }
						        }
					        case 'config-loja':
					        case 'editar-loja':
					        case 'editar-item':
					        case 'atualizar-loja': {
				            const isEdit = commandName === 'editar-loja';
				            const isEditItem = commandName === 'editar-item';
				            const isUpdate = commandName === 'atualizar-loja';
				            const messageId = (isEdit || isEditItem || isUpdate) ? options.getString('message_id') : null;

				            let currentShop = (isEdit || isEditItem || isUpdate) ? (shopConfig[messageId] || Object.values(shopConfig).find(s => s.messageId === messageId)) : null;

				            if ((isEdit || isEditItem || isUpdate) && !currentShop) {
				                return reply("❌ Não encontrei dados salvos para esta loja. Verifique o ID da mensagem.");
				            }

	let newBanner = currentShop ? currentShop.banner : (options.getString('banner') || (globalConfig.banners?.loja === 'none' ? null : (globalConfig.banners?.loja || "https://i.imgur.com/LsI8SSq.gif")));
							            let newThumb = currentShop ? currentShop.thumbnail : options.getString('thumbnail');
							            let newTitle = currentShop ? currentShop.title : `<a:dollar39:1465353629849354556> Loja do Servidor | ${interaction.guild.name}`;
							            let newDescription = currentShop ? currentShop.description : "Adquira cargos exclusivos utilizando seu saldo bancário!\n\n";
						            let finalItems = currentShop ? JSON.parse(JSON.stringify(currentShop.items)) : [];

						            if (commandName === 'config-loja') {
						                newBanner = options.getString('banner');
						                finalItems = [];
						                for (let i = 1; i <= 10; i++) {
						                    const role = options.getRole(`cargo${i}`);
						                    const price = options.getNumber(`preco${i}`);
						                    if (role && price) {
						                        finalItems.push({ roleId: role.id, roleName: role.name, price: price, emoji: '<a:green:1242502724000546826>' });
						                    }
						                }
} else if (isEdit) {
						                const bannerOpt = options.getString('banner');
						                const thumbOpt = options.getString('thumbnail');
						                const titleOpt = options.getString('titulo');
						                const descOpt = options.getString('descricao');
						                if (bannerOpt === 'remover') newBanner = null;
						                else if (bannerOpt) newBanner = bannerOpt;
						                if (thumbOpt === 'remover') newThumb = null;
						                else if (thumbOpt) newThumb = thumbOpt;
						                if (titleOpt) newTitle = titleOpt;
						                if (descOpt) newDescription = descOpt;
						            } else if (isEditItem) {
				                const itemIndex = options.getInteger('item_numero') - 1;
				                const role = options.getRole('cargo');
				                const price = options.getNumber('preco');
				                const emoji = options.getString('emoji');

				                if (!finalItems[itemIndex]) {
				                    if (!role || !price) return reply(`❌ O item #${itemIndex + 1} não existe nesta loja. Para criar um novo item, você deve fornecer pelo menos o cargo e o preço.`);
				                    finalItems[itemIndex] = { roleId: role.id, roleName: role.name, price: price, emoji: emoji || '<a:green:1242502724000546826>' };
				                } else {
				                    if (role) { finalItems[itemIndex].roleId = role.id; finalItems[itemIndex].roleName = role.name; }
				                    if (price) finalItems[itemIndex].price = price;
				                    if (emoji) finalItems[itemIndex].emoji = emoji;
				                }
				            }

				            if (finalItems.length === 0) return reply("❌ A loja precisa ter pelo menos um cargo.");

				            const embed = new EmbedBuilder()
				                .setColor(globalConfig.embedColor)
				                .setTitle(newTitle)
				                .setDescription(newDescription)
.setImage(newBanner)
					                .setThumbnail(newThumb || (isEdit ? null : interaction.guild.iconURL({ dynamic: true })))
					                .setTimestamp();

				            const selectMenu = new StringSelectMenuBuilder()
				                .setCustomId('shop_buy_menu')
				                .setPlaceholder('Selecione um cargo para comprar...');

				            const leftColumn = finalItems.slice(0, 5);
				            const rightColumn = finalItems.slice(5, 10);

				            let leftColumnText = "";
				            leftColumn.forEach(item => {
				                const itemEmoji = item.emoji || '<a:green:1242502724000546826>';
				                leftColumnText += `${itemEmoji} <@&${item.roleId}>\n└ **Preço:** \`${formatDollars(item.price)}\`\n\n`;
				            });

				            let rightColumnText = "";
				            rightColumn.forEach(item => {
				                const itemEmoji = item.emoji || '<a:green:1242502724000546826>';
				                rightColumnText += `${itemEmoji} <@&${item.roleId}>\n└ **Preço:** \`${formatDollars(item.price)}\`\n\n`;
				            });

				            finalItems.forEach(item => {
				                selectMenu.addOptions({
				                    label: `Comprar ${item.roleName}`,
				                    description: `Preço: ${formatDollars(item.price)}`,
				                    value: item.roleId,
				                    emoji: item.emoji || '<a:green:1242502724000546826>'
				                });
				            });

				            if (leftColumnText) embed.addFields({ name: "<a:dollar39:1465353629849354556> Cargos Disponíveis", value: leftColumnText, inline: true });
				            if (rightColumnText) embed.addFields({ name: "<a:dollar39:1465353629849354556> Mais Opções", value: rightColumnText, inline: true });

				            const row = new ActionRowBuilder().addComponents(selectMenu);

				            if (isEdit || isEditItem || isUpdate) {
				                try {
				                    const message = await interaction.channel.messages.fetch(messageId);
				                    await message.edit({ embeds: [embed], components: [row] });
				                    shopConfig[messageId] = { messageId: messageId, banner: newBanner, thumbnail: newThumb, title: newTitle, description: newDescription, items: finalItems };
				                    saveShopConfig();
				                    return reply(`✅ Loja ${isEdit ? 'editada' : isEditItem ? 'item editado' : 'atualizada'} com sucesso!`);
				                } catch (e) {
				                    console.error(e);
				                    return reply("❌ Não foi possível encontrar ou editar a mensagem. Verifique o ID.");
				                }
					            } else {
				                const sentMessage = await interaction.channel.send({ embeds: [embed], components: [row] });
shopConfig[sentMessage.id] = { messageId: sentMessage.id, banner: newBanner, thumbnail: newThumb, title: newTitle, description: newDescription, items: finalItems };
					                saveShopConfig();
						            return reply(`✅ Loja enviada com sucesso! ID: \`${sentMessage.id}\``);
					            }
					            return;
					        }
					        case 'filtro': {
					            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return reply("❌ Você precisa ser administrador.");

					            const acao = options.getString('acao');
					            const palavra = options.getString('palavra');
					            const guildId = interaction.guildId;

					            if (!wordFilterConfig[guildId]) wordFilterConfig[guildId] = { words: [] };

					            if (acao === 'add') {
					                if (!palavra) return reply("❌ Você precisa especificar uma palavra.");
					                if (wordFilterConfig[guildId].words.includes(palavra.toLowerCase())) return reply("❌ Esta palavra já está no filtro.");

					                wordFilterConfig[guildId].words.push(palavra.toLowerCase());
					                saveWordFilterConfig();
					                return reply(`✅ Palavra \`${palavra}\` adicionada ao filtro.`);
					            } else if (acao === 'remove') {
					                if (!palavra) return reply("❌ Você precisa especificar uma palavra.");
					                const index = wordFilterConfig[guildId].words.indexOf(palavra.toLowerCase());
					                if (index === -1) return reply("❌ Esta palavra não está no filtro.");

					                wordFilterConfig[guildId].words.splice(index, 1);
					                saveWordFilterConfig();
					                return reply(`✅ Palavra \`${palavra}\` removida do filtro.`);
					            } else if (acao === 'list') {
					                const words = wordFilterConfig[guildId].words;
					                if (words.length === 0) return reply("ℹ️ Não há palavras no filtro deste servidor.");

					                const embed = new EmbedBuilder()
					                    .setTitle("🚫 Palavras Filtradas")
					                    .setColor(globalConfig.embedColor)
					                    .setDescription(words.map(w => `• ${w}`).join('\n'))
					                    .setTimestamp();

					                return reply({ embeds: [embed] });
					            }
					            return;
					        }
				    }
				});

		client.on('messageCreate', async message => {
		    if (message.author.bot || !message.guild) return;

			    const guildId = message.guild.id;

			    if (gptConfig[guildId] && gptConfig[guildId].channelId === message.channel.id) {
			        await message.channel.sendTyping();
			        try {
			            const response = await getChatGPTResponse(message.content);
			            return message.reply(response.length > 2000 ? response.substring(0, 1990) + "..." : response);
			        } catch (error) {
			            console.error("Erro no canal do ChatGPT:", error);
			            return message.reply("❌ Ocorreu um erro ao processar sua mensagem no ChatGPT.");
			        }
			    }
		    if (wordFilterConfig[guildId] && wordFilterConfig[guildId].words && wordFilterConfig[guildId].words.length > 0) {
		        const content = message.content.toLowerCase();
		        const hasBlockedWord = wordFilterConfig[guildId].words.some(word => content.includes(word.toLowerCase()));

		        if (hasBlockedWord) {

		            message.delete().catch(() => {});

		            const embed = new EmbedBuilder()
		                .setColor("#FF0000")
		                .setTitle("⚠️ Mensagem Bloqueada")
		                .setDescription(`Sua mensagem no servidor **${message.guild.name}** continha palavras proibidas e foi removida.`)
		                .setTimestamp();

		            return message.author.send({ embeds: [embed] }).catch(() => {

		                message.channel.send(`${message.author}, sua mensagem continha palavras proibidas e foi removida.`).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
		            });
		        }
		    }

	    const prefix = '!';
	    if (message.content.startsWith(prefix)) {
	        const args = message.content.slice(prefix.length).trim().split(/ +/);
	        const command = args.shift().toLowerCase();

	        if (command === 'dp') {

	            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {

	                return message.reply("❌ Você precisa ser administrador para usar este comando.").then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	            }

	            const targetUser = message.mentions.users.first();
	            const amount = parseInt(args[1]);

	            if (!targetUser || isNaN(amount) || amount <= 0) {
	                return message.reply(`Uso correto: \`${prefix}dp <@usuário> <quantia>\` (A quantia deve ser um número inteiro positivo).`)
	                    .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	            }

	            const userEconomy = getUser(targetUser.id, targetUser.tag);
	            userEconomy.bank += amount;
	            updateUser(targetUser.id, userEconomy);

	            const replyMessage = `✅ **${formatDollars(amount)}** adicionados ao banco de **${targetUser.tag}** (por ${message.author.tag}).`;

	            message.delete().catch(() => {});

	            return message.channel.send(replyMessage)
	                .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	        }

	        if (command === 'rm') {

	            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
	                return message.reply("❌ Você precisa ser administrador para usar este comando.").then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	            }

	            const targetUser = message.mentions.users.first();
	            const amountOrAll = args[1]?.toLowerCase();
	            let amount = 0;
	            let actionText = '';

	            if (!targetUser) {
	                return message.reply(`Uso correto: \`${prefix}rm <@usuário> [quantia | "all"]\`.`)
	                    .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	            }

	            const userEconomy = getUser(targetUser.id, targetUser.tag);

	            if (amountOrAll === 'all') {
	                amount = userEconomy.bank;
	                userEconomy.bank = 0;
	                actionText = 'removido todo o saldo ($' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ')';
	            } else {
	                amount = parseInt(amountOrAll);

	                if (isNaN(amount) || amount <= 0) {
	                    return message.reply(`Uso correto: \`${prefix}rm <@usuário> [quantia | "all"]\` (A quantia deve ser um número inteiro positivo ou "all").`)
	                        .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	                }

	                if (userEconomy.bank < amount) {
	                    amount = userEconomy.bank;
	                    userEconomy.bank = 0;
	                    actionText = `removido o saldo restante ($${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
	                } else {
	                    userEconomy.bank -= amount;
	                    actionText = `removido **${formatDollars(amount)}**`;
	                }
	            }

	            updateUser(targetUser.id, userEconomy);

	            const replyMessage = `✅ Saldo de **${targetUser.tag}** (${actionText}) com sucesso (por ${message.author.tag}). Novo saldo: **${formatDollars(userEconomy.bank)}**.`;

	            message.delete().catch(() => {});

	            return message.channel.send(replyMessage)
	                .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	        }

        if (command === "setlevel") {

            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply("❌ Você precisa ser administrador para usar este comando.")
                    .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
            }

            const targetUser = message.mentions.users.first();
            const level = parseInt(args[1]);

            if (!targetUser || isNaN(level) || level < 0) {
                return message.reply(`Uso correto: ${prefix}setlevel <@usuário> <nível> (O nível deve ser um número positivo).`)
                    .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
            }

            const guildId = message.guild.id;
            const userId = targetUser.id;

            if (!xp[guildId]) xp[guildId] = {};

            const newXP = level === 0 ? 0 : LEVELS[level - 1];

            xp[guildId][userId] = newXP;
            saveXP();

            const replyMessage = `✅ O nível de **${targetUser.tag}** foi definido para **${level}** (XP ajustado para ${newXP}).`;

            message.delete().catch(() => {});

            return message.channel.send(replyMessage)
                .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
        }
	        if (command === 'dp') {

	            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {

	                return message.reply("❌ Você precisa ser administrador para usar este comando.").then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	            }

	            const targetUser = message.mentions.users.first();
	            const amount = parseInt(args[1]);

	            if (!targetUser || isNaN(amount) || amount <= 0) {
	                return message.reply(`Uso correto: \`${prefix}dp <@usuário> <quantia>\` (A quantia deve ser um número inteiro positivo).`)
	                    .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	            }

	            const userEconomy = getUser(targetUser.id, targetUser.tag);
	            userEconomy.bank += amount;
	            updateUser(targetUser.id, userEconomy);

	            const replyMessage = `✅ **${formatDollars(amount)}** adicionados ao banco de **${targetUser.tag}** (por ${message.author.tag}).`;

	            message.delete().catch(() => {});

	            return message.channel.send(replyMessage)
	                .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000)).catch(() => {});
	        }
	    }

		    await addXP(message.guild, message.author, message.channel);
		});
	client.on('guildMemberAdd', async member => {
    const config = welcomeConfig[member.guild.id];
    if (!config?.welcomeChannelId) return;
    try {
        const channel = await member.guild.channels.fetch(config.welcomeChannelId);
        if (channel?.isTextBased()) {
            const embed = new EmbedBuilder()
                .setColor(globalConfig.embedColor)
                .setTitle(`Bem vindo ao VoidSynth`)
                .setDescription(`> <#1495734185833271488>\n> <#1418634171164921919>\n\nPor favor, não ping a staff`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }));

            await channel.send({ content: `${member}`, embeds: [embed] });
        }
    } catch (e) {
        console.error("Erro ao enviar mensagem de boas-vindas:", e);
    }
});

client.on('guildMemberRemove', async member => {
    const guildId = member.guild.id;
    const userId = member.id;

    if (xp[guildId] && xp[guildId][userId]) {
        delete xp[guildId][userId];
        saveXP();
        console.log(`🗑️ [Ranking] Usuário ${member.user.tag} (${userId}) removido do ranking de XP (saiu do servidor).`);
    }

    if (economy[userId]) {
        delete economy[userId];
        saveEconomy();
        console.log(`🗑️ [Economia] Usuário ${member.user.tag} (${userId}) removido da economia (saiu do servidor).`);
    }
});
			client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (newChannel.type !== 2) return;
    const ownerId = tempVcOwners.get(newChannel.id);
    if (ownerId && oldChannel.name !== newChannel.name) {
        customVoiceNames[ownerId] = newChannel.name;
        saveCustomVoiceNames();
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
			    const { guild, member } = newState;
			    if (!member || member.user.bot) return;

			    const userId = member.id;
			    const guildId = guild.id;

			    const config = voiceConfig[guildId];
			    if (config) {
			        const { categoryId, createChannelId } = config;

				        if (newState.channelId === createChannelId) {
				            try {
				                const savedName = customVoiceNames[member.id] || `Sala de ${member.user.username}`;
				                const channel = await guild.channels.create({ name: savedName, type: 2, parent: categoryId, permissionOverwrites: [{ id: member.id, allow: [PermissionsBitField.Flags.ManageChannels] }] });
				                await member.voice.setChannel(channel);
				                tempVcOwners.set(channel.id, member.id);
			                await sendLog(guild, new EmbedBuilder().setColor(globalConfig.embedColor).setTitle("🎤 Nova Sala Temporária").setColor(globalConfig.embedColor).setDescription(`### 🏠 Sala Criada

> **Dono:** ${member}
> **Canal:** ${channel.name}

O canal foi criado com sucesso e as permissões foram configuradas.`).setThumbnail(member.user.displayAvatarURL({ dynamic: true })));
			            } catch (e) { console.error("Erro ao criar canal de voz:", e); }
			        }

			        if (oldState.channel?.parentId === categoryId && oldState.channel.id !== createChannelId && oldState.channel.members.size === 0) {
			            try {
			                await oldState.channel.delete('Canal temporário vazio.');
			                tempVcOwners.delete(oldState.channel.id);
			                await sendLog(guild, new EmbedBuilder().setColor(globalConfig.embedColor).setTitle("🗑️ Canal Excluído").setColor(globalConfig.embedColor).setDescription(`**Canal:** ${oldState.channel.name}`));
			            } catch (e) {}
			        }
			    }

				    if (newState.channelId) {

				        if (!voiceXP[userId]) voiceXP[userId] = {};
				        if (!voiceXP[userId][guildId]) voiceXP[userId][guildId] = {};

				        if (!voiceXP[userId][guildId][newState.channelId]) {
				            voiceXP[userId][guildId][newState.channelId] = Date.now();
				        }
				    } else if (oldState.channelId) {

				        if (voiceXP[userId] && voiceXP[userId][guildId] && voiceXP[userId][guildId][oldState.channelId]) {
				            delete voiceXP[userId][guildId][oldState.channelId];
				        }
				    }

			    if (voiceXP[userId] && Object.keys(voiceXP[userId][guildId] || {}).length === 0) {
			        delete voiceXP[userId][guildId];
			    }
			    if (voiceXP[userId] && Object.keys(voiceXP[userId]).length === 0) {
			        delete voiceXP[userId];
			    }
			});

	async function handleAntinuke(actionType, target) { if (!antinukeConfig[target.guild.id]?.enabled) return; try { const auditLogs = await target.guild.fetchAuditLogs({ type: actionType, limit: 1 }); const log = auditLogs.entries.first(); if (!log || log.target.id !== target.id || log.executor.id === client.user.id || log.executor.bot) return; const antinukeActions = {}; const guildActions = antinukeActions[target.guild.id] = antinukeActions[target.guild.id] || {}; const userActions = guildActions[log.executor.id] = guildActions[log.executor.id] || {}; const actionList = userActions[actionType] = userActions[actionType] || []; const now = Date.now(); actionList.push(now); const recentActions = actionList.filter(ts => now - ts < 10000); userActions[actionType] = recentActions; if (recentActions.length >= (antinukeConfig[target.guild.id].maxDeletes || 3)) { const memberToBan = await target.guild.members.fetch(log.executor.id); if (memberToBan?.bannable) { await memberToBan.ban({ reason: `Antinuke: Limite de ações suspeitas excedido.` }); console.log(`✅ Antinuke: Usuário ${log.executor.tag} banido.`); } } } catch (e) {} }
	client.on('channelDelete', async (channel) => handleAntinuke(12, channel));
	client.on('roleDelete', async (role) => handleAntinuke(32, role));

async function handleJoinVC(interaction) {

    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
        return interaction.reply({ content: "❌ Você precisa estar em um canal de voz para usar este comando.", ephemeral: true });
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has(PermissionsBitField.Flags.Connect) || !permissions.has(PermissionsBitField.Flags.Speak)) {
        return interaction.reply({ content: `❌ Não tenho permissão para **Conectar** e **Falar** no canal de voz \`${voiceChannel.name}\`.`, ephemeral: true });
    }

    try {

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false,
        });

        const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
            .setColor(globalConfig.embedColor)
            .setTitle("✅ Conectado ao Canal de Voz")
            .setDescription(`Conectei-me ao canal **${voiceChannel.name}** e permanecerei aqui indefinidamente.`)
            .setFooter({ text: "O bot não irá reproduzir áudio." });

        return interaction.reply({ embeds: [embed], ephemeral: false });

    } catch (error) {
        console.error("Erro ao conectar ao canal de voz:", error);
        return interaction.reply({ content: "❌ Ocorreu um erro ao tentar conectar ao canal de voz.", ephemeral: true });
    }
}

function saveVoidSmsConfig() { saveConfig('./tell_config.json', voidSmsConfig); }

async function generateVoidSmsImage(options) {
    const { recipientName = 'Usuário', recipientAvatar = '', senderName = 'Anônimo', senderAvatar = '', message = '', isAnonymous = false } = options;
    const width = 600; const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#000102'; ctx.fillRect(0, 0, 5, height);

    ctx.fillStyle = '#000102'; ctx.font = 'bold 24px Arial'; ctx.fillText('MENSAGEM', 30, 40);

    const badgeText = isAnonymous ? 'ANÔNIMO' : 'PÚBLICO';
    ctx.fillStyle = isAnonymous ? '#ff6b6b' : '#51cf66';
    const badgeWidth = ctx.measureText(badgeText).width + 20;
    ctx.beginPath(); ctx.roundRect(width - 50 - badgeWidth, 20, badgeWidth, 30, 5); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 12px Arial'; ctx.fillText(badgeText, width - 40 - badgeWidth, 40);

    ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(30, 60); ctx.lineTo(width - 30, 60); ctx.stroke();

    const drawAvatar = async (avatarUrl, x, y, size = 30) => {
        try {
            if (!avatarUrl) return;
            const response = await fetch(avatarUrl);
            if (!response.ok) throw new Error(`Falha ao baixar avatar: ${response.statusText}`);

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const img = new (require('canvas').Image)();
            img.src = buffer;

            ctx.save();
            ctx.beginPath();
            ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(img, x, y, size, size);
            ctx.restore();
        } catch (e) {
            console.log("Erro ao carregar avatar:", e.message);
        }
    };

    if (recipientAvatar) await drawAvatar(recipientAvatar, 30, 75, 35);
    if (senderAvatar && !isAnonymous) await drawAvatar(senderAvatar, 30, 135, 35);

    ctx.fillStyle = '#666666'; ctx.font = '12px Arial'; ctx.fillText('Para', 75, 90);
    ctx.fillStyle = '#000102'; ctx.font = 'bold 14px Arial'; ctx.fillText(recipientName, 75, 110);

    ctx.fillStyle = '#666666'; ctx.font = '12px Arial'; ctx.fillText('De', 75, 150);
    ctx.fillStyle = '#000102'; ctx.font = 'bold 14px Arial'; ctx.fillText(senderName, 75, 170);

    ctx.fillStyle = '#333333'; ctx.font = '14px Arial';
    const words = message.split(' '); let line = ''; let y = 220;
    for (let word of words) {
        if (ctx.measureText(line + word).width > 540) { ctx.fillText(line, 30, y); line = word + ' '; y += 20; }
        else { line += word + ' '; }
    }
    ctx.fillText(line, 30, y);

    ctx.fillStyle = '#999999'; ctx.font = '11px Arial';
    ctx.fillText(`Enviado em ${new Date().toLocaleDateString('pt-BR')}`, 30, height - 20);

    return canvas.toBuffer('image/png');
}

async function handleVoidSmsModal(interaction) {
    const recipientInput = interaction.fields.getTextInputValue('voidsms_recipient');
    const messageContent = interaction.fields.getTextInputValue('voidsms_message');
    const anonymousInput = interaction.fields.getTextInputValue('voidsms_anonymous').toLowerCase();
    const isAnonymous = anonymousInput === 'sim';
    const TELL_COST = 2500;

    let recipientId = recipientInput.replace(/[<@!>]/g, '');
    let recipient = await interaction.client.users.fetch(recipientId).catch(() => null);

    if (!recipient) {
        try {
            const foundMembers = await interaction.guild.members.search({ query: recipientInput, limit: 1 });
            const foundMember = foundMembers.first();
            if (foundMember) {
                recipient = foundMember.user;
            }
        } catch (e) {
            console.log("Erro na busca de membros:", e.message);
        }
    }

    if (!recipient) return interaction.reply({ content: '<a:xo_cross:1477009057427624072> Usuário não encontrado. Tente digitar o nome completo ou mencionar a pessoa.', ephemeral: true });

    if (recipient.id === interaction.user.id) return interaction.reply({ content: '<a:xo_cross:1477009057427624072> Você não pode enviar uma mensagem para você mesmo.', ephemeral: true });

    if (!voidSmsConfig.messagesChannelId) return interaction.reply({ content: '<a:xo_cross:1477009057427624072> Canal de mensagens não configurado.', ephemeral: true });
    const channel = interaction.guild.channels.cache.get(voidSmsConfig.messagesChannelId);
    if (!channel) return interaction.reply({ content: '<a:xo_cross:1477009057427624072> Canal de mensagens não encontrado.', ephemeral: true });

    const userId = interaction.user.id;
    const user = getUser(userId, interaction.user.tag);
    if (user.bank < TELL_COST) {
        const needed = TELL_COST - user.bank;
        return interaction.reply({ content: `<a:xo_cross:1477009057427624072> Você não tem saldo suficiente! Custa **$${formatDollars(TELL_COST)}** e você tem apenas **$${formatDollars(user.bank)}**. Você precisa de mais **$${formatDollars(needed)}**.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    user.bank -= TELL_COST;
    updateUser(userId, user);

        const imageBuffer = await generateVoidSmsImage({
        recipientName: recipient.username,
        recipientAvatar: recipient.displayAvatarURL({ extension: 'png', size: 256 }),
        senderName: isAnonymous ? 'Anônimo' : interaction.user.username,
        senderAvatar: isAnonymous ? '' : interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
        message: messageContent,
        isAnonymous: isAnonymous
    });

    const attachment = new AttachmentBuilder(imageBuffer, { name: 'voidsms.png' });
    const embed = new EmbedBuilder()
        .setColor('#000102')
        .setTitle('<a:1689ringingphone:1477618877369290906> Void SMS - Nova Mensagem')
        .setDescription(`${recipient}, você recebeu uma **${isAnonymous ? 'mensagem anônima' : 'mensagem pública'}**!`)
        .setImage('attachment://voidsms.png')
        .setFooter({ text: 'Void SMS - Sistema de Mensagens' });

    await channel.send({ content: `${recipient}`, embeds: [embed], files: [attachment] });

    if (voidSmsConfig.logChannelId) {
        const logChannel = interaction.guild.channels.cache.get(voidSmsConfig.logChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor('#000102')
                .setTitle('📝 Log de Void SMS')
                .addFields(
                    { name: 'Autor', value: `${interaction.user} (${interaction.user.id})`, inline: true },
                    { name: 'Destinatário', value: `${recipient} (${recipient.id})`, inline: true },
                    { name: 'Anônimo', value: isAnonymous ? 'Sim' : 'Não', inline: true },
                    { name: 'Mensagem', value: messageContent }
                )
                .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
        }
    }

    await interaction.editReply({ content: `<a:checkmark_void88:1320743200591188029> Mensagem enviada para **${recipient.username}**! Você pagou **$${formatDollars(TELL_COST)}** pelo Void SMS.` });
}

setInterval(async () => {
    const now = Date.now();
    for (const guildId in bumpConfig) {
        const config = bumpConfig[guildId];
        if (config.nextBump > 0 && now >= config.nextBump && !config.notified) {
            config.notified = true;
            saveBumpConfig();

            try {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;

                let usersToNotify = [];
                if (config.roleId) {
                    try {
                        const role = await guild.roles.fetch(config.roleId);
                        if (role) {

                            const members = await guild.members.fetch();
                            usersToNotify = members.filter(m => m.roles.cache.has(config.roleId)).map(m => m.user);
                        }
                    } catch (e) {
                        console.error(`Erro ao buscar membros do cargo ${config.roleId}:`, e);
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor('#000102')
                    .setTitle('<a:rocket:1466151179049238549> Bump Disponível!')
                    .setDescription(`O tempo de espera de 2 horas acabou no servidor **${guild.name}**!\nO bump já pode ser feito novamente.`)
                    .setTimestamp();

                for (const user of usersToNotify) {
                    try {
                        await user.send({ embeds: [embed] });
                    } catch (e) {
                        console.error(`Não foi possível enviar DM para ${user.tag}`);
                    }
                }
            } catch (e) {
                console.error(`Erro ao processar notificação de bump para guilda ${guildId}:`, e);
            }
        }
    }
}, 60000);

client.login(process.env.TOKEN);

loadConfig('./spotify_history.json', spotifyHistory, 'Histórico Spotify');

	async function handleBank(interaction) {
	    const userId = interaction.user.id;
	    const user = getUser(userId, interaction.user.tag);

	    const embed = new EmbedBuilder().setColor(globalConfig.embedColor)
	        .setColor(globalConfig.embedColor)
	        .setTitle(`🏦 Banco de ${interaction.user.tag}`)
	        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
	        .setDescription("Use os botões para depositar ou sacar.")
	        .addFields(
	            { name: '<a:green:1242502724000546826> Carteira (Wallet)', value: formatDollars(user.wallet), inline: true },
	            { name: '🏦 Banco (Bank)', value: formatDollars(user.bank), inline: true }
	        );

	    const row = new ActionRowBuilder()
	        .addComponents(
	            new ButtonBuilder()
	                .setCustomId('bank_deposit')
	                .setLabel('Depositar')
	                .setStyle(ButtonStyle.Success)
	                .setEmoji('📥'),
	            new ButtonBuilder()
	                .setCustomId('bank_withdraw')
	                .setLabel('Sacar')
	                .setStyle(ButtonStyle.Primary)
	                .setEmoji('📤')
	        );

	    await interaction.reply({ content: `${interaction.user}`, embeds: [embed], components: [row], ephemeral: true });
	}

	async function handleDeposit(interaction) {
	    const modal = new ModalBuilder()
	        .setCustomId('modal_deposit')
	        .setTitle('Depositar')
	        .addComponents(
	            new ActionRowBuilder().addComponents(
	                new TextInputBuilder()
	                    .setCustomId('deposit_amount')
	                    .setLabel('Quantidade a depositar (ou "all")')
	                    .setStyle(TextInputStyle.Short)
	                    .setRequired(true)
	            )
	        );
	    await interaction.showModal(modal);
	}

	async function handleWithdraw(interaction) {
	    const modal = new ModalBuilder()
	        .setCustomId('modal_withdraw')
	        .setTitle('Sacar')
	        .addComponents(
	            new ActionRowBuilder().addComponents(
	                new TextInputBuilder()
	                    .setCustomId('withdraw_amount')
	                    .setLabel('Quantidade a sacar (ou "all")')
	                    .setStyle(TextInputStyle.Short)
	                    .setRequired(true)
	            )
	        );
	    await interaction.showModal(modal);
	}
