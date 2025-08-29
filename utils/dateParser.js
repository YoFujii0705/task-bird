/**
 * 自然言語の期限表現を日付に変換
 */
export function parseDueDate(dueText) {
    if (!dueText) return null;
    
    const text = dueText.trim().toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // 今日・明日
    if (['今日', 'きょう', 'today'].includes(text)) {
        return new Date(today);
    }
    
    if (['明日', 'あした', 'あす', 'tomorrow'].includes(text)) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
    }
    
    if (['明後日', 'あさって'].includes(text)) {
        const dayAfterTomorrow = new Date(today);
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
            const daysAhead = (targetDay - today.getDay() + 7) % 7;
            if (daysAhead === 0) {
                // 今日が該当曜日の場合は来週
                const nextWeek = new Date(today);
                nextWeek.setDate(nextWeek.getDate() + 7);
                return nextWeek;
            }
            const targetDate = new Date(today);
            targetDate.setDate(targetDate.getDate() + daysAhead);
            return targetDate;
        }
    }
    
    // 来週の曜日指定
    if (text.includes('来週')) {
        for (const [dayName, targetDay] of Object.entries(weekdays)) {
            if (text.includes(dayName)) {
                const daysAhead = (targetDay - today.getDay() + 7) % 7;
                const nextWeekDate = new Date(today);
                nextWeekDate.setDate(nextWeekDate.getDate() + 7 + daysAhead);
                return nextWeekDate;
            }
        }
        // 来週のみの場合は来週月曜日
        const nextMonday = new Date(today);
        const daysUntilMonday = (1 - today.getDay() + 7) % 7;
        nextMonday.setDate(nextMonday.getDate() + 7 + daysUntilMonday);
        return nextMonday;
    }
    
    // 相対的な日数
    const daysMatch = text.match(/(\d+)日後/);
    if (daysMatch) {
        const days = parseInt(daysMatch[1]);
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() + days);
        return targetDate;
    }
    
    // 週指定
    if (text.includes('来週') || text.includes('next week')) {
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek;
    }
    
    if (text.includes('再来週')) {
        const twoWeeksLater = new Date(today);
        twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
        return twoWeeksLater;
    }
    
    // 月指定
    if (text.includes('来月') || text.includes('next month')) {
        const nextMonth = new Date(today);
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
                    const currentYear = today.getFullYear();
                    const date = new Date(currentYear, parseInt(month) - 1, parseInt(day));
                    
                    // 過去の日付の場合は来年として扱う
                    if (date < today) {
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
 * 今日から指定日数後の日付を取得
 */
export function getDateAfterDays(days) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return date;
}

/**
 * 今週の指定曜日の日付を取得
 */
export function getThisWeekday(weekday) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const daysAhead = (weekday - today.getDay() + 7) % 7;
    if (daysAhead === 0 && new Date().getHours() >= 17) {
        // 今日が指定曜日で夕方以降なら来週
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek;
    }
    
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + daysAhead);
    return targetDate;
}

/**
 * 日付を YYYY-MM-DD 形式の文字列に変換
 */
export function formatDateForSheet(date) {
    if (!date) return '';
    return date.toISOString().split('T')[0];
}
