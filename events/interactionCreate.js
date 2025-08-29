import { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import sheetsManager from '../utils/sheets.js';

export default {
    name: 'interactionCreate',
    async execute(interaction) {
        // スラッシュコマンドの処理
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`コマンド ${interaction.commandName} が見つかりません。`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`コマンド実行エラー: ${interaction.commandName}`, error);
                
                const errorMessage = {
                    content: 'コマンドの実行中にエラーが発生しました',
                    ephemeral: true
                };

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMessage);
                } else {
                    await interaction.reply(errorMessage);
                }
            }
        }

        // セレクトメニュー、ボタン、モーダルの処理
        if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction);
        }

        if (interaction.isButton()) {
            await handleButton(interaction);
        }

        if (interaction.isModalSubmit()) {
            await handleModal(interaction);
        }
    },
};

async function handleSelectMenu(interaction) {
    if (interaction.customId === 'complete_task_select') {
        await handleTaskComplete(interaction);
    } else if (interaction.customId === 'edit_task_select') {
        await handleTaskEdit(interaction);
    } else if (interaction.customId === 'delete_task_select') {
        await handleTaskDelete(interaction);
    } else if (interaction.customId === 'edit_option_select') {
        await handleEditOption(interaction);
    }
}

async function handleButton(interaction) {
    if (interaction.customId === 'confirm_delete_all') {
        await handleConfirmDeleteAll(interaction);
    } else if (interaction.customId === 'confirm_delete_completed') {
        await handleConfirmDeleteCompleted(interaction);
    } else if (interaction.customId === 'confirm_delete_pending') {
        await handleConfirmDeletePending(interaction);
    } else if (interaction.customId === 'cancel_delete') {
        await handleCancelDelete(interaction);
    }
}

async function handleModal(interaction) {
    const customId = interaction.customId;
    
    if (customId.startsWith('edit_name_modal_')) {
        await handleEditNameModal(interaction);
    } else if (customId.startsWith('edit_due_modal_')) {
        await handleEditDueModal(interaction);
    }
}

