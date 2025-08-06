from dotenv import load_dotenv
import os

load_dotenv()

# 他のimport文
import discord
from discord.ext import commands, tasks
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import os
import json
import asyncio
from datetime import datetime, time, timedelta
from flask import Flask
import threading
import re

# .envファイルを読み込む（Secretsが使えない場合）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenvがない場合はスキップ

# FlaskアプリでUptimeRobot用のWebサーバー
app = Flask(__name__)

@app.route('/')
def home():
    return "Discord Task Bot is running! 🤖"

@app.route('/health')
def health():
    return {
        "status": "healthy", 
        "bot_ready": bot.is_ready() if 'bot' in globals() else False,
        "timestamp": datetime.now().isoformat()
    }

@app.route('/ping')
def ping():
    return "pong"

def run_flask():
    try:
        print("🌐 Flaskサーバーを起動中...")
        app.run(host='0.0.0.0', port=8080, debug=False, use_reloader=False, threaded=True)
    except Exception as e:
        print(f"❌ Flaskサーバーエラー: {e}")

# DiscordBot設定
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix='!', intents=intents)

SPREADSHEET_ID = os.environ.get('SPREADSHEET_ID')
SHEET_NAME = 'tasks'

def parse_due_date(due_text):
    """自然言語の期限を日付に変換"""
    if not due_text:
        return None
    
    due_text = due_text.strip().lower()
    today = datetime.now().date()
    
    # 今日・明日
    if due_text in ['今日', 'きょう', 'today']:
        return today
    elif due_text in ['明日', 'あした', 'あす', 'tomorrow']:
        return today + timedelta(days=1)
    elif due_text in ['明後日', 'あさって']:
        return today + timedelta(days=2)
    
    # 曜日指定
    weekdays = {
        '月': 0, '火': 1, '水': 2, '木': 3, '金': 4, '土': 5, '日': 6,
        '月曜': 0, '火曜': 1, '水曜': 2, '木曜': 3, '金曜': 4, '土曜': 5, '日曜': 6,
        'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6
    }
    
    for day_name, weekday in weekdays.items():
        if day_name in due_text:
            days_ahead = weekday - today.weekday()
            if days_ahead <= 0:  # 今週の該当曜日が過ぎている場合は来週
                days_ahead += 7
            return today + timedelta(days=days_ahead)
    
    # 相対的な日数
    if '日後' in due_text or '日後' in due_text:
        match = re.search(r'(\d+)日後', due_text)
        if match:
            days = int(match.group(1))
            return today + timedelta(days=days)
    
    # 週指定
    if '来週' in due_text or 'next week' in due_text:
        return today + timedelta(days=7)
    elif '再来週' in due_text:
        return today + timedelta(days=14)
    
    # 月指定
    if '来月' in due_text or 'next month' in due_text:
        return today + timedelta(days=30)
    
    # 日付形式（YYYY-MM-DD, MM/DD, MM-DD）
    date_patterns = [
        r'(\d{4})-(\d{1,2})-(\d{1,2})',
        r'(\d{4})/(\d{1,2})/(\d{1,2})',
        r'(\d{1,2})/(\d{1,2})',
        r'(\d{1,2})-(\d{1,2})'
    ]
    
    for pattern in date_patterns:
        match = re.search(pattern, due_text)
        if match:
            try:
                if len(match.groups()) == 3:  # 年月日
                    year, month, day = match.groups()
                    return datetime(int(year), int(month), int(day)).date()
                else:  # 月日のみ（今年として扱う）
                    month, day = match.groups()
                    year = today.year
                    date = datetime(year, int(month), int(day)).date()
                    # 過去の日付の場合は来年として扱う
                    if date < today:
                        date = datetime(year + 1, int(month), int(day)).date()
                    return date
            except ValueError:
                continue
    
    return None

def format_due_date(due_date):
    """期限を見やすい形式でフォーマット"""
    if not due_date:
        return "期限なし"
    
    today = datetime.now().date()
    diff = (due_date - today).days
    
    if diff < 0:
        return f"🔴 期限切れ ({due_date.strftime('%m/%d')})"
    elif diff == 0:
        return f"🔴 今日まで ({due_date.strftime('%m/%d')})"
    elif diff == 1:
        return f"🟠 明日まで ({due_date.strftime('%m/%d')})"
    elif diff <= 3:
        return f"🟡 {diff}日後 ({due_date.strftime('%m/%d')})"
    elif diff <= 7:
        return f"🟢 {diff}日後 ({due_date.strftime('%m/%d')})"
    else:
        return f"⚪ {due_date.strftime('%m/%d')}"

def get_urgency_level(due_date):
    """緊急度レベルを取得（ソート用）"""
    if not due_date:
        return 999  # 期限なしは最後
    
    today = datetime.now().date()
    diff = (due_date - today).days
    
    if diff < 0:
        return -1  # 期限切れは最優先
    else:
        return diff

def setup_google_sheets():
    try:
        # 環境変数チェック
        credentials_json = os.environ.get('GOOGLE_SERVICE_KEY')
        if not credentials_json:
            print("❌ GOOGLE_SERVICE_KEY環境変数が見つかりません")
            return None

        if not SPREADSHEET_ID:
            print("❌ SPREADSHEET_ID環境変数が見つかりません")
            return None

        # JSON解析
        try:
            credentials_dict = json.loads(credentials_json)
        except json.JSONDecodeError as e:
            print(f"❌ Google認証JSON解析エラー: {e}")
            return None

        # スコープ設定
        scope = [
            'https://spreadsheets.google.com/feeds',
            'https://www.googleapis.com/auth/drive'
        ]

        # 認証情報作成
        try:
            creds = ServiceAccountCredentials.from_json_keyfile_dict(credentials_dict, scope)
            client = gspread.authorize(creds)
        except Exception as e:
            print(f"❌ Google認証エラー: {e}")
            return None

        # スプレッドシート接続
        try:
            spreadsheet = client.open_by_key(SPREADSHEET_ID)
            print(f"✅ スプレッドシート接続成功: {spreadsheet.title}")
        except Exception as e:
            print(f"❌ スプレッドシート接続エラー: {e}")
            print(f"   SPREADSHEET_ID: {SPREADSHEET_ID}")
            return None

        # ワークシート取得
        try:
            sheet = spreadsheet.worksheet(SHEET_NAME)
            print(f"✅ ワークシート接続成功: {SHEET_NAME}")
            return sheet
        except gspread.WorksheetNotFound:
            print(f"❌ ワークシート '{SHEET_NAME}' が見つかりません")
            print(f"   利用可能なシート: {[ws.title for ws in spreadsheet.worksheets()]}")
            # tasksシートがない場合は作成
            try:
                sheet = spreadsheet.add_worksheet(title=SHEET_NAME, rows=1000, cols=10)
                # 新しいヘッダー（期限フィールド追加）
                sheet.append_row(['タスク名', '作成日', '完了', '完了日', 'ユーザーID', 'ユーザー名', '期限'])
                print(f"✅ ワークシート '{SHEET_NAME}' を作成しました")
                return sheet
            except Exception as create_error:
                print(f"❌ ワークシート作成エラー: {create_error}")
                return None
        except Exception as e:
            print(f"❌ ワークシート取得エラー: {e}")
            return None

    except Exception as e:
        print(f"❌ Google Sheets設定エラー: {e}")
        return None

@bot.event
async def on_ready():
    print(f'🤖 {bot.user} がオンラインになりました！')

    # シート初期化チェック
    sheet = setup_google_sheets()
    if sheet:
        try:
            headers = sheet.row_values(1)
            if not headers or headers[0] != 'タスク名':
                sheet.clear()
                # 新しいヘッダー（期限フィールド追加）
                sheet.append_row(['タスク名', '作成日', '完了', '完了日', 'ユーザーID', 'ユーザー名', '期限'])
                print("✅ スプレッドシート初期化完了")
            elif len(headers) < 7:  # 期限フィールドがない場合は追加
                sheet.update_cell(1, 7, '期限')
                print("✅ 期限フィールドを追加しました")
        except Exception as e:
            print(f"❌ 初期化エラー: {e}")

    # 毎日通知開始
    if not daily_reminder.is_running():
        daily_reminder.start()
        print("⏰ 毎日通知を開始しました")

