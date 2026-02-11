/**
 * Availability Slot Routes (v1)
 * Calculate and return available time slots
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateQuery, dateSchema } from '../../middleware/index.js';
import { getTenantId } from '../../middleware/tenant.js';
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
import {
    createReservationRepository,
    createPractitionerRepository,
    createMenuRepository,
    createStoreRepository
} from '../../repositories/index.js';
import type { ApiResponse, Practitioner, Menu as MenuType } from '../../types/index.js';

const router = Router();

// ============================================
// Types
// ============================================

interface TimeSlot {
    time: string;       // "09:00"
    available: boolean;
    practitionerIds: string[];  // Available practitioners at this time
}

interface DaySlots {
    date: string;       // "2026-02-01"
    dayOfWeek: number;  // 0-6 (Sunday-Saturday)
    isHoliday: boolean;
    slots: TimeSlot[];
}

interface WeekSlots {
    weekStart: string;
    weekEnd: string;
    days: DaySlots[];
}

interface StoreConfig {
    businessHours?: Record<string, { isOpen: boolean; openTime?: string; closeTime?: string }>;
    regularHolidays?: number[];
    temporaryHolidays?: string[];
    temporaryOpenDays?: string[];
    slotDuration?: number;
    advanceBookingDays?: number;
    timezone?: string;
}

const DEFAULT_TIMEZONE = 'Asia/Tokyo';

// ============================================
// Validation Schemas
// ============================================

const slotsQuerySchema = z.object({
    date: dateSchema,
    practitionerId: z.string().optional(),
    menuIds: z.string().optional(), // comma-separated
    duration: z.coerce.number().int().min(15).max(480).optional(),
});

const weekSlotsQuerySchema = z.object({
    startDate: dateSchema,
    practitionerId: z.string().optional(),
    menuIds: z.string().optional(),
});

// ============================================
// Helper Functions
// ============================================

/**
 * Generate time slots for a day
 */
