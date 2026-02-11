import { describe, it, expect } from 'vitest';

type JsonRecord = Record<string, any>;

const hasExplicitE2EBase = Boolean(process.env.E2E_BASE_URL);
const runE2E = process.env.RUN_E2E === 'true' || hasExplicitE2EBase;

const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const TENANT_KEY = process.env.E2E_TENANT_KEY || 'd3m0s4ln';
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN;
const LINE_ID_TOKEN = process.env.E2E_LINE_ID_TOKEN;

const API_BASE = `${BASE_URL}/api/v1/${TENANT_KEY}`;

const publicSuite = runE2E ? describe : describe.skip;
const adminSuite = runE2E && ADMIN_TOKEN ? describe : describe.skip;
const lineSuite = runE2E && LINE_ID_TOKEN ? describe : describe.skip;

async function requestJson(path: string, options: RequestInit = {}) {
    const res = await fetch(`${API_BASE}${path}`, options);
    const text = await res.text();
    let json: JsonRecord | null = null;
    if (text) {
        try {
            json = JSON.parse(text);
        } catch {
            json = null;
        }
    }
    return { res, json };
}

function formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
}

async function findAvailableSlot(menuId: string) {
    for (let i = 1; i <= 14; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        const dateStr = formatDate(date);
        const { json } = await requestJson(`/slots?date=${dateStr}&menuIds=${menuId}`);
        const slots = json?.data?.slots as Array<{ time: string; available: boolean; practitionerIds: string[] }> | undefined;
        if (!slots?.length) continue;
        const slot = slots.find((s) => s.available && s.practitionerIds?.length);
        if (slot) {
            return { date: dateStr, time: slot.time, practitionerId: slot.practitionerIds[0] };
        }
    }
    return null;
}

publicSuite('E2E Smoke (public)', () => {
    it('returns config, menus, options, practitioners, slots', async () => {
        const configRes = await requestJson('/auth/config');
        expect(configRes.res.ok).toBe(true);
        expect(configRes.json?.success).toBe(true);

        const menusRes = await requestJson('/menus');
        expect(menusRes.res.ok).toBe(true);
        expect(Array.isArray(menusRes.json?.data)).toBe(true);

        const optionsRes = await requestJson('/options');
        expect(optionsRes.res.ok).toBe(true);

        const practitionersRes = await requestJson('/practitioners');
        expect(practitionersRes.res.ok).toBe(true);
        expect(Array.isArray(practitionersRes.json?.data)).toBe(true);

        const menus = menusRes.json?.data as Array<{ id: string }> | undefined;
        const menuId = menus?.[0]?.id;
        expect(menuId).toBeTruthy();

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const slotsRes = await requestJson(`/slots?date=${formatDate(tomorrow)}&menuIds=${menuId}`);
        expect(slotsRes.res.ok).toBe(true);
        expect(slotsRes.json?.success).toBe(true);
    });
});

adminSuite('E2E Admin (requires E2E_ADMIN_TOKEN)', () => {
    it('creates a reservation via admin API', async () => {
        const menusRes = await requestJson('/menus');
        expect(menusRes.res.ok).toBe(true);
        const menus = menusRes.json?.data as Array<{ id: string }> | undefined;
        expect(menus?.length).toBeTruthy();

        const menuId = menus?.[0]?.id;
        expect(menuId).toBeTruthy();

        const slot = await findAvailableSlot(menuId);
        expect(slot).toBeTruthy();

        const body = {
            customerName: `E2E Tester ${Date.now()}`,
            customerPhone: '080-0000-0000',
            practitionerId: slot?.practitionerId,
            menuIds: [menuId],
            optionIds: [],
            date: slot?.date,
            startTime: slot?.time,
            status: 'confirmed',
            isNomination: false,
        };

        const createRes = await requestJson('/admin/reservations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ADMIN_TOKEN}`,
            },
            body: JSON.stringify(body),
        });

        expect(createRes.res.ok).toBe(true);
        expect(createRes.json?.success).toBe(true);
        expect(createRes.json?.data?.id).toBeTruthy();
    });
});

lineSuite('E2E Customer (requires E2E_LINE_ID_TOKEN)', () => {
    it('creates a reservation via customer API', async () => {
        const menusRes = await requestJson('/menus');
        expect(menusRes.res.ok).toBe(true);
        const menus = menusRes.json?.data as Array<{ id: string }> | undefined;
        const menuId = menus?.[0]?.id;
        expect(menuId).toBeTruthy();

        const slot = await findAvailableSlot(menuId);
        expect(slot).toBeTruthy();

        const createRes = await requestJson('/reservations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${LINE_ID_TOKEN}`,
            },
            body: JSON.stringify({
                practitionerId: slot?.practitionerId,
                menuIds: [menuId],
                optionIds: [],
                date: slot?.date,
                startTime: slot?.time,
                customerName: 'E2E LINE User',
                customerPhone: '080-1111-1111',
                isNomination: false,
            }),
        });

        expect(createRes.res.ok).toBe(true);
        expect(createRes.json?.success).toBe(true);
        expect(createRes.json?.data?.id).toBeTruthy();
    });
});
