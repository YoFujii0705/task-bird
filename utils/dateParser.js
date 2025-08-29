/**
 * 自然言語の期限表現を日付に変換（ローカル時間で処理）
 */
export function parseDueDate(dueText) {
    if (!dueText) return null;
    
    const text = dueText.trim().toLowerCase();
    
    // ローカル時間で今日の日付を取得（時分秒は0に設定）
    const today = new Date();
    const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    // 今日・明日
    if (['今日', 'きょう', 'today'].includes(text)) {
        return new Date(localToday);
    }
    
    if (['明日', 'あした', 'あす', 'tomorrow'].includes(text)) {
        const tomorrow = new Date(localToday);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
    }
    
    if (['明後日', 'あさって'].includes(text)) {
        const dayAfterTomorrow = new Date(localToday);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
        return dayAfterTomorrow;
    }
    
    // 曜日指定
    const weekdays = {
        '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6, '日': 0,
        '月曜': 1, '火曜': 2, '水曜': 3, '木曜': 4, '金曜': 5, '土曜': 6, '日曜': 0,
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 
        'friday': 5, 'saturday': 6, 'sunday': 0
    };
    
    for (const [dayName, targetDay] of Object.entries(weekdays)) {
        if (text.includes(dayName)) {
            const daysAhead = (targetDay - localToday.getDay() + 7) % 7;
            if (daysAhead === 0) {
                // 今日が該当曜日の場合は来週
                const nextWeek = new Date(localToday);
                nextWeek.setDate(nextWeek.getDate() + 7);
                return nextWeek;
            }
            const targetDate = new Date(localToday);
            targetDate.setDate(targetDate.getDate() + daysAhead);
            return targetDate;
        }
    }
    
    // 来週の曜日指定
    if (text.includes('来週')) {
        for (const [dayName, targetDay] of Object.entries(weekdays)) {
            if (text.includes(dayName)) {
                const daysAhead = (targetDay - localToday.getDay() + 7) % 7;
                const nextWeekDate = new Date(localToday);
                nextWeekDate.setDate(nextWeekDate.getDate() + 7 + daysAhead);
                return nextWeekDate;
            }
        }
        // 来週のみの場合は来週月曜日
        const nextMonday = new Date(localToday);
        const daysUntilMonday = (1 - localToday.getDay() + 7) % 7;
        nextMonday.setDate(nextMonday.getDate() + 7 + daysUntilMonday);
        return nextMonday;
    }
    
    // 相対的な日数
    const daysMatch = text.match(/(\d+)日後/);
    if (daysMatch) {
        const days = parseInt(daysMatch[1]);
        const targetDate = new Date(localToday);
        targetDate.setDate(targetDate.getDate() + days);
        return targetDate;
    }
    
    // 週指定
    if (text.includes('来週') || text.includes('next week')) {
        const nextWeek = new Date(localToday);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek;
    }
    
    if (text.includes('再来週')) {
        const twoWeeksLater = new Date(localToday);
        twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
        return twoWeeksLater;
    }
    
    // 月指定
    if (text.includes('来月') || text.includes('next month')) {
        const nextMonth = new Date(localToday);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        return nextMonth;
    }
    
    // 日付形式の解析
    const datePatterns = [
        /(\d{4})-(\d{1,2})-(\d{1,2})/,  // 2025-12-25
        /(\d{4})\/(\d{1,2})\/(\d{1,2})/, // 2025/12/25
        /(\d{1,2})\/(\d{1,2})/,          // 12/25
        /(\d{1,2})-(\d{1,2})/            // 12-25
    ];
    
    for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
            try {
                if (match.length === 4) { // 年月日
                    const [, year, month, day] = match;
                    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                } else { // 月日のみ
                    const [, month, day] = match;
                    const currentYear = localToday.getFullYear();
                    const date = new Date(currentYear, parseInt(month) - 1, parseInt(day));
                    
                    // 過去の日付の場合は来年として扱う
                    if (date < localToday) {
                        date.setFullYear(currentYear + 1);
                    }
                    return date;
                }
            } catch (error) {
                continue;
            }
        }
    }
    
    return null;
}

/**
 * 今日から指定日数後の日付を取得（ローカル時間）
 */
export function getDateAfterDays(days) {
    const today = new Date();
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    date.setDate(date.getDate() + days);
    return date;
}

/**
 * 今週の指定曜日の日付を取得（ローカル時間）
 */
export function getThisWeekday(weekday) {
    const today = new Date();
    const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const daysAhead = (weekday - localToday.getDay() + 7) % 7;
    if (daysAhead === 0 && new Date().getHours() >= 17) {
        // 今日が指定曜日で夕方以降なら来週
        const nextWeek = new Date(localToday);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek;
    }
    
    const targetDate = new Date(localToday);
    targetDate.setDate(targetDate.getDate() + daysAhead);
    return targetDate;
}

/**
 * 日付を YYYY-MM-DD 形式の文字列に変換（ローカル時間）
 */
export function formatDateForSheet(date) {
    if (!date) return '';
    
    // ローカル時間で YYYY-MM-DD 形式に変換
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}
