// ==============================================
// 設定エリア (書き換えてください)
// ==============================================
const SHEET_ID = '1HwXZ3SMV9U01kGcKQ0g8gCr4LM9E4uU83yd5M4SRU3U';
const CALENDAR_ID = 'en.178.bz@gmail.com';
const ACCESS_TOKEN = '4u8PbFKHutUL7IWa8K10v298ervi8As3AOxAm9fQGrn7q4R3YxZI6iwtzb3WgAkmeE5N9cuGzJ8ivHHDDm2Ki2V5dDKsIjfb7I1Nov2F6eS2z/1tkvV69MAqWmJi8JdQ2O9AbIIP9RFnTv7nuTVUVAdB04t89/1O/w1cDnyilFU=';

// ★店舗情報 (メッセージに使われます)
const SALON_INFO = `
【店舗情報】
サロン名: en Inner health&beauty
電話番号: 03-0000-0000
住所: 東京都新宿区〇〇 1-2-3
アクセス: 〇〇駅から徒歩5分
道案内: 〇〇出口を出て...
営業時間: 10:00 - 20:00
定休日: 不定休
支払い方法: 完全キャッシュレス (現金不可)
駐車場: なし (近隣のコインパーキングをご利用ください)
`;

// ★注意事項メッセージ
const PRECAUTIONS = `
【ご来店に際しての注意事項】
当店は【完全キャッシュレス】です。

・現金支払不可のため、ご来店前に現金以外の決済方法をご準備ください
・施術当日のマスカラ・ビューラーはお控えください
・挙式前の方は最低3日は空けて下さい
・当店では5分以上の遅刻の場合、他の方のご迷惑になる為日時変更をして頂く場合があります
・中学生のお客様は保護者の同意書が必要です(小学生以下は施術不可)
・無断・当日キャンセルを3回されるとご利用不可となります
`;

// ==============================================
// GETリクエスト処理
// ==============================================
function doGet(e) {
    const action = e.parameter.action;
    let result = {};

    if (action === 'getMenus') {
        result = getMenus();
    } else if (action === 'getSlots') {
        result = getAvailableSlots(e.parameter.date, parseInt(e.parameter.minutes));
    } else if (action === 'getHistory') {
        result = getUserReservations(e.parameter.userId);
    }

    return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
}

// ==============================================
// POSTリクエスト処理
// ==============================================
function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);
        let result = {};

        if (data.action === 'cancel') {
            result = cancelReservation(data.userId, data.reservationId);
        } else {
            result = makeReservation(data);
        }

        return ContentService.createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

