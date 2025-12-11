const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Google Sheets API クライアントを取得
async function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

// ====================
// メニュー関連
// ====================

async function getMenus() {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'menus!A2:G',  // A:id, B:category, C:name, D:minutes, E:price, F:description, G:imageUrl
    });

    const rows = response.data.values || [];
    return rows.map(row => ({
        id: row[0],
        category: row[1] || '',
        name: row[2],
        minutes: parseInt(row[3]),
        price: row[4],
        description: row[5] || '',
        imageUrl: row[6] || '',
    }));
}

async function addMenu(menuData) {
    const sheets = await getSheetsClient();

    // 既存のメニューを取得して最大IDを見つける
    const menus = await getMenus();
    let maxId = 0;
    menus.forEach(menu => {
        const id = parseInt(menu.id);
        if (id > maxId) maxId = id;
    });
    const newId = maxId + 1;

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'menus!A:G',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[
                newId,
                menuData.category || '',
                menuData.name,
                menuData.minutes,
                menuData.price,
                menuData.description || '',
                menuData.imageUrl || '',
            ]],
        },
    });

    return { status: 'success', menuId: newId };
}

async function updateMenu(menuId, menuData) {
    const sheets = await getSheetsClient();

    // 対象行を見つける
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'menus!A:G',
    });

    const rows = response.data.values || [];
    let targetRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(menuId)) {
            targetRowIndex = i + 1; // 1-indexed
            break;
        }
    }

    if (targetRowIndex === -1) {
        return { status: 'error', message: 'メニューが見つかりませんでした' };
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `menus!B${targetRowIndex}:G${targetRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[
                menuData.category || '',
                menuData.name,
                menuData.minutes,
                menuData.price,
                menuData.description || '',
                menuData.imageUrl || '',
            ]],
        },
    });

    return { status: 'success' };
}

async function deleteMenu(menuId) {
    const sheets = await getSheetsClient();

    // 対象行を見つける
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'menus!A:G',
    });

    const rows = response.data.values || [];
    let targetRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(menuId)) {
            targetRowIndex = i + 1; // 1-indexed (header is row 1)
            break;
        }
    }

    if (targetRowIndex === -1) {
        return { status: 'error', message: 'メニューが見つかりませんでした' };
    }

    // 行を削除
    const sheetId = await getSheetId('menus');
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            requests: [{
                deleteDimension: {
                    range: {
                        sheetId: sheetId,
                        dimension: 'ROWS',
                        startIndex: targetRowIndex - 1, // 0-indexed
                        endIndex: targetRowIndex,
                    },
                },
            }],
        },
    });

    return { status: 'success' };
}

// シートIDを取得するヘルパー
async function getSheetId(sheetName) {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
    });

    const sheet = response.data.sheets.find(s => s.properties.title === sheetName);
    return sheet ? sheet.properties.sheetId : null;
}

// ====================
// 予約関連
// ====================

async function getUserReservations(userId) {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'reservations!A2:I',
    });

    const rows = response.data.values || [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const history = [];
    for (const row of rows) {
        const rowDate = new Date(row[5]);
        if (row[2] === userId && row[7] === 'reserved' && rowDate >= now) {
            history.push({
                id: row[0],
                menu: row[4],
                date: row[5],
                time: row[6],
            });
        }
    }

    return history;
}

async function getAllReservations() {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'reservations!A2:I',
    });

    const rows = response.data.values || [];
    const reservations = rows.map(row => ({
        id: row[0],
        timestamp: row[1],
        lineId: row[2],
        name: row[3],
        menu: row[4],
        date: row[5],
        time: row[6],
        status: row[7],
        calEventId: row[8],
    }));

    // 日付順でソート（新しい順）
    reservations.sort((a, b) => {
        const dateA = new Date(`${a.date} ${a.time}`);
        const dateB = new Date(`${b.date} ${b.time}`);
        return dateB - dateA;
    });

    return reservations;
}

async function addReservation(data) {
    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'reservations!A:I',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[
                uuidv4(),
                new Date().toISOString(),
                data.userId,
                data.name,
                data.menu.name,
                data.date,
                data.time,
                'reserved',
                data.eventId,
            ]],
        },
    });

    return { status: 'success' };
}

async function getReservationById(reservationId, userId) {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'reservations!A2:I',
    });

    const rows = response.data.values || [];
    for (const row of rows) {
        if (row[0] === reservationId && row[2] === userId) {
            return {
                id: row[0],
                name: row[3],
                menu: row[4],
                date: row[5],
                time: row[6],
                eventId: row[8],
            };
        }
    }

    return null;
}

async function cancelReservation(reservationId) {
    const sheets = await getSheetsClient();

    // 対象行を見つける
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'reservations!A:I',
    });

    const rows = response.data.values || [];
    let targetRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === reservationId) {
            targetRowIndex = i + 1; // 1-indexed
            break;
        }
    }

    if (targetRowIndex === -1) {
        return { status: 'error', message: '予約が見つかりませんでした' };
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `reservations!H${targetRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [['canceled']],
        },
    });

    return { status: 'success' };
}

module.exports = {
    getMenus,
    addMenu,
    updateMenu,
    deleteMenu,
    getUserReservations,
    getAllReservations,
    addReservation,
    getReservationById,
    cancelReservation,
};
