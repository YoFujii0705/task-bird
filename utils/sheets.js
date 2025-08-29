import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

class SheetsManager {
    constructor() {
        this.doc = null;
        this.sheet = null;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return true;

        try {
            // 環境変数の確認
            if (!process.env.GOOGLE_SERVICE_KEY) {
                throw new Error('GOOGLE_SERVICE_KEY環境変数が設定されていません');
            }
            if (!process.env.SPREADSHEET_ID) {
                throw new Error('SPREADSHEET_ID環境変数が設定されていません');
            }

            // サービスアカウント認証情報をパース
            let serviceAccountInfo;
            try {
                serviceAccountInfo = JSON.parse(process.env.GOOGLE_SERVICE_KEY);
            } catch (parseError) {
                throw new Error('GOOGLE_SERVICE_KEY のJSON形式が無効です');
            }

            // 必要なフィールドの確認
            if (!serviceAccountInfo.client_email || !serviceAccountInfo.private_key) {
                throw new Error('サービスアカウント情報にclient_emailまたはprivate_keyが不足しています');
            }

            // JWT認証設定
            const serviceAccountAuth = new JWT({
                email: serviceAccountInfo.client_email,
                key: serviceAccountInfo.private_key.replace(/\\n/g, '\n'), // 改行文字を正規化
                scopes: [
                    'https://www.googleapis.com/auth/spreadsheets',
                    'https://www.googleapis.com/auth/drive.file'
                ]
            });

            // ドキュメント初期化
            this.doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);
            await this.doc.loadInfo();

            console.log(`Google Sheets連携完了: ${this.doc.title}`);

            // シート取得または作成
            const sheetName = process.env.SHEET_NAME || 'tasks';
            this.sheet = this.doc.sheetsByTitle[sheetName];

            if (!this.sheet) {
                console.log(`'${sheetName}'シートが見つかりません。作成中...`);
                this.sheet = await this.doc.addSheet({
                    title: sheetName,
                    headerValues: ['タスク名', '作成日', '完了', '完了日', 'ユーザーID', 'ユーザー名', '期限']
                });
            } else {
                await this.sheet.loadHeaderRow();
                
                // ヘッダーの確認と修正
                const headers = this.sheet.headerValues;
                const expectedHeaders = ['タスク名', '作成日', '完了', '完了日', 'ユーザーID', 'ユーザー名', '期限'];
                
                if (headers.length < expectedHeaders.length) {
                    console.log('ヘッダーを修正中...');
                    await this.sheet.setHeaderRow(expectedHeaders);
                }
            }

            this.isInitialized = true;
            return true;

        } catch (error) {
            console.error('Google Sheets初期化エラー:', error.message);
            return false;
        }
    }

    async addTask(taskData) {
        if (!await this.initialize()) {
            throw new Error('Google Sheetsに接続できません');
        }

        const row = await this.sheet.addRow({
            'タスク名': taskData.name,
            '作成日': new Date().toLocaleString('ja-JP'),
            '完了': 'FALSE',
            '完了日': '',
            'ユーザーID': taskData.userId,
            'ユーザー名': taskData.userName,
            '期限': taskData.dueDate || ''
        });

        return row;
    }

    async getUserTasks(userId, includeCompleted = false) {
        if (!await this.initialize()) {
            throw new Error('Google Sheetsに接続できません');
        }

        const rows = await this.sheet.getRows();
        
        const userTasks = rows
            .filter(row => row.get('ユーザーID') === userId.toString())
            .filter(row => includeCompleted || row.get('完了') !== 'TRUE')
            .map((row, index) => {
                const dueDateStr = row.get('期限');
                console.log('getUserTasks dueDate raw:', dueDateStr);
                
                return {
                    id: row.rowNumber,
                    name: row.get('タスク名'),
                    createdAt: row.get('作成日'),
                    completed: row.get('完了') === 'TRUE',
                    completedAt: row.get('完了日'),
                    userId: row.get('ユーザーID'),
                    userName: row.get('ユーザー名'),
                    dueDate: dueDateStr, // 文字列のまま保持
                    row: row
                };
            });

        return this.sortTasksByUrgency(userTasks);
    }

    async getAllTasks() {
        if (!await this.initialize()) {
            throw new Error('Google Sheetsに接続できません');
        }

        const rows = await this.sheet.getRows();
        
        return rows.map(row => ({
            id: row.rowNumber,
            name: row.get('タスク名'),
            createdAt: row.get('作成日'),
            completed: row.get('完了') === 'TRUE',
            completedAt: row.get('完了日'),
            userId: row.get('ユーザーID'),
            userName: row.get('ユーザー名'),
            dueDate: row.get('期限'),
            row: row
        }));
    }

    async completeTask(taskId, userId) {
        if (!await this.initialize()) {
            throw new Error('Google Sheetsに接続できません');
        }

        const rows = await this.sheet.getRows();
        const task = rows.find(row => 
            row.rowNumber === taskId && 
            row.get('ユーザーID') === userId.toString()
        );

        if (!task) {
            throw new Error('指定されたタスクが見つかりません');
        }

        task.set('完了', 'TRUE');
        task.set('完了日', new Date().toLocaleString('ja-JP'));
        await task.save();

        return {
            name: task.get('タスク名'),
            dueDate: task.get('期限')
        };
    }

    async deleteUserTasks(userId, completedOnly = false) {
        if (!await this.initialize()) {
            throw new Error('Google Sheetsに接続できません');
        }

        const rows = await this.sheet.getRows();
        const tasksToDelete = rows.filter(row => 
            row.get('ユーザーID') === userId.toString() &&
            (!completedOnly || row.get('完了') === 'TRUE')
        );

        for (const task of tasksToDelete) {
            await task.delete();
        }

        return tasksToDelete.length;
    }

    sortTasksByUrgency(tasks) {
        return tasks.sort((a, b) => {
            const urgencyA = this.getUrgencyLevel(a.dueDate);
            const urgencyB = this.getUrgencyLevel(b.dueDate);
            return urgencyA - urgencyB;
        });
    }

    getUrgencyLevel(dueDate) {
        if (!dueDate) return 999; // 期限なしは最後

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        
        const diffTime = due - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return diffDays < 0 ? -1 : diffDays; // 期限切れは最優先
    }

    formatDueDate(dueDate) {
        if (!dueDate) return '期限なし';

        console.log('formatDueDate input:', dueDate, 'type:', typeof dueDate);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // 日付文字列の場合は適切に変換
        let due;
        if (typeof dueDate === 'string') {
            // YYYY-MM-DD形式の場合
            if (dueDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                due = new Date(dueDate + 'T00:00:00');
            } else {
                due = new Date(dueDate);
            }
        } else {
            due = new Date(dueDate);
        }
        
        due.setHours(0, 0, 0, 0);
        
        console.log('formatDueDate parsed:', due, 'today:', today);
        
        const diffTime = due - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        console.log('formatDueDate diffDays:', diffDays);

        const dateStr = due.toLocaleDateString('ja-JP', { 
            month: 'numeric', 
            day: 'numeric' 
        });

        if (diffDays < 0) {
            return `期限切れ (${dateStr})`;
        } else if (diffDays === 0) {
            return `今日まで (${dateStr})`;
        } else if (diffDays === 1) {
            return `明日まで (${dateStr})`;
        } else if (diffDays <= 3) {
            return `${diffDays}日後 (${dateStr})`;
        } else if (diffDays <= 7) {
            return `${diffDays}日後 (${dateStr})`;
        } else {
            return dateStr;
        }
    }

    getDueDateEmoji(dueDate) {
        if (!dueDate) return '⚪';

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        
        const diffTime = due - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return '🔴';
        if (diffDays === 0) return '🔴';
        if (diffDays === 1) return '🟠';
        if (diffDays <= 3) return '🟡';
        if (diffDays <= 7) return '🟢';
        return '⚪';
    }
}

export default new SheetsManager();