// ==============================================
// 2. 予約確定処理 (メッセージ内容を強化)
// ==============================================
function makeReservation(data) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { status: 'error', message: '混雑しています' };

    try {
        const slots = getAvailableSlots(data.date, data.menuMinutes);
        if (!slots.includes(data.time)) return { status: 'error', message: '枠が埋まりました' };

        const startTime = new Date(data.date + ' ' + data.time);
        const endTime = new Date(startTime.getTime() + (data.menuMinutes * 60000));

        // カレンダー登録
        const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
        const event = calendar.createEvent(`【予約】${data.name}様`, startTime, endTime, {
            description: `メニュー: ${data.menuName}\nLINE ID: ${data.userId}`
        });

        // スプシ登録
        const ss = SpreadsheetApp.openById(SHEET_ID);
        const id = Utilities.getUuid();
        ss.getSheetByName('reservations').appendRow([
            id, new Date(), data.userId, data.name, data.menuName, data.date, data.time, 'reserved', event.getId()
        ]);

        // 1通目: 予約完了メッセージ
        const message1 = `
${data.name}様
ご予約ありがとうございます。
以下の内容で承りました。

📅 日時: ${data.date} ${data.time}
💆‍♀️ メニュー: ${data.menuName}
---------------
${SALON_INFO}
---------------
当日はお気をつけてお越しください。
`;
        pushLineMessage(data.userId, message1.trim());

        // 2通目: 注意事項メッセージ
        pushLineMessage(data.userId, PRECAUTIONS.trim());

        return { status: 'success' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

// ==============================================
// 3. ★新機能: 明日の予約者にリマインドを送る関数
// ==============================================
function sendReminders() {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('reservations');
    const data = sheet.getDataRange().getValues();

    // 明日の日付を取得 (yyyy/MM/dd形式に整える)
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = Utilities.formatDate(tomorrow, 'Asia/Tokyo', 'yyyy/MM/dd');

    // 全データをチェック
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        // 日付の列(F列=index5)を文字列化して比較
        const rowDateStr = Utilities.formatDate(new Date(row[5]), 'Asia/Tokyo', 'yyyy/MM/dd');
        const status = row[7]; // H列=status
        const isReminded = row[8]; // I列=reminded (追加)

        // 「日付が明日」かつ「予約中(reserved)」かつ「未送信」の場合
        if (rowDateStr === tomorrowStr && status === 'reserved' && isReminded !== 'done') {
            const userId = row[2];
            const name = row[3];
            const time = row[6];

            const message = `
${name}様
こんばんは。
明日のご予約確認のご連絡です。

📅 日時: ${tomorrowStr} ${time}
---------------
${SALON_INFO}
---------------
変更やキャンセルがある場合は、
予約画面の「確認/キャンセル」タブからお手続きをお願いします。
お待ちしております！
`;
            pushLineMessage(userId, message.trim());

            // 送信済みフラグを立てる (I列)
            sheet.getRange(i + 1, 9).setValue('done');
        }
    }
}

// --- 以下、既存のロジック (変更なし) ---

function getMenus() {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('menus');
    const data = sheet.getDataRange().getValues();
    const menus = [];
    for (let i = 1; i < data.length; i++) {
        menus.push({ id: data[i][0], name: data[i][1], minutes: parseInt(data[i][2]), price: data[i][3] });
    }
    return menus;
}

function getAvailableSlots(dateStr, menuMinutes) {
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    const targetDate = new Date(dateStr);
    const events = calendar.getEventsForDay(targetDate);
    const availableSlots = [];
    let current = new Date(targetDate);
    current.setHours(10, 0, 0, 0);
    const endTimeLimit = new Date(targetDate);
    endTimeLimit.setHours(20, 0, 0, 0);
    while (current.getTime() + (menuMinutes * 60000) <= endTimeLimit.getTime()) {
        const slotStart = new Date(current);
        const slotEnd = new Date(current.getTime() + (menuMinutes * 60000));
        let isConflict = false;
        if (slotStart < new Date()) isConflict = true;
        for (const event of events) {
            if (slotStart < event.getEndTime() && slotEnd > event.getStartTime()) {
                isConflict = true; break;
            }
        }
        if (!isConflict) availableSlots.push(Utilities.formatDate(slotStart, 'Asia/Tokyo', 'HH:mm'));
        current = new Date(current.getTime() + (30 * 60000));
    }
    return availableSlots;
}

function getUserReservations(userId) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('reservations');
    const data = sheet.getDataRange().getValues();
    const history = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = 1; i < data.length; i++) {
        const rowDate = new Date(data[i][5]);
        if (data[i][2] === userId && data[i][7] === 'reserved' && rowDate >= now) {
            history.push({
                id: data[i][0],
                menu: data[i][4],
                date: Utilities.formatDate(rowDate, 'Asia/Tokyo', 'yyyy/MM/dd'),
                time: Utilities.formatDate(new Date(data[i][6]), 'Asia/Tokyo', 'HH:mm')
            });
        }
    }
    return history;
}

function cancelReservation(userId, reservationId) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('reservations');
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === reservationId && data[i][2] === userId) {
            const name = data[i][3];
            const menu = data[i][4];
            const date = Utilities.formatDate(new Date(data[i][5]), 'Asia/Tokyo', 'yyyy/MM/dd');
            const time = Utilities.formatDate(new Date(data[i][6]), 'Asia/Tokyo', 'HH:mm');

            const eventId = data[i][8];
            if (eventId) { try { CalendarApp.getCalendarById(CALENDAR_ID).getEventById(eventId).deleteEvent(); } catch (e) { } }
            sheet.getRange(i + 1, 8).setValue('canceled');

            const message = `
${name}様
ご予約のキャンセルを承りました。

📅 日時: ${date} ${time}
💆‍♀️ メニュー: ${menu}
---------------
${SALON_INFO}
---------------
またのご来店を心よりお待ちしております。
`;
            pushLineMessage(userId, message.trim());

            return { status: 'success' };
        }
    }
    return { status: 'error', message: '予約が見つかりませんでした' };
}

function pushLineMessage(userId, text) {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        'method': 'post',
        'headers': { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ACCESS_TOKEN },
        'payload': JSON.stringify({ 'to': userId, 'messages': [{ 'type': 'text', 'text': text }] })
    });
}
