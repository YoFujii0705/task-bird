import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import sheetsManager from '../utils/sheets.js';
import { parseDueDate, formatDateForSheet } from '../utils/dateParser.js';

export default {
    data: new SlashCommandBuilder()
        .setName('edit')
        .setDescription('タスクを編集')
        .addSubcommand(subcommand =>
            subcommand
                .setName('select')
                .setDescription('編集するタスクをセレクトメニューから選択'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('name')
                .setDescription('タスク名を変更')
                .addStringOption(option =>
                    option.setName('new_name')
                        .setDescription('新しいタスク名')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('due')
                .setDescription('期限を変更')
                .addStringOption(option =>
                    option.setName('new_due')
                        .setDescription('新しい期限 (例: 明日, 来週金曜, なし で期限削除)')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'select':
                    await handleEditSelect(interaction);
                    break;
                case 'name':
                    await handleEditName(interaction);
                    break;
                case 'due':
                    await handleEditDue(interaction);
                    break;
            }
        } catch (error) {
            console.error('編集コマンドエラー:', error);
            
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

async function handleEditSelect(interaction) {
    await interaction.deferReply();

    const tasks = await sheetsManager.getUserTasks(interaction.user.id);

    if (tasks.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('編集可能なタスクなし')
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
        .setCustomId('edit_task_select')
        .setPlaceholder('編集するタスクを選択してください...')
        .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle('タスクを編集')
        .setDescription(`${tasks.length}件の未完了タスクがあります。\n編集するタスクを下から選択してください。`)
        .setColor(0x3498DB);

    await interaction.editReply({
        embeds: [embed],
        components: [row]
    });
}

async function handleEditName(interaction) {
    await interaction.reply({
        content: '申し訳ございませんが、現在この機能は未実装です。\n代わりに `/edit select` でタスクを選択して編集してください。',
        ephemeral: true
    });
}

async function handleEditDue(interaction) {
    await interaction.reply({
        content: '申し訳ございませんが、現在この機能は未実装です。\n代わりに `/edit select` でタスクを選択して編集してください。',
        ephemeral: true
    });
}
