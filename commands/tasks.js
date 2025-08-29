import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import sheetsManager from '../utils/sheets.js';

export default {
    data: new SlashCommandBuilder()
        .setName('tasks')
        .setDescription('自分のタスク一覧を表示・完了')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('自分のタスク一覧を表示'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('complete')
                .setDescription('タスクを完了にする'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('urgent')
                .setDescription('3日以内の緊急タスクを表示'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('today')
                .setDescription('今日期限のタスクを表示'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('all')
                .setDescription('全体のタスク状況を表示'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('help')
                .setDescription('タスク管理botの使い方を表示')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'list':
                    await handleTasksList(interaction);
                    break;
                case 'complete':
                    await handleTasksComplete(interaction);
                    break;
                case 'urgent':
                    await handleUrgentTasks(interaction);
                    break;
                case 'today':
                    await handleTodayTasks(interaction);
                    break;
                case 'all':
                    await handleAllTasks(interaction);
                    break;
                case 'help':
                    await handleTasksHelp(interaction);
                    break;
            }
        } catch (error) {
            console.error('タスクコマンドエラー:', error);
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: `エラーが発生しました: ${error.message}`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: `エラーが発生しました: ${error.message}`,
                    ephemeral: true
                });
            }
        }
    }
};

async function handleTasksList(interaction) {
    await interaction.deferReply();

    const tasks = await sheetsManager.getUserTasks(interaction.user.id);

    if (tasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('素晴らしい！')
            .setDescription('未完了のタスクはありません！')
            .setColor(0xFFD700);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    // 5件ずつに分割して表示
    const chunks = [];
    for (let i = 0; i < tasks.length; i += 5) {
        chunks.push(tasks.slice(i, i + 5));
    }

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        const embed = new EmbedBuilder()
            .setTitle(`${interaction.user.displayName}さんのタスク (${i + 1}/${chunks.length})`)
            .setColor(0x3498DB);

        let description = '';
        chunk.forEach((task, index) => {
            const globalIndex = i * 5 + index + 1;
            const dueInfo = sheetsManager.formatDueDate(task.dueDate);
            const emoji = sheetsManager.getDueDateEmoji(task.dueDate);
            
            description += `**${globalIndex}.** ${task.name}\n`;
            description += `${emoji} ${dueInfo}\n`;
            description += `作成: ${task.createdAt}\n\n`;
        });

        embed.setDescription(description);

        if (i === chunks.length - 1) {
            embed.setFooter({ text: '/tasks complete でタスクを完了できます' });
        }

        if (i === 0) {
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.followUp({ embeds: [embed] });
        }
        
        if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

async function handleTasksComplete(interaction) {
    await interaction.deferReply();

    const tasks = await sheetsManager.getUserTasks(interaction.user.id);

    if (tasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('完了可能なタスクなし')
            .setDescription('未完了のタスクがありません')
            .setColor(0x95A5A6);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    // セレクトメニューを作成（最大25件まで表示）
    const selectOptions = tasks.slice(0, 25).map((task) => {
        const dueInfo = sheetsManager.formatDueDate(task.dueDate);
        const emoji = sheetsManager.getDueDateEmoji(task.dueDate);
        
        return {
            label: task.name.length > 50 ? `${task.name.substring(0, 47)}...` : task.name,
            description: `${emoji} ${dueInfo}`,
            value: task.id.toString()
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('complete_task_select')
        .setPlaceholder('完了するタスクを選択してください...')
        .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle('タスクを完了')
        .setDescription(`${tasks.length}件の未完了タスクがあります。\n完了するタスクを下から選択してください。`)
        .setColor(0x3498DB);

    await interaction.editReply({
        embeds: [embed],
        components: [row]
    });
}

async function handleUrgentTasks(interaction) {
    await interaction.deferReply();

    const allTasks = await sheetsManager.getUserTasks(interaction.user.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 3日以内または期限切れのタスクをフィルタ
    const urgentTasks = allTasks.filter(task => {
        if (!task.dueDate) return false;
        
        const dueDate = new Date(task.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        
        const diffTime = dueDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return diffDays <= 3;
    });

    if (urgentTasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('安心してください')
            .setDescription('3日以内の緊急タスクはありません！')
            .setColor(0x00FF00);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(`${interaction.user.displayName}さんの緊急タスク`)
        .setColor(0xFF0000);

    let description = '';
    urgentTasks.forEach((task, index) => {
        const dueInfo = sheetsManager.formatDueDate(task.dueDate);
        const emoji = sheetsManager.getDueDateEmoji(task.dueDate);
        
        description += `**${index + 1}.** ${task.name}\n`;
        description += `${emoji} ${dueInfo}\n\n`;
    });

    embed.setDescription(description);
    embed.setFooter({ text: '/tasks complete でタスクを完了できます' });

    await interaction.editReply({ embeds: [embed] });
}

async function handleTodayTasks(interaction) {
    await interaction.deferReply();

    const allTasks = await sheetsManager.getUserTasks(interaction.user.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 今日期限のタスクをフィルタ
    const todayTasks = allTasks.filter(task => {
        if (!task.dueDate) return false;
        
        const dueDate = new Date(task.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        
        return dueDate.getTime() === today.getTime();
    });

    if (todayTasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('今日のタスク')
            .setDescription('今日期限のタスクはありません！')
            .setColor(0x00FF00);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(`${interaction.user.displayName}さんの今日のタスク`)
        .setColor(0xFF0000);

    let description = '';
    todayTasks.forEach((task, index) => {
        description += `**${index + 1}.** ${task.name}\n`;
    });

    embed.setDescription(description);
    embed.setFooter({ text: '/tasks complete でタスクを完了できます' });

    await interaction.editReply({ embeds: [embed] });
}

async function handleAllTasks(interaction) {
    await interaction.deferReply();

    const allTasks = await sheetsManager.getAllTasks();
    
    if (!allTasks || allTasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('タスクなし')
            .setDescription('現在、登録されているタスクはありません')
            .setColor(0x95A5A6);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    // 未完了タスクのみを取得してユーザーごとに分類
    const pendingTasks = allTasks.filter(task => !task.completed);
    
    if (pendingTasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('全員完了！')
            .setDescription('すべてのタスクが完了しています！')
            .setColor(0x00FF00);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    const userTasks = {};
    
    pendingTasks.forEach(task => {
        const userName = task.userName || 'Unknown';
        if (!userTasks[userName]) {
            userTasks[userName] = [];
        }
        userTasks[userName].push(task);
    });

    // 各ユーザーのタスクを期限順にソート
    Object.keys(userTasks).forEach(userName => {
        userTasks[userName] = sheetsManager.sortTasksByUrgency(userTasks[userName]);
    });

    const embed = new EmbedBuilder()
        .setTitle('全体タスク状況')
        .setColor(0x3498DB);

    let description = '';
    
    for (const [userName, tasks] of Object.entries(userTasks)) {
        description += `**${userName}さん (${tasks.length}件):**\n`;
        
        tasks.slice(0, 5).forEach(task => {
            const dueInfo = sheetsManager.formatDueDate(task.dueDate);
            const emoji = sheetsManager.getDueDateEmoji(task.dueDate);
            description += `• ${task.name} - ${emoji} ${dueInfo}\n`;
        });
        
        if (tasks.length > 5) {
            description += `• ... 他${tasks.length - 5}件\n`;
        }
        
        description += '\n';
    }

    embed.setDescription(description);
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleTasksHelp(interaction) {
    await interaction.deferReply();

    // メッセージ1: 基本機能の説明
    const embed1 = new EmbedBuilder()
        .setTitle('タスク管理Bot 使い方ガイド (1/3)')
        .setDescription('Discordでの高機能タスク管理システム')
        .setColor(0x3498DB);

    embed1.addFields(
        {
            name: '基本的なタスク管理',
            value: '`/add task name:タスク名 due:期限` - 期限付きタスク追加\n' +
                   '`/add task name:タスク名` - 期限なしタスク追加\n' +
                   '`/tasks list` - 自分のタスク一覧表示\n' +
                   '`/tasks complete` - タスクを完了にする',
            inline: false
        },
        {
            name: '便利な追加コマンド',
            value: '`/add today name:タスク名` - 今日締切のタスク\n' +
                   '`/add tomorrow name:タスク名` - 明日締切のタスク\n' +
                   '`/add thisweek name:タスク名 weekday:曜日` - 今週締切のタスク',
            inline: false
        },
        {
            name: '確認・絞り込み',
            value: '`/tasks urgent` - 3日以内の緊急タスクのみ表示\n' +
                   '`/tasks today` - 今日期限のタスクのみ表示\n' +
                   '`/tasks all` - チーム全体のタスク状況',
            inline: false
        }
    );

    embed1.setFooter({ text: '続きを確認中...' });
    await interaction.editReply({ embeds: [embed1] });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // メッセージ2: 編集・削除機能
    const embed2 = new EmbedBuilder()
        .setTitle('タスク管理Bot 使い方ガイド (2/3)')
        .setDescription('編集・削除機能')
        .setColor(0xFF9500);

    embed2.addFields(
        {
            name: '編集機能',
            value: '`/edit select` - タスクを選択して編集\n' +
                   '• タスク名の変更\n' +
                   '• 期限の変更・削除\n' +
                   '• セレクトメニューで直感的に操作',
            inline: false
        },
        {
            name: '削除機能',
            value: '`/delete select` - 個別タスクを削除\n' +
                   '`/delete all` - 自分の全タスクを削除\n' +
                   '`/delete completed` - 完了済みタスクのみ削除\n' +
                   '`/delete pending` - 未完了タスクのみ削除',
            inline: false
        },
        {
            name: 'テスト・管理機能',
            value: '`/test connection` - Google Sheets接続確認\n' +
                   '`/test reminder` - 毎朝通知のテスト実行',
            inline: false
        }
    );

    embed2.setFooter({ text: '次: 期限指定の方法' });
    await interaction.followUp({ embeds: [embed2] });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // メッセージ3: 期限指定の詳細
    const embed3 = new EmbedBuilder()
        .setTitle('タスク管理Bot 使い方ガイド (3/3)')
        .setDescription('期限指定の方法')
        .setColor(0x00FF00);

    embed3.addFields(
        {
            name: '相対的な期限指定',
            value: '`今日` `明日` `明後日`\n' +
                   '`3日後` `7日後` `10日後` など\n' +
                   '`来週` `再来週` `来月`',
            inline: false
        },
        {
            name: '曜日指定',
            value: '**今週の曜日:** `月曜` `火曜` `金曜` など\n' +
                   '**来週の曜日:** `来週月曜` `来週金曜` など\n' +
                   '**英語も対応:** `monday` `friday` など',
            inline: false
        },
        {
            name: '具体的な日付指定',
            value: '**完全な日付:** `2025-12-25` `2025/12/25`\n' +
                   '**月日のみ:** `12/25` `12-25`\n' +
                   '※年省略時は今年として扱い、過去日は来年になります',
            inline: false
        },
        {
            name: '使用例',
            value: '```\n/add task name:レポート提出 due:明日\n/add task name:会議準備 due:来週金曜\n/add task name:買い物 due:3日後\n/add task name:プレゼン due:2025-12-31```',
            inline: false
        },
        {
            name: '自動機能',
            value: '毎朝一週間以内のタスクを自動通知\n期限切れや緊急タスクを色分け表示\nタスクは期限順で自動ソート',
            inline: false
        }
    );

    embed3.setFooter({ text: 'さあ、効率的なタスク管理を始めましょう！' });
    await interaction.followUp({ embeds: [embed3] });
}