@bot.command(name='addtask')
async def add_task(ctx, *, task_input):
    """タスクを追加（期限付き対応）
    使用例：
    !addtask レポート提出 明日
    !addtask 買い物
    !addtask プレゼン準備 来週金曜
    """
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        # タスク名と期限を分離
        parts = task_input.rsplit(' ', 1)
        if len(parts) == 2:
            task_name, due_text = parts
            due_date = parse_due_date(due_text)
            if due_date is None:
                # 期限として認識できない場合はタスク名の一部として扱う
                task_name = task_input
                due_date = None
        else:
            task_name = task_input
            due_date = None

        now = datetime.now().strftime('%Y/%m/%d %H:%M:%S')
        due_date_str = due_date.strftime('%Y-%m-%d') if due_date else ''

        sheet.append_row([
            task_name,
            now,
            'FALSE',
            '',
            str(ctx.author.id),
            ctx.author.display_name,
            due_date_str
        ])

        embed = discord.Embed(
            title="✅ タスク追加完了",
            description=f"**{task_name}**",
            color=0x00ff00
        )
        
        if due_date:
            embed.add_field(
                name="📅 期限",
                value=format_due_date(due_date),
                inline=False
            )
        else:
            embed.add_field(
                name="📅 期限",
                value="期限なし",
                inline=False
            )
        
        embed.set_author(name=ctx.author.display_name)

        await ctx.send(embed=embed)
        print(f"✅ タスク追加: {task_name} (期限: {due_date or 'なし'}) by {ctx.author.display_name}")

    except Exception as e:
        await ctx.send(f"❌ エラー: {str(e)}")
        print(f"❌ タスク追加エラー: {e}")

@bot.command(name='tasks')
async def list_tasks(ctx):
    """自分のタスクを期限順で表示"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        if len(all_values) <= 1:
            await ctx.send("📋 現在、タスクはありません")
            return

        user_tasks = []
        for i, row in enumerate(all_values[1:], start=2):
            if len(row) >= 6 and row[4] == str(ctx.author.id) and row[2] != 'TRUE':
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass
                
                user_tasks.append({
                    'row': i,
                    'name': row[0],
                    'created': row[1],
                    'due_date': due_date
                })

        if not user_tasks:
            embed = discord.Embed(
                title="🎊 素晴らしい！",
                description="未完了のタスクはありません！",
                color=0xffd700
            )
            await ctx.send(embed=embed)
            return

        # 期限順にソート
        user_tasks.sort(key=lambda x: get_urgency_level(x['due_date']))

        # メッセージ分割処理
        max_tasks_per_message = 5
        tasks_chunks = [user_tasks[i:i + max_tasks_per_message] for i in range(0, len(user_tasks), max_tasks_per_message)]

        for chunk_index, chunk in enumerate(tasks_chunks):
            embed = discord.Embed(
                title=f"📋 {ctx.author.display_name}さんのタスク ({chunk_index + 1}/{len(tasks_chunks)})",
                color=0x3498db
            )

            task_list = ""
            for i, task in enumerate(chunk):
                global_index = chunk_index * max_tasks_per_message + i + 1
                due_info = format_due_date(task['due_date'])
                task_list += f"**{global_index}.** {task['name']}\n"
                task_list += f"　📅 {due_info}\n"
                task_list += f"　📝 作成: {task['created']}\n\n"

            embed.description = task_list
            if chunk_index == len(tasks_chunks) - 1:  # 最後のメッセージにのみフッターを追加
                embed.set_footer(text="完了: !complete [番号] | 例: !complete 1")

            await ctx.send(embed=embed)
            if chunk_index < len(tasks_chunks) - 1:  # 最後以外は少し間隔を空ける
                await asyncio.sleep(1)

    except Exception as e:
        await ctx.send(f"❌ エラー: {str(e)}")
        print(f"❌ タスク一覧エラー: {e}")

@bot.command(name='urgent')
async def urgent_tasks(ctx):
    """3日以内の緊急タスクを表示"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        if len(all_values) <= 1:
            await ctx.send("📋 現在、タスクはありません")
            return

        urgent_tasks = []
        today = datetime.now().date()
        
        for i, row in enumerate(all_values[1:], start=2):
            if len(row) >= 6 and row[4] == str(ctx.author.id) and row[2] != 'TRUE':
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass
                
                # 3日以内または期限切れのタスクのみ
                if due_date and (due_date - today).days <= 3:
                    urgent_tasks.append({
                        'row': i,
                        'name': row[0],
                        'created': row[1],
                        'due_date': due_date
                    })

        if not urgent_tasks:
            embed = discord.Embed(
                title="😌 安心してください",
                description="3日以内の緊急タスクはありません！",
                color=0x00ff00
            )
            await ctx.send(embed=embed)
            return

        # 期限順にソート
        urgent_tasks.sort(key=lambda x: get_urgency_level(x['due_date']))

        embed = discord.Embed(
            title=f"🚨 {ctx.author.display_name}さんの緊急タスク",
            color=0xff0000
        )

        task_list = ""
        for i, task in enumerate(urgent_tasks):
            due_info = format_due_date(task['due_date'])
            task_list += f"**{i+1}.** {task['name']}\n"
            task_list += f"　📅 {due_info}\n\n"

        embed.description = task_list
        embed.set_footer(text="完了: !complete [番号] | 例: !complete 1")

        await ctx.send(embed=embed)

    except Exception as e:
        await ctx.send(f"❌ エラー: {str(e)}")
        print(f"❌ 緊急タスク一覧エラー: {e}")

@bot.command(name='today')
async def today_tasks(ctx):
    """今日期限のタスクを表示"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()
        today = datetime.now().date()
        today_tasks = []
        
        for i, row in enumerate(all_values[1:], start=2):
            if len(row) >= 6 and row[4] == str(ctx.author.id) and row[2] != 'TRUE':
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass
                
                if due_date == today:
                    today_tasks.append({
                        'row': i,
                        'name': row[0],
                        'due_date': due_date
                    })

        if not today_tasks:
            embed = discord.Embed(
                title="📅 今日のタスク",
                description="今日期限のタスクはありません！",
                color=0x00ff00
            )
            await ctx.send(embed=embed)
            return

        embed = discord.Embed(
            title=f"📅 {ctx.author.display_name}さんの今日のタスク",
            color=0xff0000
        )

        task_list = ""
        for i, task in enumerate(today_tasks):
            task_list += f"**{i+1}.** {task['name']}\n"

        embed.description = task_list
        embed.set_footer(text="完了: !complete [番号] | 例: !complete 1")

        await ctx.send(embed=embed)

    except Exception as e:
        await ctx.send(f"❌ エラー: {str(e)}")

@bot.command(name='alltasks')
async def all_tasks(ctx):
    """全体のタスク状況を期限順で表示"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        if len(all_values) <= 1:
            await ctx.send("📋 現在、タスクはありません")
            return

        user_tasks = {}
        for row in all_values[1:]:
            if len(row) >= 6 and row[2] != 'TRUE':
                user_name = row[5]
                task_name = row[0]
                
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass
                
                if user_name not in user_tasks:
                    user_tasks[user_name] = []
                
                user_tasks[user_name].append({
                    'name': task_name,
                    'due_date': due_date
                })

        if not user_tasks:
            embed = discord.Embed(
                title="🎊 全員完了！",
                description="すべてのタスクが完了しています！",
                color=0x00ff00
            )
            await ctx.send(embed=embed)
            return

        # 各ユーザーのタスクを期限順にソート
        for user_name in user_tasks:
            user_tasks[user_name].sort(key=lambda x: get_urgency_level(x['due_date']))

        # メッセージ分割処理
        max_message_length = 1800
        current_message = "📊 **全体タスク状況**\n\n"

        for user_name, tasks in user_tasks.items():
            user_section = f"**{user_name}さん ({len(tasks)}件):**\n"

            for i, task in enumerate(tasks):
                due_info = format_due_date(task['due_date'])
                task_line = f"• {task['name']} - {due_info}\n"
                
                # メッセージ長制限チェック
                if len(current_message + user_section + task_line) > max_message_length:
                    # 現在のメッセージを送信
                    await ctx.send(current_message)
                    await asyncio.sleep(1)
                    current_message = "📊 **全体タスク状況（続き）**\n\n"
                    user_section = f"**{user_name}さん ({len(tasks)}件):**\n"

                user_section += task_line

            user_section += "\n"
            current_message += user_section

        # 最後のメッセージを送信
        if current_message.strip():
            await ctx.send(current_message)

    except Exception as e:
        await ctx.send(f"❌ エラー: {str(e)}")
        print(f"❌ 全タスク一覧エラー: {e}")

