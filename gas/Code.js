// ==============================================
// 設定エリア (書き換えてください)
// ==============================================
const SHEET_ID = '1HwXZ3SMV9U01kGcKQ0g8gCr4LM9E4uU83yd5M4SRU3U';
const CALENDAR_ID = 'en.178.bz@gmail.com';
const ACCESS_TOKEN = '4u8PbFKHutUL7IWa8K10v298ervi8As3AOxAm9fQGrn7q4R3YxZI6iwtzb3WgAkmeE5N9cuGzJ8ivHHDDm2Ki2V5dDKsIjfb7I1Nov2F6eS2z/1tkvV69MAqWmJi8JdQ2O9AbIIP9RFnTv7nuTVUVAdB04t89/1O/w1cDnyilFU=';
const ADMIN_LINE_ID = 'U7859f282793bcc5d142d78b1675d17e1'; // 管理者のLINE User ID

// ★店舗情報 (メッセージに使われます)
const SALON_INFO = `
【店舗情報】
サロン名: en Inner health&beauty
最寄り駅: 千葉駅·東千葉駅
住所: 〒264-0035 千葉市若葉区東寺山町581-4 VIPイーストピアビル3階
営業時間: 10:00〜19:00 (完全予約制 / 19:00以降可、ご相談ください)
定休日: 不定休
駐車場: 有り
支払い方法：現金又はクレジットカード(2万以上のみ)
`;

// ★注意事項メッセージ
const PRECAUTIONS = `
【ご来店に際しての注意点】

⏰ 遅刻について
5分以上遅れる際は、必ずご連絡下さい。
お時間によっては、次のご予約に差し支える際は、施術の短縮・お日にち・お時間のご変更をさせていただく場合が御座います。

⚠️ キャンセルについて
無断・当日キャンセルを2回以上されますと、サロンのご利用をお控え頂く場合が御座います。

📅 サロン都合の変更について
やむを得ずお日にち・お時間をご変更させて頂く場合が御座います。
その際は、ご連絡にてご対応させて頂きます。

ご迷惑をお掛けしてしまいますが、予めご了承下さいませ。
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
    } else if (action === 'getWeeklyAvailability') {
        result = getWeeklyAvailability(e.parameter.startDate, parseInt(e.parameter.minutes));
    } else if (action === 'checkAdmin') {
        result = checkAdmin(e.parameter.userId);
    } else if (action === 'getAllReservations') {
        result = getAllReservations(e.parameter.adminId);
    }

    return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
}

// POSTリクエスト処理
// ==============================================
function doPost(e) {
    const json = JSON.parse(e.postData.contents);
    const action = json.action;
    let result = {};

    if (action === 'makeReservation') {
        result = makeReservation(json.data);
    } else if (action === 'cancelReservation') {
        result = cancelReservation(json.userId, json.reservationId);
    } else if (action === 'addMenu') {
        result = addMenu(json.adminId, json.menu);
    } else if (action === 'updateMenu') {
        result = updateMenu(json.adminId, json.menuId, json.menu);
    } else if (action === 'deleteMenu') {
        result = deleteMenu(json.adminId, json.menuId);
    } else {
        result = { status: 'error', message: 'Invalid action: ' + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
}

// ==============================================
// 4. 週次予約状況取得 (⚪︎, ×, -)
// ==============================================
function getWeeklyAvailability(startDateStr, menuMinutes) {
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    const startDate = new Date(startDateStr);
    const result = [];

    // 1週間分ループ
    for (let i = 0; i < 7; i++) {
        const targetDate = new Date(startDate);
        targetDate.setDate(startDate.getDate() + i);

        const dateStr = Utilities.formatDate(targetDate, 'Asia/Tokyo', 'yyyy/MM/dd');
        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][targetDate.getDay()];

        const events = calendar.getEventsForDay(targetDate);
        const slots = [];

        // 10:00 〜 19:30 まで 30分刻み
        let current = new Date(targetDate);
        current.setHours(10, 0, 0, 0);

        const endTimeLimit = new Date(targetDate);
        endTimeLimit.setHours(20, 0, 0, 0); // 最終受付考慮 (例: 19:30開始なら20:00終了)

        while (current.getTime() < endTimeLimit.getTime()) {
            const timeStr = Utilities.formatDate(current, 'Asia/Tokyo', 'HH:mm');
            const slotStart = new Date(current);
            const slotEnd = new Date(current.getTime() + (menuMinutes * 60000));

            let status = '⚪︎'; // デフォルトは空き

            // 1. 過去チェック
            const now = new Date();
            if (slotStart < now) {
                status = '-';
            } else {
                // 2. 予定重複チェック
                // 終了時間が営業時間を超える場合は不可
                if (slotEnd > endTimeLimit) {
                    status = '×';
                } else {
                    for (const event of events) {
                        // イベントと重なるか？ (開始 < イベント終了 && 終了 > イベント開始)
                        if (slotStart < event.getEndTime() && slotEnd > event.getStartTime()) {
                            status = '×';
                            break;
                        }
                    }
                }
            }

            slots.push({ time: timeStr, status: status });
            current = new Date(current.getTime() + (30 * 60000));
        }

        result.push({
            date: dateStr,
            day: dayOfWeek,
            slots: slots
        });
    }

    return result;
}

// ... (getAvailableSlots can be kept or removed, keeping for now as backup) ...
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

function makeReservation(data) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { status: 'error', message: 'サーバーが混み合っています' };

    try {
        const ss = SpreadsheetApp.openById(SHEET_ID);
        const sheet = ss.getSheetByName('reservations');
        const calendar = CalendarApp.getCalendarById(CALENDAR_ID);

        const date = new Date(data.date.replace(/-/g, '/') + ' ' + data.time);
        const endTime = new Date(date.getTime() + (data.menu.minutes * 60000));

        // 重複チェック
        const events = calendar.getEvents(date, endTime);
        if (events.length > 0) {
            return { status: 'error', message: '指定された時間は既に予約が入っています' };
        }

        // カレンダー登録
        const event = calendar.createEvent(
            `【予約】${data.name}様 (${data.menu.name})`,
            date,
            endTime,
            { description: `電話番号: ${data.phone}\nLINE ID: ${data.userId}` }
        );

        // シート登録
        const newRow = [
            Utilities.getUuid(),
            new Date(),
            data.userId,
            data.name,
            data.menu.name,
            data.date,
            data.time,
            'reserved',
            event.getId()
        ];
        sheet.appendRow(newRow);

        // LINE通知 (ユーザーへ)
        const message = `
