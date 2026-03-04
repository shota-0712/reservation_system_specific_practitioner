/**
 * Admin V1 Router
 * Tenant is resolved from Firebase Custom Claims (tenantId), NOT from the URL slug.
 * Mounted at /api/v1/admin — no :tenantKey in path.
 */

import { Router } from 'express';
import { requireJwtTenant, requireFirebaseAuth } from '../../middleware/index.js';

import dashboardRoutes from './dashboard.routes.js';
import customerRoutes from './customer.routes.js';
import settingsRoutes from './settings.routes.js';
import reminderRoutes from './reminder.routes.js';
import adminJobRoutes from './jobs.admin.routes.js';
import reportsRoutes from './reports.routes.js';
import { onboardingAdminRoutes } from './onboarding.admin.routes.js';
import { reservationAdminRoutes } from './reservation.admin.routes.js';
import { menuAdminRoutes } from './menu.admin.routes.js';
import { practitionerAdminRoutes } from './practitioner.admin.routes.js';
import { optionAdminRoutes } from './option.admin.routes.js';
import { storeAdminRoutes } from './store.admin.routes.js';
import { bookingLinkAdminRoutes } from './booking-link.admin.routes.js';
import { karteAdminRoutes } from './karte.admin.routes.js';
import { karteTemplateAdminRoutes } from './karte-template.admin.routes.js';
import { googleCalendarAdminRoutes } from './google-calendar.routes.js';

const router = Router();

// 1. Resolve tenant from JWT Custom Claims (sets req.tenantId)
router.use(requireJwtTenant());
// 2. Verify Firebase token and load admin role/permissions from DB
router.use(requireFirebaseAuth());

router.use('/dashboard', dashboardRoutes);
router.use('/customers', customerRoutes);
router.use('/settings', settingsRoutes);
router.use('/onboarding', onboardingAdminRoutes);
router.use('/reminders', reminderRoutes);
router.use('/reports', reportsRoutes);
router.use('/jobs', adminJobRoutes);
router.use('/reservations', reservationAdminRoutes);
router.use('/menus', menuAdminRoutes);
router.use('/practitioners', practitionerAdminRoutes);
router.use('/options', optionAdminRoutes);
router.use('/stores', storeAdminRoutes);
router.use('/booking-links', bookingLinkAdminRoutes);
router.use('/kartes', karteAdminRoutes);
router.use('/karte-templates', karteTemplateAdminRoutes);
router.use('/integrations/google-calendar', googleCalendarAdminRoutes);

export const adminV1Router = router;