@bot.command(name='complete')
async def complete_task(ctx, task_number: int):
    """タスクを完了"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        user_tasks = []
        for i, row in enumerate(all_values[1:], start=2):
            if len(row) >= 6 and row[4] == str(ctx.author.id) and row[2] != 'TRUE':
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass
                
                user_tasks.append({
                    'row': i,
                    'name': row[0],
                    'due_date': due_date
                })

        # 期限順にソート（!tasksと同じ順序）
        user_tasks.sort(key=lambda x: get_urgency_level(x['due_date']))

        if not user_tasks:
            await ctx.send("❌ 完了可能なタスクがありません")
            return

        if task_number < 1 or task_number > len(user_tasks):
            await ctx.send(f"❌ 無効な番号です (1-{len(user_tasks)})")
            return

        target_task = user_tasks[task_number - 1]
        target_row = target_task['row']
        now = datetime.now().strftime('%Y/%m/%d %H:%M:%S')

        sheet.update_cell(target_row, 3, 'TRUE')
        sheet.update_cell(target_row, 4, now)

        embed = discord.Embed(
            title="🎉 タスク完了！",
            description=f"**{target_task['name']}**\n\nお疲れさまでした！",
            color=0xffd700
        )
        
        if target_task['due_date']:
            embed.add_field(
                name="📅 期限",
                value=format_due_date(target_task['due_date']),
                inline=False
            )
        
        embed.set_author(name=ctx.author.display_name)

        await ctx.send(embed=embed)
        print(f"✅ タスク完了: {target_task['name']} by {ctx.author.display_name}")

    except ValueError:
        await ctx.send("❌ 有効な番号を入力してください")
    except Exception as e:
        await ctx.send(f"❌ エラー: {str(e)}")
        print(f"❌ タスク完了エラー: {e}")

@bot.command(name='taskstats')
async def task_stats(ctx):
    """タスク統計情報を表示"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        if len(all_values) <= 1:
            await ctx.send("📊 まだタスクが登録されていません")
            return

        total_tasks = 0
        completed_tasks = 0
        user_stats = {}
        today = datetime.now().date()

        for row in all_values[1:]:
            if len(row) >= 6:
                user_name = row[5]
                is_completed = row[2] == 'TRUE'

                # 期限情報
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass

                if user_name not in user_stats:
                    user_stats[user_name] = {
                        'total': 0, 
                        'completed': 0, 
                        'pending': 0,
                        'overdue': 0,
                        'urgent': 0
                    }

                user_stats[user_name]['total'] += 1
                total_tasks += 1

                if is_completed:
                    user_stats[user_name]['completed'] += 1
                    completed_tasks += 1
                else:
                    user_stats[user_name]['pending'] += 1
                    
                    # 期限切れ・緊急タスクのカウント
                    if due_date:
                        diff = (due_date - today).days
                        if diff < 0:
                            user_stats[user_name]['overdue'] += 1
                        elif diff <= 3:
                            user_stats[user_name]['urgent'] += 1

        embed = discord.Embed(
            title="📊 タスク統計",
            color=0x3498db
        )

        # 全体統計
        completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
        embed.add_field(
            name="🌍 全体統計",
            value=f"総タスク数: {total_tasks}\n完了: {completed_tasks}\n未完了: {total_tasks - completed_tasks}\n完了率: {completion_rate:.1f}%",
            inline=False
        )

        # ユーザー別統計
        user_stats_text = ""
        for user_name, stats in user_stats.items():
            user_completion_rate = (stats['completed'] / stats['total'] * 100) if stats['total'] > 0 else 0
            urgent_info = ""
            if stats['overdue'] > 0:
                urgent_info += f" 🔴{stats['overdue']}件期限切れ"
            if stats['urgent'] > 0:
                urgent_info += f" 🟡{stats['urgent']}件緊急"
            
            user_stats_text += f"**{user_name}**: {stats['pending']}件未完了 ({user_completion_rate:.1f}%完了){urgent_info}\n"

        embed.add_field(
            name="👥 ユーザー別",
            value=user_stats_text if user_stats_text else "データなし",
            inline=False
        )

        await ctx.send(embed=embed)

    except Exception as e:
        await ctx.send(f"❌ 統計エラー: {str(e)}")

@bot.command(name='clearmytasks')
async def clear_my_tasks(ctx):
    """自分のタスクを一括削除"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()
        if len(all_values) <= 1:
            await ctx.send("📋 削除するタスクがありません")
            return

        # 自分のタスクをカウント（完了・未完了問わず）
        my_tasks_count = 0
        pending_count = 0
        completed_count = 0
        
        for row in all_values[1:]:
            if len(row) >= 6 and row[4] == str(ctx.author.id):
                my_tasks_count += 1
                if row[2] == 'TRUE':
                    completed_count += 1
                else:
                    pending_count += 1

        if my_tasks_count == 0:
            await ctx.send("✅ あなたのタスクはありません")
            return

        # 確認メッセージ
        embed = discord.Embed(
            title="⚠️ 確認",
            description=f"**{ctx.author.display_name}**さんのタスク**全て**を削除しますか？\n\n📊 **削除対象**:\n• 未完了タスク: {pending_count}件\n• 完了済みタスク: {completed_count}件\n• **合計: {my_tasks_count}件**\n\n⚠️ **この操作は取り消せません**\n\n✅ `yes` または ❌ `no` で回答してください",
            color=0xff0000
        )
        await ctx.send(embed=embed)

        def check(message):
            return message.author == ctx.author and message.channel == ctx.channel and message.content.lower() in ['yes', 'no']

        try:
            response = await bot.wait_for('message', check=check, timeout=30.0)

            if response.content.lower() == 'yes':
                # ヘッダーと他のユーザーのタスクのみを保持
                new_data = [all_values[0]]  # ヘッダー行
                for row in all_values[1:]:
                    if len(row) >= 6 and row[4] != str(ctx.author.id):
                        new_data.append(row)

                # シートをクリアして新しいデータを書き込み
                sheet.clear()
                sheet.update('A1', new_data)

                embed = discord.Embed(
                    title="🗑️ 削除完了",
                    description=f"**{ctx.author.display_name}**さんのタスク**{my_tasks_count}件**を削除しました",
                    color=0x00ff00
                )
                await ctx.send(embed=embed)
                print(f"🗑️ ユーザータスク一括削除: {ctx.author.display_name} ({my_tasks_count}件)")
            else:
                await ctx.send("❌ 削除をキャンセルしました")

        except asyncio.TimeoutError:
            await ctx.send("⏰ タイムアウトしました。削除をキャンセルします")

    except Exception as e:
        await ctx.send(f"❌ 削除エラー: {str(e)}")

@bot.command(name='clearpending')
async def clear_pending_tasks(ctx):
    """自分の未完了タスクのみを一括削除"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()
        if len(all_values) <= 1:
            await ctx.send("📋 削除するタスクがありません")
            return

        # 自分の未完了タスクをカウント
        pending_count = 0
        for row in all_values[1:]:
            if len(row) >= 6 and row[4] == str(ctx.author.id) and row[2] != 'TRUE':
                pending_count += 1

        if pending_count == 0:
            await ctx.send("✅ 未完了のタスクはありません")
            return

        # 確認メッセージ
        embed = discord.Embed(
            title="⚠️ 確認",
            description=f"**{ctx.author.display_name}**さんの**未完了タスク{pending_count}件**を削除しますか？\n\n✅ 完了済みタスクは保持されます\n⚠️ この操作は取り消せません\n\n✅ `yes` または ❌ `no` で回答してください",
            color=0xff9500
        )
        await ctx.send(embed=embed)

        def check(message):
            return message.author == ctx.author and message.channel == ctx.channel and message.content.lower() in ['yes', 'no']

        try:
            response = await bot.wait_for('message', check=check, timeout=30.0)

            if response.content.lower() == 'yes':
                # ヘッダー、他のユーザーのタスク、自分の完了済みタスクのみを保持
                new_data = [all_values[0]]  # ヘッダー行
                for row in all_values[1:]:
                    # 他のユーザーのタスク または 自分の完了済みタスクのみ保持
                    if len(row) >= 6 and (row[4] != str(ctx.author.id) or row[2] == 'TRUE'):
                        new_data.append(row)

                # シートをクリアして新しいデータを書き込み
                sheet.clear()
                sheet.update('A1', new_data)

                embed = discord.Embed(
                    title="🗑️ 削除完了",
                    description=f"**{ctx.author.display_name}**さんの未完了タスク**{pending_count}件**を削除しました\n\n✅ 完了済みタスクは保持されています",
                    color=0x00ff00
                )
                await ctx.send(embed=embed)
                print(f"🗑️ ユーザー未完了タスク削除: {ctx.author.display_name} ({pending_count}件)")
            else:
                await ctx.send("❌ 削除をキャンセルしました")

        except asyncio.TimeoutError:
            await ctx.send("⏰ タイムアウトしました。削除をキャンセルします")

    except Exception as e:
        await ctx.send(f"❌ 削除エラー: {str(e)}")

