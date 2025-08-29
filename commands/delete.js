import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import sheetsManager from '../utils/sheets.js';

export default {
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription('タスクを削除')
        .addSubcommand(subcommand =>
            subcommand
                .setName('select')
                .setDescription('削除するタスクをセレクトメニューから選択'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('all')
                .setDescription('自分のタスクを全て削除'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('completed')
                .setDescription('自分の完了済みタスクを削除'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('pending')
                .setDescription('自分の未完了タスクを削除')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'select':
                    await handleDeleteSelect(interaction);
                    break;
                case 'all':
                    await handleDeleteAll(interaction);
                    break;
                case 'completed':
                    await handleDeleteCompleted(interaction);
                    break;
                case 'pending':
                    await handleDeletePending(interaction);
                    break;
            }
        } catch (error) {
            console.error('削除コマンドエラー:', error);
            
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

async function handleDeleteSelect(interaction) {
    await interaction.deferReply();

    const tasks = await sheetsManager.getUserTasks(interaction.user.id, true); // 完了済みも含める

    if (tasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('削除可能なタスクなし')
            .setDescription('タスクがありません')
            .setColor(0x95A5A6);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    // セレクトメニューを作成（最大25件まで表示）
    const selectOptions = tasks.slice(0, 25).map((task) => {
        const dueInfo = sheetsManager.formatDueDate(task.dueDate);
        const emoji = sheetsManager.getDueDateEmoji(task.dueDate);
        const status = task.completed ? '✅' : '📝';
        
        return {
            label: task.name.length > 50 ? `${task.name.substring(0, 47)}...` : task.name,
            description: `${status} ${emoji} ${dueInfo}`,
            value: task.id.toString()
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('delete_task_select')
        .setPlaceholder('削除するタスクを選択してください...')
        .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle('タスクを削除')
        .setDescription(`${tasks.length}件のタスクがあります。\n削除するタスクを下から選択してください。\n\n⚠️ この操作は取り消せません`)
        .setColor(0xFF0000);

    await interaction.editReply({
        embeds: [embed],
        components: [row]
    });
}

async function handleDeleteAll(interaction) {
    await interaction.deferReply();

    const allTasks = await sheetsManager.getUserTasks(interaction.user.id, true);
    const pendingCount = allTasks.filter(task => !task.completed).length;
    const completedCount = allTasks.filter(task => task.completed).length;

    if (allTasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('削除するタスクなし')
            .setDescription('タスクがありません')
            .setColor(0x95A5A6);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    const confirmButton = new ButtonBuilder()
        .setCustomId('confirm_delete_all')
        .setLabel('全て削除')
        .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_delete')
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    const embed = new EmbedBuilder()
        .setTitle('全タスク削除の確認')
        .setDescription(`${interaction.user.displayName}さんのタスクを**全て**削除しますか？\n\n📊 **削除対象:**\n• 未完了タスク: ${pendingCount}件\n• 完了済みタスク: ${completedCount}件\n• **合計: ${allTasks.length}件**\n\n⚠️ **この操作は取り消せません**`)
        .setColor(0xFF0000);

    await interaction.editReply({
        embeds: [embed],
        components: [row]
    });
}

async function handleDeleteCompleted(interaction) {
    await interaction.deferReply();

    const allTasks = await sheetsManager.getUserTasks(interaction.user.id, true);
    const completedTasks = allTasks.filter(task => task.completed);

    if (completedTasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('削除するタスクなし')
            .setDescription('完了済みタスクがありません')
            .setColor(0x95A5A6);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    const confirmButton = new ButtonBuilder()
        .setCustomId('confirm_delete_completed')
        .setLabel('完了済み削除')
        .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_delete')
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    const embed = new EmbedBuilder()
        .setTitle('完了済みタスク削除の確認')
        .setDescription(`${interaction.user.displayName}さんの**完了済みタスク${completedTasks.length}件**を削除しますか？\n\n✅ 未完了タスクは保持されます\n⚠️ この操作は取り消せません`)
        .setColor(0xFF9500);

    await interaction.editReply({
        embeds: [embed],
        components: [row]
    });
}

async function handleDeletePending(interaction) {
    await interaction.deferReply();

    const pendingTasks = await sheetsManager.getUserTasks(interaction.user.id, false);

    if (pendingTasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('削除するタスクなし')
            .setDescription('未完了タスクがありません')
            .setColor(0x95A5A6);

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    const confirmButton = new ButtonBuilder()
        .setCustomId('confirm_delete_pending')
        .setLabel('未完了削除')
        .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_delete')
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    const embed = new EmbedBuilder()
        .setTitle('未完了タスク削除の確認')
        .setDescription(`${interaction.user.displayName}さんの**未完了タスク${pendingTasks.length}件**を削除しますか？\n\n✅ 完了済みタスクは保持されます\n⚠️ この操作は取り消せません`)
        .setColor(0xFF9500);

    await interaction.editReply({
        embeds: [embed],
        components: [row]
    });
}
