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
                .setDescription('今日期限のタスクを表示')),

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

        await interaction.editReply({ embeds: [embed] });
        
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
    const selectOptions = tasks.slice(0, 25).map((task, index) => {
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
