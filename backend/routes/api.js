const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheets');
const calendarService = require('../services/calendar');
const lineService = require('../services/line');
const storageService = require('../services/storage');  // Google Cloud Storage

// 店舗情報 (メッセージに使用)
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

const ADMIN_LINE_ID = process.env.ADMIN_LINE_ID;

// ヘルパー: 管理者チェック
function isAdmin(userId) {
    return userId === ADMIN_LINE_ID;
}

// ====================
// メニュー関連
// ====================

// GET /api/menus - メニュー一覧取得
router.get('/menus', async (req, res, next) => {
    try {
        const menus = await sheetsService.getMenus();
        res.json(menus);
    } catch (err) {
        next(err);
    }
});

// POST /api/menus - メニュー追加 (管理者のみ)
router.post('/menus', async (req, res, next) => {
    try {
        const { adminId, menu } = req.body;
        if (!isAdmin(adminId)) {
            return res.status(403).json({ status: 'error', message: '権限がありません' });
        }
        const result = await sheetsService.addMenu(menu);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// PUT /api/menus/:id - メニュー更新 (管理者のみ)
router.put('/menus/:id', async (req, res, next) => {
    try {
        const { adminId, menu } = req.body;
        const menuId = req.params.id;
        if (!isAdmin(adminId)) {
            return res.status(403).json({ status: 'error', message: '権限がありません' });
        }
        const result = await sheetsService.updateMenu(menuId, menu);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/menus/:id - メニュー削除 (管理者のみ)
router.delete('/menus/:id', async (req, res, next) => {
    try {
        const { adminId } = req.body;
        const menuId = req.params.id;
        if (!isAdmin(adminId)) {
            return res.status(403).json({ status: 'error', message: '権限がありません' });
        }
        const result = await sheetsService.deleteMenu(menuId);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// ====================
// 予約スロット関連
// ====================

// GET /api/slots - 指定日の空き時間取得
router.get('/slots', async (req, res, next) => {
    try {
        const { date, minutes } = req.query;
        const slots = await calendarService.getAvailableSlots(date, parseInt(minutes));
        res.json(slots);
    } catch (err) {
        next(err);
    }
});

// GET /api/weekly-availability - 週間空き状況取得
router.get('/weekly-availability', async (req, res, next) => {
    try {
        const { startDate, minutes } = req.query;
        const availability = await calendarService.getWeeklyAvailability(startDate, parseInt(minutes));
        res.json(availability);
    } catch (err) {
        next(err);
    }
});

// ====================
// 予約関連
// ====================

// GET /api/history - ユーザーの予約履歴取得
router.get('/history', async (req, res, next) => {
    try {
        const { userId } = req.query;
        const history = await sheetsService.getUserReservations(userId);
        res.json(history);
    } catch (err) {
        next(err);
    }
});

// GET /api/reservations - 全予約一覧 (管理者のみ)
router.get('/reservations', async (req, res, next) => {
    try {
        const { adminId } = req.query;
        if (!isAdmin(adminId)) {
            return res.status(403).json({ status: 'error', message: '権限がありません' });
        }
        const reservations = await sheetsService.getAllReservations();
        res.json(reservations);
    } catch (err) {
        next(err);
    }
});

// POST /api/reservations - 予約作成
router.post('/reservations', async (req, res, next) => {
    try {
        const data = req.body;

        // カレンダーで重複チェック
        const dateTime = new Date(`${data.date.replace(/\//g, '-')}T${data.time}:00+09:00`);
        const endTime = new Date(dateTime.getTime() + data.menu.minutes * 60000);

        const hasConflict = await calendarService.checkConflict(dateTime, endTime);
        if (hasConflict) {
            return res.json({ status: 'error', message: '指定された時間は既に予約が入っています' });
        }

        // カレンダーに予約を追加
        const eventId = await calendarService.createEvent(
            `【予約】${data.name}様 (${data.menu.name})`,
            dateTime,
            endTime,
            `電話番号: ${data.phone || ''}\nLINE ID: ${data.userId}`
        );

        // スプレッドシートに予約を記録
        await sheetsService.addReservation({
            ...data,
            eventId
        });

        // LINE通知 (ユーザーへ)
        const userMessage = `
${data.name}様
ご予約ありがとうございます。

📅 日時: ${data.date} ${data.time}
💆‍♀️ メニュー: ${data.menu.name}
---------------
${SALON_INFO}
---------------
${PRECAUTIONS}
`.trim();
        await lineService.pushMessage(data.userId, userMessage);

        // LINE通知 (管理者へ)
        const adminMessage = `
【新規予約が入りました】
👤 名前: ${data.name} 様
📅 日時: ${data.date} ${data.time}
💆‍♀️ メニュー: ${data.menu.name}
📱 電話: ${data.phone || 'なし'}
`.trim();
        await lineService.pushMessage(ADMIN_LINE_ID, adminMessage);

        res.json({ status: 'success' });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/reservations/:id - 予約キャンセル
router.delete('/reservations/:id', async (req, res, next) => {
    try {
        const { userId } = req.body;
        const reservationId = req.params.id;

        // 予約情報を取得
        const reservation = await sheetsService.getReservationById(reservationId, userId);
        if (!reservation) {
            return res.json({ status: 'error', message: '予約が見つかりませんでした' });
        }

        // カレンダーから削除
        if (reservation.eventId) {
            await calendarService.deleteEvent(reservation.eventId);
        }

        // スプレッドシートのステータスを更新
        await sheetsService.cancelReservation(reservationId);

        // LINE通知 (ユーザーへ)
        const userMessage = `
${reservation.name}様
ご予約のキャンセルを承りました。

📅 日時: ${reservation.date} ${reservation.time}
💆‍♀️ メニュー: ${reservation.menu}
---------------
${SALON_INFO}
---------------
またのご来店を心よりお待ちしております。
`.trim();
        await lineService.pushMessage(userId, userMessage);

        // LINE通知 (管理者へ)
        const adminMessage = `
【予約キャンセルがありました】
👤 名前: ${reservation.name} 様
📅 日時: ${reservation.date} ${reservation.time}
💆‍♀️ メニュー: ${reservation.menu}
`.trim();
        await lineService.pushMessage(ADMIN_LINE_ID, adminMessage);

        res.json({ status: 'success' });
    } catch (err) {
        next(err);
    }
});

// ====================
// 管理者関連
// ====================

// GET /api/check-admin - 管理者判定
router.get('/check-admin', (req, res) => {
    const { userId } = req.query;
    res.json({ isAdmin: isAdmin(userId) });
});

// ====================
// 画像アップロード
// ====================

// POST /api/upload-image - 画像アップロード (管理者のみ)
router.post('/upload-image', async (req, res, next) => {
    try {
        const { adminId, imageData, fileName } = req.body;

        if (!isAdmin(adminId)) {
            return res.json({ status: 'error', code: 'E001', message: '[E001] 権限がありません' });
        }

        if (!imageData) {
            return res.json({ status: 'error', code: 'E003', message: '[E003] 画像データがありません' });
        }

        const result = await storageService.uploadImage(imageData, fileName);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// ====================
// バッチ処理関連
// ====================

// POST /api/batch/reminders - 翌日の予約リマインダー送信
router.post('/batch/reminders', async (req, res, next) => {
    try {
        const secret = req.headers['x-scheduler-secret'];
        const expectedSecret = process.env.SCHEDULER_SECRET;

        // セキュリティチェック
        if (!expectedSecret || secret !== expectedSecret) {
            console.log('[Batch] Unauthorized access attempt');
            return res.status(403).json({ status: 'error', message: 'Forbidden' });
        }

        console.log('[Batch] Starting reminder batch...');
        const reservations = await sheetsService.getTomorrowReservations();
        console.log(`[Batch] Found ${reservations.length} reservations for tomorrow`);

        let sentCount = 0;
        for (const r of reservations) {
            const message = `
${r.name}様
明日、ご予約の日時となりましたのでご連絡差し上げました。

📅 日時: ${r.date} ${r.time}
💆‍♀️ メニュー: ${r.menu}

${PRECAUTIONS.trim()}

---------------
${SALON_INFO.trim()}
---------------

ご来店を心よりお待ちしております。
`.trim();

            await lineService.pushMessage(r.lineId, message);
            sentCount++;
        }

        console.log(`[Batch] Sent ${sentCount} reminders`);
        res.json({ status: 'success', sentCount });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
