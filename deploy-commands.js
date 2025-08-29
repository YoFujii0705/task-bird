import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const commands = [];

// コマンドファイルを読み込み
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log('📋 スラッシュコマンドをデプロイ中...');

for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const command = await import(filePath);
    
    if ('data' in command.default && 'execute' in command.default) {
        commands.push(command.default.data.toJSON());
        console.log(`✅ ${command.default.data.name} を追加`);
    } else {
        console.log(`⚠️ 無効なコマンドファイル: ${file}`);
    }
}

// REST APIクライアント初期化
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

try {
    console.log(`🚀 ${commands.length}個のスラッシュコマンドをデプロイ開始...`);

    // グローバルコマンドとしてデプロイ
    const data = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
    );

    console.log(`🎉 ${data.length}個のスラッシュコマンドのデプロイが完了しました！`);
    
    // デプロイされたコマンドの一覧表示
    data.forEach(command => {
        console.log(`   - /${command.name}: ${command.description}`);
    });
    
} catch (error) {
    console.error('❌ スラッシュコマンドデプロイエラー:', error);
}
