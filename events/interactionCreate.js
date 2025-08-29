import { EmbedBuilder } from 'discord.js';
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

        // セレクトメニューとボタンの処理
        if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction);
        }

        if (interaction.isButton()) {
            await handleButton(interaction);
        }
    },
};

async function handleSelectMenu(interaction) {
    if (interaction.customId === 'complete_task_select') {
        await handleTaskComplete(interaction);
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