${data.name}様
ご予約ありがとうございます。

📅 日時: ${data.date} ${data.time}
💆‍♀️ メニュー: ${data.menu.name}
---------------
${SALON_INFO}
---------------
${PRECAUTIONS}
`;
        pushLineMessage(data.userId, message.trim());

        // LINE通知 (管理者へ)
        const adminMessage = `
【新規予約が入りました】
👤 名前: ${data.name} 様
📅 日時: ${data.date} ${data.time}
💆‍♀️ メニュー: ${data.menu.name}
📱 電話: ${data.phone}
`;
        pushLineMessage(ADMIN_LINE_ID, adminMessage.trim());

        return { status: 'success' };

    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

function getUserReservations(userId) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('reservations');
    const data = sheet.getDataRange().getDisplayValues(); // Use getDisplayValues to get strings
    const history = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (let i = 1; i < data.length; i++) {
        // data[i][5] is "yyyy/MM/dd" string, data[i][6] is "HH:mm" string
        const rowDate = new Date(data[i][5]);

        if (data[i][2] === userId && data[i][7] === 'reserved' && rowDate >= now) {
            history.push({
                id: data[i][0],
                menu: data[i][4],
                date: data[i][5], // Use string directly
                time: data[i][6]  // Use string directly
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

            // LINE通知 (管理者へ)
            const adminMessage = `