@bot.command(name='clearcompleted')
async def clear_completed_tasks(ctx):
    """完了済みタスクを削除（管理者用）"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()
        if len(all_values) <= 1:
            await ctx.send("📋 削除するタスクがありません")
            return

        # 完了済みタスクをカウント
        completed_count = 0
        for row in all_values[1:]:
            if len(row) >= 3 and row[2] == 'TRUE':
                completed_count += 1

        if completed_count == 0:
            await ctx.send("✅ 完了済みタスクはありません")
            return

        # 確認メッセージ
        embed = discord.Embed(
            title="⚠️ 確認",
            description=f"{completed_count}件の完了済みタスクを削除しますか？\n\n✅ `yes` または ❌ `no` で回答してください",
            color=0xff9500
        )
        await ctx.send(embed=embed)

        def check(message):
            return message.author == ctx.author and message.channel == ctx.channel and message.content.lower() in ['yes', 'no']

        try:
            response = await bot.wait_for('message', check=check, timeout=30.0)

            if response.content.lower() == 'yes':
                # ヘッダーと未完了タスクのみを保持
                new_data = [all_values[0]]  # ヘッダー行
                for row in all_values[1:]:
                    if len(row) >= 3 and row[2] != 'TRUE':
                        new_data.append(row)

                # シートをクリアして新しいデータを書き込み
                sheet.clear()
                sheet.update('A1', new_data)

                embed = discord.Embed(
                    title="🗑️ 削除完了",
                    description=f"{completed_count}件の完了済みタスクを削除しました",
                    color=0x00ff00
                )
                await ctx.send(embed=embed)
            else:
                await ctx.send("❌ 削除をキャンセルしました")

        except asyncio.TimeoutError:
            await ctx.send("⏰ タイムアウトしました。削除をキャンセルします")

    except Exception as e:
        await ctx.send(f"❌ 削除エラー: {str(e)}")

# ===== 変更箇所1: 毎日通知を一週間以内のタスクのみに変更 =====

@tasks.loop(time=time(hour=0, minute=0))  # 日本時間の朝9時の場合は hour=0 (UTC)
async def daily_reminder():
    try:
        channel_id = os.environ.get('NOTIFICATION_CHANNEL_ID')
        if not channel_id:
            print("⚠️ 通知チャンネルIDが設定されていません")
            return

        channel = bot.get_channel(int(channel_id))
        if not channel:
            print("⚠️ 通知チャンネルが見つかりません")
            return

        sheet = setup_google_sheets()
        if not sheet:
            print("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        if len(all_values) <= 1:
            return

        # ユーザーごとのタスク情報を収集（一週間以内のみ）
        user_tasks = {}
        today = datetime.now().date()
        one_week_later = today + timedelta(days=7)

        for row in all_values[1:]:
            if len(row) >= 6 and row[2] != 'TRUE':  # 未完了タスクのみ
                user_name = row[5]
                task_name = row[0]
                created_date = row[1]
                
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass
                
                # 一週間以内のタスクまたは期限なしタスクのみ表示
                should_include = False
                if due_date is None:
                    # 期限なしタスクは作成から1週間以内のもののみ
                    try:
                        created = datetime.strptime(created_date, '%Y/%m/%d %H:%M:%S').date()
                        if (today - created).days <= 7:
                            should_include = True
                    except:
                        should_include = True  # 日付解析できない場合は含める
                elif due_date <= one_week_later:
                    should_include = True
                
                if should_include:
                    if user_name not in user_tasks:
                        user_tasks[user_name] = []
                    
                    user_tasks[user_name].append({
                        'name': task_name,
                        'created': created_date,
                        'due_date': due_date
                    })

        if not user_tasks:
            embed = discord.Embed(
                title="🌅 おはようございます！",
                description="現在、一週間以内の未完了タスクはありません！\n今日も素晴らしい一日を！",
                color=0x00ff00
            )
            await channel.send(embed=embed)
            return

        # 各ユーザーのタスクを期限順にソート
        for user_name in user_tasks:
            user_tasks[user_name].sort(key=lambda x: get_urgency_level(x['due_date']))

        # メイン通知メッセージ
        embed = discord.Embed(
            title="🌅 おはようございます！",
            description="今週のタスク状況をお知らせします",
            color=0xff9500
        )

        # ユーザーごとにタスクを表示（上位5件まで）
        for user_name, tasks in user_tasks.items():
            task_count = len(tasks)
            
            # 緊急・期限切れタスクの数をカウント
            urgent_count = 0
            overdue_count = 0
            today_count = 0
            for task in tasks:
                if task['due_date']:
                    diff = (task['due_date'] - today).days
                    if diff < 0:
                        overdue_count += 1
                    elif diff == 0:
                        today_count += 1
                    elif diff <= 3:
                        urgent_count += 1
            
            # タスクリストを作成（最大5件、緊急タスクを優先表示）
            task_list = ""
            for i, task in enumerate(tasks[:5]):  # 上から5つまで
                due_info = format_due_date(task['due_date'])
                task_list += f"• {task['name']} - {due_info}\n"
            
            # 5件を超える場合は「他○件」を追加
            if task_count > 5:
                task_list += f"• ... 他{task_count - 5}件\n"
            
            # フィールドタイトルに緊急情報を追加
            field_title = f"📝 {user_name}さん ({task_count}件"
            if overdue_count > 0:
                field_title += f", 🔴{overdue_count}件期限切れ"
            if today_count > 0:
                field_title += f", ⚡{today_count}件今日まで"
            elif urgent_count > 0:
                field_title += f", 🟡{urgent_count}件緊急"
            field_title += ")"
            
            # フィールドに追加
            embed.add_field(
        name="⚡ 便利な追加コマンド",
        value="`!todayadd [タスク名]` - 今日締切のタスク追加\n`!tomorrowadd [タスク名]` - 明日締切のタスク追加\n`!thisweek [タスク名] [曜日]` - 今週締切のタスク追加",
        inline=False
    )

    embed.add_field(
        name="⏰ 期限付きコマンド",
        value="`!urgent` - 3日以内の緊急タスク\n`!today` - 今日期限のタスク\n`!postpone [番号] [新期限]` - タスク延期",
        inline=False
    )

    embed.add_field(
        name="🔧 編集・管理コマンド",
        value="`!edit [番号] [新内容]` - タスク編集\n`!search [キーワード]` - タスク検索\n`!clearmytasks` - 自分のタスク全削除\n`!clearpending` - 未完了タスクのみ削除",
        inline=False
    )

    embed.add_field(
        name="📊 確認・統計コマンド",
        value="`!alltasks` - 全員のタスク状況\n`!taskstats` - 統計情報\n`!weeklyreport` - 週間パフォーマンスレポート",
        inline=False
    )

    embed.add_field(
        name="📅 期限の入力例",
        value="• `今日` `明日` `明後日`\n• `月曜` `火曜` `来週金曜`\n• `来週` `来月`\n• `3日後` `2025-07-30`\n• `7/30` `12-25`",
        inline=False
    )

    embed.add_field(
        name="🔔 自動機能",
        value="毎日朝に一週間以内のタスクを通知\n期限切れ・緊急タスクを強調表示",
        inline=False
    )

    embed.set_footer(text="例: !todayadd 資料作成 | !edit 1 新しいタスク名 明日")

    await ctx.send(embed=embed)

@bot.command(name='testreminder')
async def test_reminder(ctx):
    """毎朝通知のテスト実行（一週間以内のタスクのみ）"""
    try:
        await ctx.send("🧪 **毎朝通知のテストを実行します（一週間以内のタスクのみ）**")
        
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        if len(all_values) <= 1:
            await ctx.send("📊 テスト結果: タスクが登録されていません")
            return

        # ユーザーごとのタスク情報を収集（一週間以内のみ）
        user_tasks = {}
        today = datetime.now().date()
        one_week_later = today + timedelta(days=7)

        for row in all_values[1:]:
            if len(row) >= 6 and row[2] != 'TRUE':  # 未完了タスクのみ
                user_name = row[5]
                task_name = row[0]
                created_date = row[1]
                
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass
                
                # 一週間以内のタスクまたは期限なしタスクのみ表示
                should_include = False
                if due_date is None:
                    # 期限なしタスクは作成から1週間以内のもののみ
                    try:
                        created = datetime.strptime(created_date, '%Y/%m/%d %H:%M:%S').date()
                        if (today - created).days <= 7:
                            should_include = True
                    except:
                        should_include = True  # 日付解析できない場合は含める
                elif due_date <= one_week_later:
                    should_include = True
                
                if should_include:
                    if user_name not in user_tasks:
                        user_tasks[user_name] = []
                    
                    user_tasks[user_name].append({
                        'name': task_name,
                        'created': created_date,
                        'due_date': due_date
                    })

        if not user_tasks:
            embed = discord.Embed(
                title="🌅 おはようございます！（テスト）",
                description="現在、一週間以内の未完了タスクはありません！\n今日も素晴らしい一日を！",
                color=0x00ff00
            )
            await ctx.send(embed=embed)
            return

        # 各ユーザーのタスクを期限順にソート
        for user_name in user_tasks:
            user_tasks[user_name].sort(key=lambda x: get_urgency_level(x['due_date']))

        # メイン通知メッセージ
        embed = discord.Embed(
            title="🌅 おはようございます！（テスト）",
            description="今週のタスク状況をお知らせします",
            color=0xff9500
        )

        # ユーザーごとにタスクを表示（上位5件まで）
        for user_name, tasks in user_tasks.items():
            task_count = len(tasks)
            
            # 緊急・期限切れタスクの数をカウント
            urgent_count = 0
            overdue_count = 0
            today_count = 0
            for task in tasks:
                if task['due_date']:
                    diff = (task['due_date'] - today).days
                    if diff < 0:
                        overdue_count += 1
                    elif diff == 0:
                        today_count += 1
                    elif diff <= 3:
                        urgent_count += 1
            
            # タスクリストを作成（最大5件、緊急タスクを優先表示）
            task_list = ""
            for i, task in enumerate(tasks[:5]):  # 上から5つまで
                due_info = format_due_date(task['due_date'])
                task_list += f"• {task['name']} - {due_info}\n"
            
            # 5件を超える場合は「他○件」を追加
            if task_count > 5:
                task_list += f"• ... 他{task_count - 5}件\n"
            
            # フィールドタイトルに緊急情報を追加
            field_title = f"📝 {user_name}さん ({task_count}件"
            if overdue_count > 0:
                field_title += f", 🔴{overdue_count}件期限切れ"
            if today_count > 0:
                field_title += f", ⚡{today_count}件今日まで"
            elif urgent_count > 0:
                field_title += f", 🟡{urgent_count}件緊急"
            field_title += ")"
            
            # フィールドに追加
            embed.add_field(
                name=field_title,
                value=task_list if task_list else "タスクなし",
                inline=False
            )

        # フッターにコマンド案内を追加
        embed.add_field(
            name="📱 便利なコマンド",
            value="`!tasks` - 自分のタスク確認\n`!urgent` - 緊急タスクのみ\n`!todayadd [タスク名]` - 今日締切のタスク追加\n`!complete [番号]` - タスク完了",
            inline=False
        )

        embed.set_footer(text="テスト実行完了！💪 (一週間以内のタスクを表示)")

        await ctx.send(embed=embed)
        await ctx.send("✅ **テスト完了！** この形式で毎朝通知されます（一週間以内のタスクのみ）")

    except Exception as e:
        await ctx.send(f"❌ テストエラー: {str(e)}")
        print(f"❌ テスト通知エラー: {e}")
                name=field_title,
                value=task_list if task_list else "タスクなし",
                inline=False
            )

        # フッターにコマンド案内を追加
        embed.add_field(
            name="📱 便利なコマンド",
            value="`!tasks` - 自分のタスク確認\n`!urgent` - 緊急タスクのみ\n`!todayadd [タスク名]` - 今日締切のタスク追加\n`!complete [番号]` - タスク完了",
            inline=False
        )

        embed.set_footer(text="今日も頑張りましょう！💪 (一週間以内のタスクを表示)")

        await channel.send(embed=embed)
        print("📢 毎日通知を送信しました（一週間以内のタスクのみ）")

    except Exception as e:
        print(f"❌ 毎日通知エラー: {e}")

# ===== 新機能3: 明日締切のタスク追加コマンド =====

@bot.command(name='tomorrowadd')
async def add_tomorrow_task(ctx, *, task_name):
    """明日締切のタスクを追加"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        now = datetime.now().strftime('%Y/%m/%d %H:%M:%S')
        tomorrow = (datetime.now().date() + timedelta(days=1)).strftime('%Y-%m-%d')

        sheet.append_row([
            task_name,
            now,
            'FALSE',
            '',
            str(ctx.author.id),
            ctx.author.display_name,
            tomorrow
        ])

        embed = discord.Embed(
            title="🟠 明日締切タスク追加完了",
            description=f"**{task_name}**",
            color=0xff9500
        )
        
        embed.add_field(
            name="📅 期限",
            value="🟠 明日まで",
            inline=False
        )
        
        embed.set_author(name=ctx.author.display_name)

        await ctx.send(embed=embed)
        print(f"🟠 明日締切タスク追加: {task_name} by {ctx.author.display_name}")

    except Exception as e:
        await ctx.send(f"❌ エラー: {str(e)}")