function generateTimeSlots(
    startTime: string,
    endTime: string,
    intervalMinutes: number = 30
): string[] {
    const slots: string[] = [];
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    let currentMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    while (currentMinutes < endMinutes) {
        const hours = Math.floor(currentMinutes / 60);
        const mins = currentMinutes % 60;
        slots.push(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`);
        currentMinutes += intervalMinutes;
    }

    return slots;
}

function isHoliday(date: string, dayOfWeek: number, store?: StoreConfig): boolean {
    if (!store) return false;
    const isTempOpen = store.temporaryOpenDays?.includes(date) ?? false;
    const isTempHoliday = store.temporaryHolidays?.includes(date) ?? false;
    const isRegularHoliday = store.regularHolidays?.includes(dayOfWeek) ?? false;
    if (isTempOpen) return false;
    return isTempHoliday || isRegularHoliday;
}

function getBusinessHours(store: StoreConfig | undefined, dayOfWeek: number): { open: string; close: string; isOpen: boolean } {
    if (!store?.businessHours) {
        return { open: '09:00', close: '21:00', isOpen: true };
    }
    const config = store.businessHours[String(dayOfWeek)];
    if (!config || config.isOpen === false) {
        return { open: '09:00', close: '21:00', isOpen: false };
    }
    return {
        open: config.openTime || '09:00',
        close: config.closeTime || '21:00',
        isOpen: true,
    };
}

function isBeyondAdvanceBooking(date: string, store?: StoreConfig): boolean {
    if (!store?.advanceBookingDays) return false;
    const timezone = store.timezone || 'Asia/Tokyo';
    const nowInTimezone = toZonedTime(new Date(), timezone);
    const limit = new Date(nowInTimezone);
    limit.setDate(limit.getDate() + store.advanceBookingDays);
    const limitDate = format(limit, 'yyyy-MM-dd', { timeZone: timezone });
    return date > limitDate;
}

async function resolveStoreConfig(tenantId: string, storeId?: string): Promise<StoreConfig | undefined> {
    const storeRepo = createStoreRepository(tenantId);
    if (storeId) {
        const store = await storeRepo.findById(storeId);
        if (store) return store;
    }
    const stores = await storeRepo.findAll();
    return stores[0];
}

function getDayOfWeekInTimezone(date: string, timezone: string): number {
    const utcDate = fromZonedTime(`${date}T00:00:00`, timezone);
    const isoDay = Number(format(utcDate, 'i', { timeZone: timezone }));
    return isoDay % 7;
}

function filterPastSlotsForDate(date: string, slots: TimeSlot[], timezone: string): TimeSlot[] {
    const nowInTimezone = toZonedTime(new Date(), timezone);
    const todayInTimezone = format(nowInTimezone, 'yyyy-MM-dd', { timeZone: timezone });
    if (date !== todayInTimezone) {
        return slots;
    }

    const nowMinutes = nowInTimezone.getHours() * 60 + nowInTimezone.getMinutes();
    return slots.filter((slot) => {
        const [hours, minutes] = slot.time.split(':').map(Number);
        return hours * 60 + minutes > nowMinutes;
    });
}

/**
 * Check if practitioner works on given day
 */
function practitionerWorksOnDay(practitioner: Practitioner, dayOfWeek: number): boolean {
    return practitioner.schedule.workDays.includes(dayOfWeek);
}

/**
 * Check if time is within practitioner's work hours
 */
function isWithinWorkHours(
    time: string,
    practitioner: Practitioner,
    durationMinutes: number
): boolean {
    const { workHours, breakTime } = practitioner.schedule;

    const [timeHour, timeMin] = time.split(':').map(Number);
    const timeMinutes = timeHour * 60 + timeMin;
    const endMinutes = timeMinutes + durationMinutes;

    const [workStartHour, workStartMin] = workHours.start.split(':').map(Number);
    const [workEndHour, workEndMin] = workHours.end.split(':').map(Number);
    const workStartMinutes = workStartHour * 60 + workStartMin;
    const workEndMinutes = workEndHour * 60 + workEndMin;

    // Check if within work hours
    if (timeMinutes < workStartMinutes || endMinutes > workEndMinutes) {
        return false;
    }

    // Check if overlaps with break time
    if (breakTime) {
        const [breakStartHour, breakStartMin] = breakTime.start.split(':').map(Number);
        const [breakEndHour, breakEndMin] = breakTime.end.split(':').map(Number);
        const breakStartMinutes = breakStartHour * 60 + breakStartMin;
        const breakEndMinutes = breakEndHour * 60 + breakEndMin;

        // Overlaps if slot starts during break or ends during break
        if (
            (timeMinutes >= breakStartMinutes && timeMinutes < breakEndMinutes) ||
            (endMinutes > breakStartMinutes && endMinutes <= breakEndMinutes) ||
            (timeMinutes <= breakStartMinutes && endMinutes >= breakEndMinutes)
        ) {
            return false;
        }
    }

    return true;
}

/**
 * Check if reservation conflicts with time slot
 */
function hasConflict(
    slotStart: string,
    durationMinutes: number,
    reservations: Array<{ startTime: string; endTime: string }>
): boolean {
    const [slotHour, slotMin] = slotStart.split(':').map(Number);
    const slotStartMinutes = slotHour * 60 + slotMin;
    const slotEndMinutes = slotStartMinutes + durationMinutes;

    for (const res of reservations) {
        const [resStartHour, resStartMin] = res.startTime.split(':').map(Number);
        const [resEndHour, resEndMin] = res.endTime.split(':').map(Number);
        const resStartMinutes = resStartHour * 60 + resStartMin;
        const resEndMinutes = resEndHour * 60 + resEndMin;

        // Check overlap
        if (slotStartMinutes < resEndMinutes && slotEndMinutes > resStartMinutes) {
            return true;
        }
    }

    return false;
}

// ============================================
// Routes
// ============================================

/**
 * GET /slots
 * Get available time slots for a specific date
 */
router.get('/',
    validateQuery(slotsQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeId = (req as { storeId?: string }).storeId;
        const { date, practitionerId, menuIds, duration } = req.query as unknown as {
            date: string;
            practitionerId?: string;
            menuIds?: string;
            duration?: number;
        };

        const practitionerRepo = createPractitionerRepository(tenantId);
        const reservationRepo = createReservationRepository(tenantId);
        const menuRepo = createMenuRepository(tenantId);
        const store = await resolveStoreConfig(tenantId, storeId);
        const timezone = store?.timezone || DEFAULT_TIMEZONE;
        const dayOfWeek = getDayOfWeekInTimezone(date, timezone);

        // Calculate total duration from menus or use provided duration
        let totalDuration = duration || 60; // Default 60 minutes
        if (menuIds) {
            const menuIdArray = menuIds.split(',');
            const menus = await Promise.all(
                menuIdArray.map(id => menuRepo.findById(id))
            );
            totalDuration = menus
                .filter((m): m is MenuType => m !== null)
                .reduce((sum, m) => sum + m.duration, 0);
        }

        // Get practitioners
        let practitioners: Practitioner[];
        if (practitionerId) {
            const p = await practitionerRepo.findById(practitionerId);
            practitioners = p ? [p] : [];
        } else {
            practitioners = await practitionerRepo.findAllActive();
        }

        // Filter practitioners who work on this day
        practitioners = practitioners.filter(p => practitionerWorksOnDay(p, dayOfWeek));

        if (practitioners.length === 0) {
            const response: ApiResponse<DaySlots> = {
                success: true,
                data: {
                    date,
                    dayOfWeek,
                    isHoliday: false,
                    slots: [],
                },
            };
            res.json(response);
            return;
        }

        // Get reservations for the date
        const existingReservations = await reservationRepo.findByDate(date);

        // Build reservation map by practitioner
        const reservationsByPractitioner: Record<string, Array<{ startTime: string; endTime: string }>> = {};
        for (const res of existingReservations) {
            if (res.status === 'canceled') continue;
            if (!reservationsByPractitioner[res.practitionerId]) {
                reservationsByPractitioner[res.practitionerId] = [];
            }
            reservationsByPractitioner[res.practitionerId].push({
                startTime: res.startTime,
                endTime: res.endTime,
            });
        }

        const businessHours = getBusinessHours(store, dayOfWeek);

        if (isBeyondAdvanceBooking(date, store) || isHoliday(date, dayOfWeek, store) || !businessHours.isOpen) {
            const response: ApiResponse<DaySlots> = {
                success: true,
                data: {
                    date,
                    dayOfWeek,
                    isHoliday: true,
                    slots: [],
                },
            };
            res.json(response);
            return;
        }

        // Generate time slots
        const slotDuration = store?.slotDuration ?? 30;
        const allSlots = generateTimeSlots(
            businessHours.open,
            businessHours.close,
            slotDuration
        );

        // Check availability for each slot
        const slots: TimeSlot[] = allSlots.map(time => {
            const availablePractitioners: string[] = [];

            for (const practitioner of practitioners) {
                // Check if within practitioner's work hours
                if (!isWithinWorkHours(time, practitioner, totalDuration)) {
                    continue;
                }

                // Check for conflicts
                const practitionerReservations = reservationsByPractitioner[practitioner.id] || [];
                if (!hasConflict(time, totalDuration, practitionerReservations)) {
                    availablePractitioners.push(practitioner.id);
                }
            }

            return {
                time,
                available: availablePractitioners.length > 0,
                practitionerIds: availablePractitioners,
            };
        });

        const filteredSlots = filterPastSlotsForDate(date, slots, timezone);

        const response: ApiResponse<DaySlots> = {
            success: true,
            data: {
                date,
                dayOfWeek,
                isHoliday: false,
                slots: filteredSlots,
            },
        };

        res.json(response);
    })
);

/**
 * Calculate slots for a single day (shared function)
 */
async function calculateDaySlots(
    tenantId: string,
    date: string,
    practitionerId: string | undefined,
    totalDuration: number
): Promise<DaySlots> {
    const practitionerRepo = createPractitionerRepository(tenantId);
    const reservationRepo = createReservationRepository(tenantId);

    const store = await resolveStoreConfig(tenantId, undefined);
    const timezone = store?.timezone || DEFAULT_TIMEZONE;
    const dayOfWeek = getDayOfWeekInTimezone(date, timezone);

    // Get practitioners
    let practitioners: Practitioner[];
    if (practitionerId) {
        const p = await practitionerRepo.findById(practitionerId);
        practitioners = p ? [p] : [];
    } else {
        practitioners = await practitionerRepo.findAllActive();
    }

    // Filter practitioners who work on this day
    practitioners = practitioners.filter(p => practitionerWorksOnDay(p, dayOfWeek));

    if (practitioners.length === 0) {
        return {
            date,
            dayOfWeek,
            isHoliday: false,
            slots: [],
        };
    }

    // Get reservations for the date
    const existingReservations = await reservationRepo.findByDate(date);

    // Build reservation map by practitioner
    const reservationsByPractitioner: Record<string, Array<{ startTime: string; endTime: string }>> = {};
    for (const res of existingReservations) {
        if (res.status === 'canceled') continue;
        if (!reservationsByPractitioner[res.practitionerId]) {
            reservationsByPractitioner[res.practitionerId] = [];
        }
        reservationsByPractitioner[res.practitionerId].push({
            startTime: res.startTime,
            endTime: res.endTime,
        });
    }

    const businessHours = getBusinessHours(store, dayOfWeek);

    if (isBeyondAdvanceBooking(date, store) || isHoliday(date, dayOfWeek, store) || !businessHours.isOpen) {
        return {
            date,
            dayOfWeek,
            isHoliday: true,
            slots: [],
        };
    }

    // Generate time slots
    const slotDuration = store?.slotDuration ?? 30;
    const allSlots = generateTimeSlots(
        businessHours.open,
        businessHours.close,
        slotDuration
    );

    // Check availability for each slot
    const slots: TimeSlot[] = allSlots.map(time => {
        const availablePractitioners: string[] = [];

        for (const practitioner of practitioners) {
            // Check if within practitioner's work hours
            if (!isWithinWorkHours(time, practitioner, totalDuration)) {
                continue;
            }

            // Check for conflicts
            const practitionerReservations = reservationsByPractitioner[practitioner.id] || [];
            if (!hasConflict(time, totalDuration, practitionerReservations)) {
                availablePractitioners.push(practitioner.id);
            }
        }

        return {
            time,
            available: availablePractitioners.length > 0,
            practitionerIds: availablePractitioners,
        };
    });

    const filteredSlots = filterPastSlotsForDate(date, slots, timezone);

    return {
        date,
        dayOfWeek,
        isHoliday: false,
        slots: filteredSlots,
    };
}

/**
 * GET /slots/week
 * Get available slots for a week
 */
router.get('/week',
    validateQuery(weekSlotsQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const { startDate, practitionerId, menuIds } = req.query as unknown as {
            startDate: string;
            practitionerId?: string;
            menuIds?: string;
        };

        const menuRepo = createMenuRepository(tenantId);

        // Calculate total duration from menus
        let totalDuration = 60; // Default 60 minutes
        if (menuIds) {
            const menuIdArray = menuIds.split(',');
            const menus = await Promise.all(
                menuIdArray.map(id => menuRepo.findById(id))
            );
            totalDuration = menus
                .filter((m): m is MenuType => m !== null)
                .reduce((sum, m) => sum + m.duration, 0);
        }

        // Generate dates for the week
        const dates: string[] = [];
        const startDateObj = new Date(startDate);

        for (let i = 0; i < 7; i++) {
            const date = new Date(startDateObj);
            date.setDate(date.getDate() + i);
            dates.push(date.toISOString().split('T')[0]);
        }

        // Calculate slots for each day in parallel
        const days = await Promise.all(
            dates.map(date => calculateDaySlots(tenantId, date, practitionerId, totalDuration))
        );

        const response: ApiResponse<WeekSlots> = {
            success: true,
            data: {
                weekStart: dates[0],
                weekEnd: dates[6],
                days,
            },
        };

        res.json(response);
    })
);

export const slotRoutes = router;
