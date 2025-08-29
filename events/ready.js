export default {
    name: 'ready',
    once: true,
    async execute(client) {
        console.log(`Botがオンラインになりました: ${client.user.tag}`);
        console.log(`サーバー数: ${client.guilds.cache.size}`);
        
        // Google Sheetsの接続テスト
        try {
            const { default: sheetsManager } = await import('../utils/sheets.js');
            const isConnected = await sheetsManager.initialize();
            if (isConnected) {
                console.log('Google Sheets接続成功');
            } else {
                console.log('Google Sheets接続失敗');
            }
        } catch (error) {
            console.error('Google Sheets接続エラー:', error);
        }
    },
};
