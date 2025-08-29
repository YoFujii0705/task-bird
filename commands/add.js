import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import sheetsManager from '../utils/sheets.js';
import { parseDueDate, formatDateForSheet, getDateAfterDays } from '../utils/dateParser.js';

export default {
    data: new SlashCommandBuilder()
        .setName('add')
        .setDescription('タスクを追加')
        .addSubcommand(subcommand =>
            subcommand
                .setName('task')
                .setDescription('期限付きまたは期限なしタスクを追加')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('タスク名')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('due')
                        .setDescription('期限 (例: 明日, 来週金曜, 2025-12-25)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('today')
                .setDescription('今日期限のタスクを追加')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('タスク名')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('tomorrow')
                .setDescription('明日期限のタスクを追加')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('タスク名')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('thisweek')
                .setDescription('今週期限のタスクを追加')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('タスク名')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('weekday')
                        .setDescription('曜日 (省略時は金曜日)')
                        .addChoices(
                            { name: '月曜日', value: '月曜' },
                            { name: '火曜日', value: '火曜' },
                            { name: '水曜日', value: '水曜' },
                            { name: '木曜日', value: '木曜' },
                            { name: '金曜日', value: '金曜' },
                            { name: '土曜日', value: '土曜' },
                            { name: '日曜日', value: '日曜' }
                        )
                        .setRequired(false))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'task':
                    await handleAddTask(interaction);
                    break;
                case 'today':
                    await handleAddTodayTask(interaction);
                    break;
                case 'tomorrow':
                    await handleAddTomorrowTask(interaction);
                    break;
                case 'thisweek':
                    await handleAddThisWeekTask(interaction);
                    break;
            }
        } catch (error) {
            console.error('タスク追加エラー:', error);
            
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

async function handleAddTask(interaction) {
    await interaction.deferReply();

    const taskName = interaction.options.getString('name');
    const dueText = interaction.options.getString('due');

    let dueDate = null;
    if (dueText) {
        dueDate = parseDueDate(dueText);
        if (!dueDate) {
            await interaction.editReply({
                content: `期限「${dueText}」を理解できませんでした。\n例: 明日, 来週金曜, 2025-12-25`
            });
            return;
        }
    }

    const taskData = {
        name: taskName,
        userId: interaction.user.id,
        userName: interaction.user.displayName,
        dueDate: dueDate ? formatDateForSheet(dueDate) : null
    };

    await sheetsManager.addTask(taskData);

    const embed = new EmbedBuilder()
        .setTitle('タスク追加完了')
        .setDescription(`**${taskName}**`)
        .setColor(0x00FF00)
        .setAuthor({ 
            name: interaction.user.displayName,
            iconURL: interaction.user.displayAvatarURL()
        });

    if (dueDate) {
        const dueInfo = sheetsManager.formatDueDate(dueDate);
        const emoji = sheetsManager.getDueDateEmoji(dueDate);
        embed.addFields({
            name: '期限',
            value: `${emoji} ${dueInfo}`,
            inline: false
        });
    } else {
        embed.addFields({
            name: '期限',
            value: '期限なし',
            inline: false
        });
    }

    await interaction.editReply({ embeds: [embed] });
}

async function handleAddTodayTask(interaction) {
    await interaction.deferReply();

    const taskName = interaction.options.getString('name');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const taskData = {
        name: taskName,
        userId: interaction.user.id,
        userName: interaction.user.displayName,
        dueDate: formatDateForSheet(today)
    };

    await sheetsManager.addTask(taskData);

    const embed = new EmbedBuilder()
        .setTitle('今日締切タスク追加完了')
        .setDescription(`**${taskName}**`)
        .setColor(0xFF0000)
        .setAuthor({ 
            name: interaction.user.displayName,
            iconURL: interaction.user.displayAvatarURL()
        })
        .addFields({
            name: '期限',
            value: '🔴 今日まで',
            inline: false
        });

    await interaction.editReply({ embeds: [embed] });
}

async function handleAddTomorrowTask(interaction) {
    await interaction.deferReply();

    const taskName = interaction.options.getString('name');
    const tomorrow = getDateAfterDays(1);

    const taskData = {
        name: taskName,
        userId: interaction.user.id,
        userName: interaction.user.displayName,
        dueDate: formatDateForSheet(tomorrow)
    };

    await sheetsManager.addTask(taskData);

    const embed = new EmbedBuilder()
        .setTitle('明日締切タスク追加完了')
        .setDescription(`**${taskName}**`)
        .setColor(0xFF9500)
        .setAuthor({ 
            name: interaction.user.displayName,
            iconURL: interaction.user.displayAvatarURL()
        })
        .addFields({
            name: '期限',
            value: '🟠 明日まで',
            inline: false
        });

    await interaction.editReply({ embeds: [embed] });
}

async function handleAddThisWeekTask(interaction) {
    await interaction.deferReply();

    const taskName = interaction.options.getString('name');
    const weekday = interaction.options.getString('weekday') || '金曜';

    const dueDate = parseDueDate(weekday);
    
    const taskData = {
        name: taskName,
        userId: interaction.user.id,
        userName: interaction.user.displayName,
        dueDate: formatDateForSheet(dueDate)
    };

    await sheetsManager.addTask(taskData);

    const dueInfo = sheetsManager.formatDueDate(dueDate);
    const emoji = sheetsManager.getDueDateEmoji(dueDate);

    const embed = new EmbedBuilder()
        .setTitle('今週締切タスク追加完了')
        .setDescription(`**${taskName}**`)
        .setColor(0x3498DB)
        .setAuthor({ 
            name: interaction.user.displayName,
            iconURL: interaction.user.displayAvatarURL()
        })
        .addFields({
            name: '期限',
            value: `${emoji} ${dueInfo}`,
            inline: false
        });

    await interaction.editReply({ embeds: [embed] });
}