# ===== 新機能4: 今週締切のタスク追加コマンド =====

@bot.command(name='thisweek')
async def add_thisweek_task(ctx, *, task_input):
    """今週締切のタスクを追加（曜日指定可能）
    使用例: !thisweek レポート提出 金曜
           !thisweek 買い物
    """
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        # タスク名と曜日を分離
        parts = task_input.rsplit(' ', 1)
        if len(parts) == 2:
            task_name, day_text = parts
            due_date = parse_due_date(day_text)
            
            # 今週内かチェック
            today = datetime.now().date()
            week_end = today + timedelta(days=(6 - today.weekday()))  # 今週の日曜日
            
            if due_date and due_date <= week_end:
                # 今週内の指定された曜日
                pass
            else:
                # 曜日として認識できない、または来週以降の場合は今週金曜日に設定
                task_name = task_input
                friday_offset = (4 - today.weekday()) % 7  # 4 = 金曜日
                if friday_offset == 0 and datetime.now().hour >= 17:  # 今日が金曜の夕方以降
                    friday_offset = 7  # 来週金曜
                due_date = today + timedelta(days=friday_offset)
        else:
            task_name = task_input
            # デフォルトは今週金曜日
            today = datetime.now().date()
            friday_offset = (4 - today.weekday()) % 7
            if friday_offset == 0 and datetime.now().hour >= 17:
                friday_offset = 7
            due_date = today + timedelta(days=friday_offset)

        now = datetime.now().strftime('%Y/%m/%d %H:%M:%S')
        due_date_str = due_date.strftime('%Y-%m-%d')

        sheet.append_row([
            task_name,
            now,
            'FALSE',
            '',
            str(ctx.author.id),
            ctx.author.display_name,
            due_date_str
        ])

        embed = discord.Embed(
            title="📅 今週締切タスク追加完了",
            description=f"**{task_name}**",
            color=0x3498db
        )
        
        embed.add_field(
            name="📅 期限",
            value=format_due_date(due_date),
            inline=False
        )
        
        embed.set_author(name=ctx.author.display_name)

        await ctx.send(embed=embed)
        print(f"📅 今週締切タスク追加: {task_name} ({due_date}) by {ctx.author.display_name}")

    except Exception as e:
        await ctx.send(f"❌ エラー: {str(e)}")

