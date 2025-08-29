import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import express from 'express';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';

// 環境変数を読み込み
config();

// ファイルパス設定
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Discord クライアント初期化
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});

// コマンドコレクション
client.commands = new Collection();

// コマンドローダー
async function loadCommands() {
    const commandsPath = join(__dirname, 'commands');
    const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = join(commandsPath, file);
        const command = await import(filePath);
        
        if ('data' in command.default && 'execute' in command.default) {
            client.commands.set(command.default.data.name, command.default);
            console.log(`✅ コマンド読み込み: ${command.default.data.name}`);
        } else {
            console.log(`⚠️ 無効なコマンド: ${file}`);
        }
    }
}

// イベントローダー
async function loadEvents() {
    const eventsPath = join(__dirname, 'events');
    const eventFiles = readdirSync(eventsPath).filter(file => file.endsWith('.js'));

    for (const file of eventFiles) {
        const filePath = join(eventsPath, file);
        const event = await import(filePath);
        
        if (event.default.once) {
            client.once(event.default.name, (...args) => event.default.execute(...args));
        } else {
            client.on(event.default.name, (...args) => event.default.execute(...args));
        }
        console.log(`✅ イベント読み込み: ${event.default.name}`);
    }
}

// Express サーバー（UptimeRobot用）
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.json({
        status: 'Discord Task Bot is running!',
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        bot_ready: client.isReady(),
        timestamp: new Date().toISOString(),
        guilds: client.guilds.cache.size
    });
});

// 毎日通知のスケジュール（日本時間 9:00）
cron.schedule('0 9 * * *', async () => {
    console.log('📢 毎日通知を実行中...');
    try {
        const { sendDailyReminder } = await import('./utils/reminder.js');
        await sendDailyReminder(client);
    } catch (error) {
        console.error('❌ 毎日通知エラー:', error);
    }
}, {
    timezone: "Asia/Tokyo"
});

// 初期化とボット起動
async function initializeBot() {
    try {
        console.log('🚀 Discord Task Bot を起動中...');
        
        // コマンドとイベントを読み込み
        await loadCommands();
        await loadEvents();
        
        // Express サーバー起動
        app.listen(PORT, () => {
            console.log(`🌐 Webサーバー起動完了 (ポート: ${PORT})`);
        });
        
        // Discord ボット起動
        await client.login(process.env.DISCORD_BOT_TOKEN);
        
    } catch (error) {
        console.error('❌ 初期化エラー:', error);
        process.exit(1);
    }
}

// グローバルエラーハンドリング
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// ボット起動
initializeBot();
