import { EmbedBuilder } from 'discord.js';
import sheetsManager from './sheets.js';

export async function sendDailyReminder(client) {
    try {
        const channelId = process.env.NOTIFICATION_CHANNEL_ID;
        if (!channelId) {
            console.log('通知チャンネルIDが設定されていません');
            return;
        }

        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            console.log('通知チャンネルが見つかりません');
            return;
        }

        const allTasks = await sheetsManager.getAllTasks();
        if (!allTasks) {
            console.log('タスクデータを取得できませんでした');
            return;
        }

        // 一週間以内の未完了タスクをユーザーごとに整理
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const oneWeekLater = new Date(today);
        oneWeekLater.setDate(oneWeekLater.getDate() + 7);

        const userTasks = {};

        for (const task of allTasks) {
            if (task.completed) continue; // 完了済みタスクは除外

            const userId = task.userId;
            const userName = task.userName;

            let shouldInclude = false;

            if (!task.dueDate) {
                // 期限なしタスクは作成から1週間以内のもののみ
                const createdAt = new Date(task.createdAt);
                const daysSinceCreated = Math.ceil((today - createdAt) / (1000 * 60 * 60 * 24));
                shouldInclude = daysSinceCreated <= 7;
            } else {
                // 期限ありタスクは一週間以内のもの
                const dueDate = new Date(task.dueDate);
                dueDate.setHours(0, 0, 0, 0);
                shouldInclude = dueDate <= oneWeekLater;
            }

            if (shouldInclude) {
                if (!userTasks[userId]) {
                    userTasks[userId] = {
                        userName: userName,
                        tasks: []
                    };
                }
                userTasks[userId].tasks.push(task);
            }
        }

        if (Object.keys(userTasks).length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('おはようございます')
                .setDescription('現在、一週間以内の未完了タスクはありません\n今日も素晴らしい一日を')
                .setColor(0x00FF00);

            await channel.send({ embeds: [embed] });
            return;
        }

        // 各ユーザーのタスクを期限順にソート
        for (const userId in userTasks) {
            userTasks[userId].tasks = sheetsManager.sortTasksByUrgency(userTasks[userId].tasks);
        }

        const embed = new EmbedBuilder()
            .setTitle('おはようございます')
            .setDescription('今週のタスク状況をお知らせします')
            .setColor(0xFF9500);

        // ユーザーごとにタスクを表示（上位5件まで）
        for (const [userId, userInfo] of Object.entries(userTasks)) {
            const tasks = userInfo.tasks;
            const taskCount = tasks.length;

            // 緊急・期限切れタスクの数をカウント
            let urgentCount = 0;
            let overdueCount = 0;
            let todayCount = 0;

            for (const task of tasks) {
                if (task.dueDate) {
                    const dueDate = new Date(task.dueDate);
                    dueDate.setHours(0, 0, 0, 0);
                    const diffTime = dueDate - today;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays < 0) {
                        overdueCount++;
                    } else if (diffDays === 0) {
                        todayCount++;
                    } else if (diffDays <= 3) {
                        urgentCount++;
                    }
                }
            }

            // タスクリストを作成（最大5件）
            let taskList = '';
            const displayTasks = tasks.slice(0, 5);
            
            for (const task of displayTasks) {
                const dueInfo = sheetsManager.formatDueDate(task.dueDate);
                const emoji = sheetsManager.getDueDateEmoji(task.dueDate);
                taskList += `• ${task.name} - ${emoji} ${dueInfo}\n`;
            }

            if (taskCount > 5) {
                taskList += `• ... 他${taskCount - 5}件\n`;
            }

            // フィールドタイトルに緊急情報を追加
            let fieldTitle = `${userInfo.userName}さん (${taskCount}件`;
            if (overdueCount > 0) {
                fieldTitle += `, 🔴${overdueCount}件期限切れ`;
            }
            if (todayCount > 0) {
                fieldTitle += `, ⚡${todayCount}件今日まで`;
            } else if (urgentCount > 0) {
                fieldTitle += `, 🟡${urgentCount}件緊急`;
            }
            fieldTitle += ')';

            embed.addFields({
                name: fieldTitle,
                value: taskList || 'タスクなし',
                inline: false
            });
        }

        // フッターにコマンド案内を追加
        embed.addFields({
            name: '便利なコマンド',
            value: '`/tasks list` - タスク確認\n`/tasks urgent` - 緊急タスクのみ\n`/add today [タスク名]` - 今日締切のタスク追加\n`/tasks complete` - タスク完了',
            inline: false
        });

        embed.setFooter({ text: '今日も頑張りましょう (一週間以内のタスクを表示)' });

        await channel.send({ embeds: [embed] });
        console.log('毎日通知を送信しました（一週間以内のタスクのみ）');

    } catch (error) {
        console.error('毎日通知エラー:', error);
    }
}