# ===== 新機能5: タスク検索コマンド =====

@bot.command(name='search')
async def search_tasks(ctx, *, keyword):
    """タスクを検索"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        if len(all_values) <= 1:
            await ctx.send("📋 検索対象のタスクがありません")
            return

        # 自分のタスクから検索
        matching_tasks = []
        for i, row in enumerate(all_values[1:], start=2):
            if len(row) >= 6 and row[4] == str(ctx.author.id):
                if keyword.lower() in row[0].lower():  # タスク名に含まれるかチェック
                    due_date = None
                    if len(row) >= 7 and row[6]:
                        try:
                            due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                        except ValueError:
                            pass
                    
                    matching_tasks.append({
                        'row': i,
                        'name': row[0],
                        'created': row[1],
                        'completed': row[2] == 'TRUE',
                        'due_date': due_date
                    })

        if not matching_tasks:
            embed = discord.Embed(
                title="🔍 検索結果",
                description=f"「**{keyword}**」に一致するタスクが見つかりませんでした",
                color=0x95a5a6
            )
            await ctx.send(embed=embed)
            return

        # 未完了タスクを上位に、その後期限順でソート
        matching_tasks.sort(key=lambda x: (x['completed'], get_urgency_level(x['due_date'])))

        embed = discord.Embed(
            title=f"🔍 検索結果: 「{keyword}」",
            description=f"{len(matching_tasks)}件のタスクが見つかりました",
            color=0x3498db
        )

        task_list = ""
        for i, task in enumerate(matching_tasks[:10]):  # 最大10件表示
            status = "✅ 完了" if task['completed'] else "📝 未完了"
            due_info = format_due_date(task['due_date']) if not task['completed'] else ""
            task_list += f"**{i+1}.** {task['name']} - {status}\n"
            if due_info and not task['completed']:
                task_list += f"　📅 {due_info}\n"
            task_list += "\n"

        embed.description = f"{len(matching_tasks)}件のタスクが見つかりました\n\n{task_list}"

        if len(matching_tasks) > 10:
            embed.set_footer(text=f"他{len(matching_tasks) - 10}件の結果があります")

        await ctx.send(embed=embed)

    except Exception as e:
        await ctx.send(f"❌ 検索エラー: {str(e)}")

# ===== 新機能6: タスク編集コマンド =====

@bot.command(name='edit')
async def edit_task(ctx, task_number: int, *, new_content):
    """タスクを編集
    使用例: !edit 1 新しいタスク名
           !edit 2 新しいタスク名 明日
    """
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        # 自分の未完了タスクを取得
        user_tasks = []
        for i, row in enumerate(all_values[1:], start=2):
            if len(row) >= 6 and row[4] == str(ctx.author.id) and row[2] != 'TRUE':
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass
                
                user_tasks.append({
                    'row': i,
                    'name': row[0],
                    'due_date': due_date
                })

        user_tasks.sort(key=lambda x: get_urgency_level(x['due_date']))

        if not user_tasks:
            await ctx.send("❌ 編集可能なタスクがありません")
            return

        if task_number < 1 or task_number > len(user_tasks):
            await ctx.send(f"❌ 無効な番号です (1-{len(user_tasks)})")
            return

        target_task = user_tasks[task_number - 1]
        target_row = target_task['row']

        # 新しい内容と期限を分離
        parts = new_content.rsplit(' ', 1)
        if len(parts) == 2:
            new_task_name, due_text = parts
            new_due_date = parse_due_date(due_text)
            if new_due_date is None:
                new_task_name = new_content
                new_due_date = target_task['due_date']  # 元の期限を保持
        else:
            new_task_name = new_content
            new_due_date = target_task['due_date']  # 元の期限を保持

        # タスク名を更新
        sheet.update_cell(target_row, 1, new_task_name)
        
        # 期限を更新
        if new_due_date:
            sheet.update_cell(target_row, 7, new_due_date.strftime('%Y-%m-%d'))
        else:
            sheet.update_cell(target_row, 7, '')

        embed = discord.Embed(
            title="✏️ タスク編集完了",
            color=0x3498db
        )
        
        embed.add_field(
            name="📝 変更前",
            value=f"{target_task['name']}\n📅 {format_due_date(target_task['due_date'])}",
            inline=False
        )
        
        embed.add_field(
            name="📝 変更後",
            value=f"{new_task_name}\n📅 {format_due_date(new_due_date)}",
            inline=False
        )
        
        embed.set_author(name=ctx.author.display_name)

        await ctx.send(embed=embed)
        print(f"✏️ タスク編集: {target_task['name']} → {new_task_name} by {ctx.author.display_name}")

    except ValueError:
        await ctx.send("❌ 有効な番号を入力してください")
    except Exception as e:
        await ctx.send(f"❌ 編集エラー: {str(e)}")

# ===== 新機能7: タスク延期コマンド =====

@bot.command(name='postpone')
async def postpone_task(ctx, task_number: int, *, due_text="明日"):
    """タスクの期限を延期
    使用例: !postpone 1 明日
           !postpone 2 来週金曜
           !postpone 3  (デフォルトで明日に延期)
    """
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        # 自分の未完了タスクを取得
        user_tasks = []
        for i, row in enumerate(all_values[1:], start=2):
            if len(row) >= 6 and row[4] == str(ctx.author.id) and row[2] != 'TRUE':
                due_date = None
                if len(row) >= 7 and row[6]:
                    try:
                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                    except ValueError:
                        pass
                
                user_tasks.append({
                    'row': i,
                    'name': row[0],
                    'due_date': due_date
                })

        user_tasks.sort(key=lambda x: get_urgency_level(x['due_date']))

        if not user_tasks:
            await ctx.send("❌ 延期可能なタスクがありません")
            return

        if task_number < 1 or task_number > len(user_tasks):
            await ctx.send(f"❌ 無効な番号です (1-{len(user_tasks)})")
            return

        target_task = user_tasks[task_number - 1]
        target_row = target_task['row']

        # 新しい期限を解析
        new_due_date = parse_due_date(due_text)
        if new_due_date is None:
            await ctx.send(f"❌ 期限「{due_text}」を理解できませんでした")
            return

        # 期限を更新
        sheet.update_cell(target_row, 7, new_due_date.strftime('%Y-%m-%d'))

        embed = discord.Embed(
            title="⏰ タスク延期完了",
            description=f"**{target_task['name']}**",
            color=0xff9500
        )
        
        if target_task['due_date']:
            embed.add_field(
                name="📅 変更前の期限",
                value=format_due_date(target_task['due_date']),
                inline=True
            )
        else:
            embed.add_field(
                name="📅 変更前の期限",
                value="期限なし",
                inline=True
            )
        
        embed.add_field(
            name="📅 新しい期限",
            value=format_due_date(new_due_date),
            inline=True
        )
        
        embed.set_author(name=ctx.author.display_name)

        await ctx.send(embed=embed)
        print(f"⏰ タスク延期: {target_task['name']} → {new_due_date} by {ctx.author.display_name}")

    except ValueError:
        await ctx.send("❌ 有効な番号を入力してください")
    except Exception as e:
        await ctx.send(f"❌ 延期エラー: {str(e)}")

# ===== 新機能8: 週間レポートコマンド =====

@bot.command(name='weeklyreport')
async def weekly_report(ctx):
    """今週の完了タスク数とパフォーマンスレポート"""
    try:
        sheet = setup_google_sheets()
        if not sheet:
            await ctx.send("❌ スプレッドシートに接続できません")
            return

        all_values = sheet.get_all_values()

        if len(all_values) <= 1:
            await ctx.send("📊 レポート対象のタスクがありません")
            return

        # 今週の開始日（月曜日）と終了日（日曜日）を計算
        today = datetime.now().date()
        week_start = today - timedelta(days=today.weekday())  # 今週の月曜日
        week_end = week_start + timedelta(days=6)  # 今週の日曜日

        # 自分のタスク統計
        total_completed = 0
        this_week_completed = 0
        overdue_completed = 0  # 期限切れを完了
        on_time_completed = 0  # 期限内完了
        pending_tasks = 0
        urgent_pending = 0

        for row in all_values[1:]:
            if len(row) >= 6 and row[4] == str(ctx.author.id):
                is_completed = row[2] == 'TRUE'
                
                if is_completed:
                    total_completed += 1
                    
                    # 今週完了したタスクかチェック
                    if len(row) >= 4 and row[3]:  # 完了日があるか
                        try:
                            completed_date = datetime.strptime(row[3], '%Y/%m/%d %H:%M:%S').date()
                            if week_start <= completed_date <= week_end:
                                this_week_completed += 1
                                
                                # 期限内完了かチェック
                                if len(row) >= 7 and row[6]:
                                    try:
                                        due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                                        if completed_date <= due_date:
                                            on_time_completed += 1
                                        else:
                                            overdue_completed += 1
                                    except ValueError:
                                        pass
                        except ValueError:
                            pass
                else:
                    pending_tasks += 1
                    
                    # 緊急タスクかチェック
                    if len(row) >= 7 and row[6]:
                        try:
                            due_date = datetime.strptime(row[6], '%Y-%m-%d').date()
                            if (due_date - today).days <= 3:
                                urgent_pending += 1
                        except ValueError:
                            pass

        embed = discord.Embed(
            title=f"📊 {ctx.author.display_name}さんの週間レポート",
            description=f"対象期間: {week_start.strftime('%-m/%-d')} ～ {week_end.strftime('%-m/%-d')}",
            color=0x3498db
        )

        # 今週の実績
        embed.add_field(
            name="🏆 今週の実績",
            value=f"完了タスク: **{this_week_completed}件**\n期限内完了: **{on_time_completed}件**\n期限切れ完了: **{overdue_completed}件**",
            inline=False
        )

        # 現在の状況
        embed.add_field(
            name="📋 現在の状況",
            value=f"未完了タスク: **{pending_tasks}件**\n緊急タスク: **{urgent_pending}件**",
            inline=False
        )

        # パフォーマンス評価
        if this_week_completed > 0:
            on_time_rate = (on_time_completed / this_week_completed) * 100
            performance_text = f"期限内完了率: **{on_time_rate:.1f}%**\n"
            
            if on_time_rate >= 90:
                performance_text += "🌟 素晴らしいパフォーマンスです！"
                embed.color = 0x00ff00
            elif on_time_rate >= 70:
                performance_text += "👍 良好なパフォーマンスです！"
                embed.color = 0xffd700
            else:
                performance_text += "📈 改善の余地があります"
                embed.color = 0xff9500
        else:
            performance_text = "今週はまだタスクを完了していません"

        embed.add_field(
            name="📈 パフォーマンス",
            value=performance_text,
            inline=False
        )

        # 通算成績
        embed.add_field(
            name="🎯 通算成績",
            value=f"総完了タスク: **{total_completed}件**",
            inline=False
        )

        await ctx.send(embed=embed)

    except Exception as e:
        await ctx.send(f"❌ レポートエラー: {str(e)}")

@bot.command(name='taskhelp')
async def help_command(ctx):
    """網羅的なヘルプを複数のメッセージに分けて表示"""
    
    # メッセージ1: 基本機能
    embed1 = discord.Embed(
        title="🤖 タスク管理Bot - 完全ガイド (1/4)",
        description="**Discordで高機能なタスク管理を実現！**\n期限管理、検索、編集など豊富な機能を搭載",
        color=0x3498db
    )

    embed1.add_field(
        name="📝 基本のタスク管理",
        value="`!addtask [内容]` - タスク追加（期限なし）\n"
              "`!addtask [内容] [期限]` - 期限付きタスク追加\n"
              "`!tasks` - 自分のタスク一覧（期限順）\n"
              "`!complete [番号]` - タスクを完了にする",
        inline=False
    )

    embed1.add_field(
        name="⚡ 便利な追加コマンド",
        value="`!todayadd [タスク名]` - 今日締切のタスク追加\n"
              "`!tomorrowadd [タスク名]` - 明日締切のタスク追加\n"
              "`!thisweek [タスク名] [曜日]` - 今週締切のタスク追加\n"
              "　例: `!thisweek レポート提出 金曜`",
        inline=False
    )

    embed1.add_field(
        name="📅 期限の書き方例",
        value="• **日本語**: `今日` `明日` `明後日` `来週`\n"
              "• **曜日**: `月曜` `火曜` `来週金曜`\n"
              "• **相対**: `3日後` `来月`\n"
              "• **日付**: `2025-12-25` `12/25` `12-25`",
        inline=False
    )

    embed1.set_footer(text="→ 次のページで確認・編集コマンドを紹介")
    await ctx.send(embed=embed1)
    
    # 少し間隔を空ける
    await asyncio.sleep(2)

    # メッセージ2: 確認・編集機能
    embed2 = discord.Embed(
        title="🔍 タスク管理Bot - 完全ガイド (2/4)",
        description="**確認・編集・検索機能**",
        color=0xff9500
    )

    embed2.add_field(
        name="👀 タスク確認コマンド",
        value="`!tasks` - 自分のタスク一覧（期限順）\n"
              "`!urgent` - 3日以内の緊急タスクのみ\n"
              "`!today` - 今日期限のタスクのみ\n"
              "`!alltasks` - チーム全体のタスク状況\n"
              "`!search [キーワード]` - タスクを検索",
        inline=False
    )

    embed2.add_field(
        name="✏️ タスク編集コマンド",
        value="`!edit [番号] [新内容]` - タスク名・期限を編集\n"
              "　例: `!edit 1 新しいタスク名 明日`\n"
              "`!postpone [番号] [新期限]` - 期限を延期\n"
              "　例: `!postpone 2 来週金曜`",
        inline=False
    )

    embed2.add_field(
        name="🗑️ 削除コマンド",
        value="`!clearmytasks` - 自分のタスク全削除\n"
              "`!clearpending` - 自分の未完了タスクのみ削除\n"
              "`!clearcompleted` - 完了済みタスク削除（管理者用）",
        inline=False
    )

    embed2.set_footer(text="→ 次のページで統計・レポート機能を紹介")
    await ctx.send(embed=embed2)
    
    await asyncio.sleep(2)

    # メッセージ3: 統計・レポート機能
    embed3 = discord.Embed(
        title="📊 タスク管理Bot - 完全ガイド (3/4)",
        description="**統計・レポート・自動通知機能**",
        color=0x00ff00
    )

    embed3.add_field(
        name="📈 統計・レポート",
        value="`!taskstats` - 全体の統計情報\n"
              "　• 完了率、期限切れ件数など\n"
              "`!weeklyreport` - 個人の週間パフォーマンス\n"
              "　• 今週の完了数、期限内完了率など",
        inline=False
    )

    embed3.add_field(
        name="🔔 自動通知機能",
        value="**毎日朝の定期通知**\n"
              "• 一週間以内のタスクを自動通知\n"
              "• 期限切れ・緊急タスクを強調表示\n"
              "• 各ユーザーのタスク状況を一覧表示",
        inline=False
    )

    embed3.add_field(
        name="🧪 テスト・管理機能",
        value="`!testreminder` - 毎朝通知のテスト実行\n"
              "`!testconnection` - Google Sheets接続テスト\n"
              "`!fixsheet` - シート構造の自動修復",
        inline=False
    )

    embed3.set_footer(text="→ 次のページで使用例とコツを紹介")
    await ctx.send(embed=embed3)
    
    await asyncio.sleep(2)

    # メッセージ4: 使用例とコツ
    embed4 = discord.Embed(
        title="💡 タスク管理Bot - 完全ガイド (4/4)",
        description="**実用的な使用例とコツ**",
        color=0x9b59b6
    )

    embed4.add_field(
        name="🌟 実用的な使用例",
        value="**日常的な使い方:**\n"
              "`!todayadd 会議資料作成` - 今日中のタスク\n"
              "`!addtask プレゼン準備 来週月曜` - 計画的なタスク\n"
              "`!urgent` - 緊急度確認\n"
              "`!postpone 1 明日` - 予定変更時\n\n"
              "**チームでの使い方:**\n"
              "`!alltasks` - チーム状況確認\n"
              "`!taskstats` - 生産性分析",
        inline=False
    )

    embed4.add_field(
        name="🎯 効率的な使い方のコツ",
        value="• **期限設定**: 具体的な期限で管理効率UP\n"
              "• **定期確認**: `!tasks`で毎日チェック\n"
              "• **検索活用**: `!search`で過去タスクを発見\n"
              "• **編集機能**: `!edit`で柔軟に調整\n"
              "• **レポート**: `!weeklyreport`で振り返り",
        inline=False
    )

    embed4.add_field(
        name="🔧 トラブル時の対処",
        value="• 接続エラー → `!testconnection`\n"
              "• シート破損 → `!fixsheet`\n"
              "• 通知テスト → `!testreminder`\n"
              "• タスク整理 → `!clearpending`",
        inline=False
    )

    embed4.add_field(
        name="📱 よく使うコマンド一覧",
        value="`!tasks` `!urgent` `!todayadd` `!complete`\n"
              "`!edit` `!search` `!weeklyreport` `!postpone`",
        inline=False
    )

    embed4.set_footer(text="🎉 これでタスク管理をマスター！質問があればお気軽にどうぞ")
    await ctx.send(embed=embed4)

# 既存のデバッグ・修復系コマンドは省略（元のコードと同じ）

@bot.command(name='testconnection')
async def test_connection(ctx):
    """Google Sheets接続テスト専用コマンド"""
    try:
        await ctx.send("🔍 **Google Sheets接続テスト開始**")

        # 1. 環境変数確認
        spreadsheet_id = os.environ.get('SPREADSHEET_ID')
        google_key = os.environ.get('GOOGLE_SERVICE_KEY')

        if not spreadsheet_id:
            await ctx.send("❌ **SPREADSHEET_ID が設定されていません**")
            return

        if not google_key:
            await ctx.send("❌ **GOOGLE_SERVICE_KEY が設定されていません**")
            return

        await ctx.send(f"✅ 環境変数: 設定済み")
        await ctx.send(f"📋 スプレッドシートID: `{spreadsheet_id[:20]}...`")

        # 2. JSON解析テスト
        try:
            credentials_dict = json.loads(google_key)
            await ctx.send("✅ JSON解析: 成功")
            await ctx.send(f"📧 Service Email: `{credentials_dict.get('client_email', 'なし')}`")
        except json.JSONDecodeError as e:
            await ctx.send(f"❌ JSON解析エラー: {str(e)}")
            return

        # 3. Google認証テスト
        try:
            scope = [
                'https://spreadsheets.google.com/feeds',
                'https://www.googleapis.com/auth/drive'
            ]
            creds = ServiceAccountCredentials.from_json_keyfile_dict(credentials_dict, scope)
            client = gspread.authorize(creds)
            await ctx.send("✅ Google認証: 成功")
        except Exception as auth_error:
            await ctx.send(f"❌ Google認証エラー: {str(auth_error)}")
            return

        # 4. スプレッドシート接続テスト
        try:
            spreadsheet = client.open_by_key(spreadsheet_id)
            await ctx.send(f"✅ スプレッドシート接続: 成功")
            await ctx.send(f"📝 スプレッドシート名: `{spreadsheet.title}`")

            # 全シート一覧
            worksheets = spreadsheet.worksheets()
            sheet_names = [ws.title for ws in worksheets]
            await ctx.send(f"📄 利用可能なシート: {sheet_names}")

        except Exception as sheet_error:
            await ctx.send(f"❌ スプレッドシート接続エラー: {str(sheet_error)}")
            await ctx.send("🔧 **確認事項**:")
            await ctx.send("1. スプレッドシートIDが正しいか")
            await ctx.send("2. サービスアカウントがスプレッドシートにアクセス権を持っているか")
            await ctx.send("3. スプレッドシートが削除されていないか")
            return

        # 5. ワークシート接続テスト
        try:
            worksheet = spreadsheet.worksheet(SHEET_NAME)
            await ctx.send(f"✅ ワークシート '{SHEET_NAME}': 存在")

            # データ確認
            all_values = worksheet.get_all_values()
            await ctx.send(f"📊 データ行数: {len(all_values)}")

            if len(all_values) > 0:
                await ctx.send(f"📋 ヘッダー: {all_values[0]}")

        except gspread.WorksheetNotFound:
            await ctx.send(f"⚠️ ワークシート '{SHEET_NAME}' が存在しません")
            await ctx.send("🔧 **自動作成を試行中...**")

            try:
                new_sheet = spreadsheet.add_worksheet(title=SHEET_NAME, rows=1000, cols=10)
                new_sheet.append_row(['タスク名', '作成日', '完了', '完了日', 'ユーザーID', 'ユーザー名', '期限'])
                await ctx.send(f"✅ ワークシート '{SHEET_NAME}' を作成しました")
            except Exception as create_error:
                await ctx.send(f"❌ ワークシート作成エラー: {str(create_error)}")
                return

        except Exception as ws_error:
            await ctx.send(f"❌ ワークシートエラー: {str(ws_error)}")
            return

        await ctx.send("🎉 **すべてのテストが成功しました！**")
        await ctx.send("💡 **期限機能付きタスクコマンドが使用可能になりました**")

    except Exception as e:
        await ctx.send(f"❌ **テスト実行エラー**: {str(e)}")

@bot.command(name='fixsheet')
async def fix_sheet(ctx):
    """シート問題を自動修正（期限フィールド対応）"""
    try:
        await ctx.send("🔧 **シート修復開始**")

        # Google Sheets接続
        credentials_json = os.environ.get('GOOGLE_SERVICE_KEY')
        credentials_dict = json.loads(credentials_json)
        scope = [
            'https://spreadsheets.google.com/feeds',
            'https://www.googleapis.com/auth/drive'
        ]
        creds = ServiceAccountCredentials.from_json_keyfile_dict(credentials_dict, scope)
        client = gspread.authorize(creds)
        spreadsheet = client.open_by_key(SPREADSHEET_ID)

        await ctx.send(f"✅ スプレッドシート接続: {spreadsheet.title}")

        # tasksシートの存在確認
        try:
            worksheet = spreadsheet.worksheet(SHEET_NAME)
            await ctx.send(f"✅ '{SHEET_NAME}' シートは存在します")

            # ヘッダー確認
            headers = worksheet.row_values(1)
            expected_headers = ['タスク名', '作成日', '完了', '完了日', 'ユーザーID', 'ユーザー名', '期限']

            if len(headers) < 7:
                await ctx.send("🔧 期限フィールドを追加中...")
                worksheet.update_cell(1, 7, '期限')
                await ctx.send("✅ 期限フィールド追加完了")
            elif headers != expected_headers:
                await ctx.send("🔧 ヘッダーを修正中...")
                worksheet.clear()
                worksheet.append_row(expected_headers)
                await ctx.send("✅ ヘッダー修正完了")
            else:
                await ctx.send("✅ ヘッダーは正常です")

        except gspread.WorksheetNotFound:
            await ctx.send(f"⚠️ '{SHEET_NAME}' シートが見つかりません - 作成中...")
            worksheet = spreadsheet.add_worksheet(title=SHEET_NAME, rows=1000, cols=10)
            worksheet.append_row(['タスク名', '作成日', '完了', '完了日', 'ユーザーID', 'ユーザー名', '期限'])
            await ctx.send("✅ シート作成完了")

        await ctx.send("🎉 **修復完了！** 期限機能付きコマンドを試してください")

    except Exception as e:
        await ctx.send(f"❌ 修復エラー: {str(e)}")

@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.MissingRequiredArgument):
        await ctx.send("❌ 引数が不足しています。`!taskhelp` で確認してください")
    elif isinstance(error, commands.CommandNotFound):
        return
    else:
        await ctx.send(f"❌ エラーが発生しました: {str(error)}")
        print(f"❌ コマンドエラー: {error}")

if __name__ == "__main__":
    token = os.environ.get('DISCORD_BOT_TOKEN')
    if not token:
        print("❌ DISCORD_BOT_TOKEN が設定されていません")
    else:
        print("🚀 Botを起動中...")

        # FlaskサーバーをバックグラウンドでStart
        flask_thread = threading.Thread(target=run_flask, daemon=True)
        flask_thread.start()
        print("🌐 Webサーバー起動完了 (ポート: 8080)")

        # DiscordBot起動
        bot.run(token)