async function handleTaskComplete(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const taskId = parseInt(interaction.values[0]);
        const completedTask = await sheetsManager.completeTask(taskId, interaction.user.id);

        const embed = new EmbedBuilder()
            .setTitle('タスク完了')
            .setDescription(`**${completedTask.name}**\n\nお疲れさまでした！`)
            .setColor(0xFFD700)
            .setAuthor({ 
                name: interaction.user.displayName,
                iconURL: interaction.user.displayAvatarURL()
            });

        if (completedTask.dueDate) {
            const dueInfo = sheetsManager.formatDueDate(completedTask.dueDate);
            embed.addFields({
                name: '期限',
                value: dueInfo,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

        // 元のメッセージを更新（セレクトメニューを削除）
        try {
            const successEmbed = new EmbedBuilder()
                .setTitle('タスクが完了されました')
                .setDescription(`${completedTask.name} が完了されました！`)
                .setColor(0x00FF00);

            await interaction.message.edit({
                embeds: [successEmbed],
                components: []
            });
        } catch (error) {
            console.error('元のメッセージ更新エラー:', error);
        }

    } catch (error) {
        console.error('タスク完了エラー:', error);
        
        await interaction.editReply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleTaskEdit(interaction) {
    try {
        const taskId = parseInt(interaction.values[0]);
        
        // タスク情報を取得
        const tasks = await sheetsManager.getUserTasks(interaction.user.id, true);
        const task = tasks.find(t => t.id === taskId);
        
        if (!task) {
            await interaction.reply({
                content: 'タスクが見つかりませんでした。',
                ephemeral: true
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('タスク編集')
            .setDescription(`編集するタスク: **${task.name}**\n\n編集したい項目を選択してください：`)
            .setColor(0x3498DB);

        if (task.dueDate) {
            const dueInfo = sheetsManager.formatDueDate(task.dueDate);
            embed.addFields({
                name: '現在の期限',
                value: dueInfo,
                inline: false
            });
        } else {
            embed.addFields({
                name: '現在の期限',
                value: '期限なし',
                inline: false
            });
        }

        const editOptions = [
            {
                label: 'タスク名を変更',
                description: '新しいタスク名を設定',
                value: `edit_name_${taskId}`
            },
            {
                label: '期限を変更',
                description: '新しい期限を設定',
                value: `edit_due_${taskId}`
            },
            {
                label: '期限を削除',
                description: '期限を削除して期限なしにする',
                value: `edit_remove_due_${taskId}`
            }
        ];

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('edit_option_select')
            .setPlaceholder('編集する項目を選択...')
            .addOptions(editOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });

    } catch (error) {
        console.error('タスク編集エラー:', error);
        await interaction.reply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleTaskDelete(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const taskId = parseInt(interaction.values[0]);
        const deletedTask = await sheetsManager.deleteTask(taskId, interaction.user.id);

        const embed = new EmbedBuilder()
            .setTitle('タスク削除完了')
            .setDescription(`**${deletedTask.name}** を削除しました`)
            .setColor(0xFF0000)
            .setAuthor({ 
                name: interaction.user.displayName,
                iconURL: interaction.user.displayAvatarURL()
            });

        if (deletedTask.dueDate) {
            const dueInfo = sheetsManager.formatDueDate(deletedTask.dueDate);
            embed.addFields({
                name: '期限',
                value: dueInfo,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

        // 元のメッセージを更新
        try {
            const successEmbed = new EmbedBuilder()
                .setTitle('タスクが削除されました')
                .setDescription(`${deletedTask.name} が削除されました`)
                .setColor(0xFF0000);

            await interaction.message.edit({
                embeds: [successEmbed],
                components: []
            });
        } catch (error) {
            console.error('元のメッセージ更新エラー:', error);
        }

    } catch (error) {
        console.error('タスク削除エラー:', error);
        
        await interaction.editReply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleEditOption(interaction) {
    try {
        const value = interaction.values[0];
        const [action, type, taskId] = value.split('_');
        
        if (type === 'remove' && action === 'edit') {
            // 期限削除の場合は即座に実行
            await handleRemoveDue(interaction, parseInt(taskId));
        } else if (type === 'name') {
            // タスク名編集モーダルを表示
            await showEditNameModal(interaction, parseInt(taskId));
        } else if (type === 'due') {
            // 期限編集モーダルを表示
            await showEditDueModal(interaction, parseInt(taskId));
        }
    } catch (error) {
        console.error('編集オプション処理エラー:', error);
        await interaction.reply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleRemoveDue(interaction, taskId) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const { oldData, newData } = await sheetsManager.updateTask(taskId, interaction.user.id, {
            dueDate: ''
        });

        const embed = new EmbedBuilder()
            .setTitle('期限削除完了')
            .setDescription(`**${newData.name}** の期限を削除しました`)
            .setColor(0x00FF00)
            .setAuthor({ 
                name: interaction.user.displayName,
                iconURL: interaction.user.displayAvatarURL()
            });

        embed.addFields(
            {
                name: '変更前',
                value: sheetsManager.formatDueDate(oldData.dueDate),
                inline: true
            },
            {
                name: '変更後',
                value: '期限なし',
                inline: true
            }
        );

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('期限削除エラー:', error);
        await interaction.editReply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function showEditNameModal(interaction, taskId) {
    // 現在のタスク情報を取得
    const tasks = await sheetsManager.getUserTasks(interaction.user.id, true);
    const task = tasks.find(t => t.id === taskId);
    
    if (!task) {
        await interaction.reply({
            content: 'タスクが見つかりませんでした。',
            ephemeral: true
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`edit_name_modal_${taskId}`)
        .setTitle('タスク名編集');

    const nameInput = new TextInputBuilder()
        .setCustomId('new_name')
        .setLabel('新しいタスク名')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('新しいタスク名を入力...')
        .setValue(task.name)
        .setRequired(true)
        .setMaxLength(100);

    const firstActionRow = new ActionRowBuilder().addComponents(nameInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
}

async function showEditDueModal(interaction, taskId) {
    // 現在のタスク情報を取得
    const tasks = await sheetsManager.getUserTasks(interaction.user.id, true);
    const task = tasks.find(t => t.id === taskId);
    
    if (!task) {
        await interaction.reply({
            content: 'タスクが見つかりませんでした。',
            ephemeral: true
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`edit_due_modal_${taskId}`)
        .setTitle('期限編集');

    const dueInput = new TextInputBuilder()
        .setCustomId('new_due')
        .setLabel('新しい期限')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('明日, 来週金曜, 2025-12-25 など')
        .setValue('')
        .setRequired(true)
        .setMaxLength(50);

    const firstActionRow = new ActionRowBuilder().addComponents(dueInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
}

async function handleEditNameModal(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const taskId = parseInt(interaction.customId.split('_')[3]);
        const newName = interaction.fields.getTextInputValue('new_name');

        const { oldData, newData } = await sheetsManager.updateTask(taskId, interaction.user.id, {
            name: newName
        });

        const embed = new EmbedBuilder()
            .setTitle('タスク名変更完了')
            .setColor(0x00FF00)
            .setAuthor({ 
                name: interaction.user.displayName,
                iconURL: interaction.user.displayAvatarURL()
            });

        embed.addFields(
            {
                name: '変更前',
                value: oldData.name,
                inline: false
            },
            {
                name: '変更後',
                value: newData.name,
                inline: false
            }
        );

        if (newData.dueDate) {
            embed.addFields({
                name: '期限',
                value: sheetsManager.formatDueDate(newData.dueDate),
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('タスク名変更エラー:', error);
        await interaction.editReply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleEditDueModal(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const taskId = parseInt(interaction.customId.split('_')[3]);
        const newDueText = interaction.fields.getTextInputValue('new_due');

        // 期限をパース
        const { parseDueDate, formatDateForSheet } = await import('../utils/dateParser.js');
        const newDueDate = parseDueDate(newDueText);
        
        if (!newDueDate) {
            await interaction.editReply({
                content: `期限「${newDueText}」を理解できませんでした。\n例: 明日, 来週金曜, 2025-12-25`
            });
            return;
        }

        const { oldData, newData } = await sheetsManager.updateTask(taskId, interaction.user.id, {
            dueDate: formatDateForSheet(newDueDate)
        });

        const embed = new EmbedBuilder()
            .setTitle('期限変更完了')
            .setDescription(`**${newData.name}**`)
            .setColor(0x00FF00)
            .setAuthor({ 
                name: interaction.user.displayName,
                iconURL: interaction.user.displayAvatarURL()
            });

        embed.addFields(
            {
                name: '変更前',
                value: sheetsManager.formatDueDate(oldData.dueDate) || '期限なし',
                inline: true
            },
            {
                name: '変更後',
                value: sheetsManager.formatDueDate(newData.dueDate),
                inline: true
            }
        );

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('期限変更エラー:', error);
        await interaction.editReply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleConfirmDeleteAll(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const deletedCount = await sheetsManager.deleteUserTasks(interaction.user.id, false, false);

        const embed = new EmbedBuilder()
            .setTitle('全タスク削除完了')
            .setDescription(`${interaction.user.displayName}さんのタスク **${deletedCount}件** を全て削除しました`)
            .setColor(0xFF0000);

        await interaction.editReply({ embeds: [embed] });

        // 元のメッセージを更新
        try {
            await interaction.message.edit({
                embeds: [embed],
                components: []
            });
        } catch (error) {
            console.error('元のメッセージ更新エラー:', error);
        }

    } catch (error) {
        console.error('全削除エラー:', error);
        await interaction.editReply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleConfirmDeleteCompleted(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const deletedCount = await sheetsManager.deleteUserTasks(interaction.user.id, true, false);

        const embed = new EmbedBuilder()
            .setTitle('完了済みタスク削除完了')
            .setDescription(`${interaction.user.displayName}さんの完了済みタスク **${deletedCount}件** を削除しました`)
            .setColor(0xFF9500);

        await interaction.editReply({ embeds: [embed] });

        try {
            await interaction.message.edit({
                embeds: [embed],
                components: []
            });
        } catch (error) {
            console.error('元のメッセージ更新エラー:', error);
        }

    } catch (error) {
        console.error('完了済み削除エラー:', error);
        await interaction.editReply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleConfirmDeletePending(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const deletedCount = await sheetsManager.deleteUserTasks(interaction.user.id, false, true);

        const embed = new EmbedBuilder()
            .setTitle('未完了タスク削除完了')
            .setDescription(`${interaction.user.displayName}さんの未完了タスク **${deletedCount}件** を削除しました`)
            .setColor(0xFF9500);

        await interaction.editReply({ embeds: [embed] });

        try {
            await interaction.message.edit({
                embeds: [embed],
                components: []
            });
        } catch (error) {
            console.error('元のメッセージ更新エラー:', error);
        }

    } catch (error) {
        console.error('未完了削除エラー:', error);
        await interaction.editReply({
            content: `エラーが発生しました: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleCancelDelete(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('削除をキャンセル')
        .setDescription('タスクの削除をキャンセルしました')
        .setColor(0x95A5A6);

    await interaction.update({
        embeds: [embed],
        components: []
    });
}