【予約キャンセルがありました】
👤 名前: ${name} 様
📅 日時: ${date} ${time}
💆‍♀️ メニュー: ${menu}
`;
            pushLineMessage(ADMIN_LINE_ID, adminMessage.trim());

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

// ==============================================
// 5. メニュー取得
// ==============================================
function getMenus() {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('menus');
    const data = sheet.getDataRange().getValues();
    const menus = [];
    for (let i = 1; i < data.length; i++) {
        menus.push({
            id: data[i][0],
            name: data[i][1],
            minutes: parseInt(data[i][2]),
            price: data[i][3],
            description: data[i][4]
        });
    }
    return menus;
}

// ==============================================
// 6. 管理者機能
// ==============================================

// 管理者判定
function checkAdmin(userId) {
    return { isAdmin: userId === ADMIN_LINE_ID };
}

// 全予約一覧取得（管理者のみ）
function getAllReservations(adminId) {
    if (adminId !== ADMIN_LINE_ID) {
        return { status: 'error', message: '権限がありません' };
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('reservations');
    const data = sheet.getDataRange().getDisplayValues();
    const reservations = [];

    for (let i = 1; i < data.length; i++) {
        reservations.push({
            id: data[i][0],
            timestamp: data[i][1],
            lineId: data[i][2],
            name: data[i][3],
            menu: data[i][4],
            date: data[i][5],
            time: data[i][6],
            status: data[i][7],
            calEventId: data[i][8]
        });
    }

    // 日付順でソート（新しい順）
    reservations.sort((a, b) => {
        const dateA = new Date(a.date + ' ' + a.time);
        const dateB = new Date(b.date + ' ' + b.time);
        return dateB - dateA;
    });

    return reservations;
}

// メニュー追加
function addMenu(adminId, menuData) {
    if (adminId !== ADMIN_LINE_ID) {
        return { status: 'error', message: '権限がありません' };
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { status: 'error', message: 'サーバーが混み合っています' };

    try {
        const ss = SpreadsheetApp.openById(SHEET_ID);
        const sheet = ss.getSheetByName('menus');
        const data = sheet.getDataRange().getValues();

        // 新しいIDを生成（既存の最大ID + 1）
        let maxId = 0;
        for (let i = 1; i < data.length; i++) {
            const id = parseInt(data[i][0]);
            if (id > maxId) maxId = id;
        }
        const newId = maxId + 1;

        sheet.appendRow([
            newId,
            menuData.name,
            menuData.minutes,
            menuData.price,
            menuData.description || ''
        ]);

        return { status: 'success', menuId: newId };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

// メニュー編集
function updateMenu(adminId, menuId, menuData) {
    if (adminId !== ADMIN_LINE_ID) {
        return { status: 'error', message: '権限がありません' };
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { status: 'error', message: 'サーバーが混み合っています' };

    try {
        const ss = SpreadsheetApp.openById(SHEET_ID);
        const sheet = ss.getSheetByName('menus');
        const data = sheet.getDataRange().getValues();

        for (let i = 1; i < data.length; i++) {
            if (String(data[i][0]) === String(menuId)) {
                sheet.getRange(i + 1, 2).setValue(menuData.name);
                sheet.getRange(i + 1, 3).setValue(menuData.minutes);
                sheet.getRange(i + 1, 4).setValue(menuData.price);
                sheet.getRange(i + 1, 5).setValue(menuData.description || '');
                return { status: 'success' };
            }
        }

        return { status: 'error', message: 'メニューが見つかりませんでした' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

// メニュー削除
function deleteMenu(adminId, menuId) {
    if (adminId !== ADMIN_LINE_ID) {
        return { status: 'error', message: '権限がありません' };
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { status: 'error', message: 'サーバーが混み合っています' };

    try {
        const ss = SpreadsheetApp.openById(SHEET_ID);
        const sheet = ss.getSheetByName('menus');
        const data = sheet.getDataRange().getValues();

        for (let i = 1; i < data.length; i++) {
            if (String(data[i][0]) === String(menuId)) {
                sheet.deleteRow(i + 1);
                return { status: 'success' };
            }
        }

        return { status: 'error', message: 'メニューが見つかりませんでした' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}


// ==============================================
function testWeeklyAvailability() {
    const e = {
        parameter: {
            action: 'getWeeklyAvailability',
            startDate: '2025/12/09', // テストしたい日付 (yyyy/MM/dd)
            minutes: '60'
        }
    };

    console.log("--- テスト開始 ---");
    try {
        const result = doGet(e);
        console.log("結果:");
        console.log(result.getContent());
    } catch (err) {
        console.error("エラー発生:");
        console.error(err);
    }
    console.log("--- テスト終了 ---");
}

function testGetMenus() {
    console.log("--- メニュー取得テスト開始 ---");
    try {
        const menus = getMenus();
        console.log("取得できたメニュー数: " + menus.length);
        console.log(JSON.stringify(menus, null, 2));
    } catch (e) {
        console.error("エラー発生: " + e.toString());
    }
    console.log("--- メニュー取得テスト終了 ---");
}
