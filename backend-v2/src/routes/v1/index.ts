/**
 * V1 API Router
 * Aggregates all v1 routes
 */

import { Router } from 'express';
import { resolveTenant } from '../../middleware/index.js';
import { authRoutes } from './auth.routes.js';
import { slotRoutes } from './slot.routes.js';
import { menuPublicRoutes } from './menu.public.routes.js';
import { practitionerPublicRoutes } from './practitioner.public.routes.js';
import { optionPublicRoutes } from './option.public.routes.js';
import { reservationCustomerRoutes } from './reservation.customer.routes.js';
import { reservationAdminRoutes } from './reservation.admin.routes.js';
import { menuAdminRoutes } from './menu.admin.routes.js';
import { practitionerAdminRoutes } from './practitioner.admin.routes.js';
import { optionAdminRoutes } from './option.admin.routes.js';
import { storeAdminRoutes } from './store.admin.routes.js';
import { karteAdminRoutes } from './karte.admin.routes.js';
import { karteTemplateAdminRoutes } from './karte-template.admin.routes.js';
import { googleCalendarAdminRoutes, googleCalendarCallbackRoutes } from './google-calendar.routes.js';

import dashboardRoutes from './dashboard.routes.js';
import customerRoutes from './customer.routes.js';
import settingsRoutes from './settings.routes.js';
import reminderRoutes from './reminder.routes.js';
import jobRoutes from './jobs.routes.js';
import reportsRoutes from './reports.routes.js';
import adminJobRoutes from './jobs.admin.routes.js';

// Keep parent params (e.g. :tenantKey from /api/v1/:tenantKey) available in child routes.
const router = Router({ mergeParams: true });

// All v1 routes require tenant context
router.use(resolveTenant({ required: true }));

// Public / customer routes
router.use('/auth', authRoutes);
router.use('/menus', menuPublicRoutes);
router.use('/practitioners', practitionerPublicRoutes);
router.use('/options', optionPublicRoutes);
router.use('/reservations', reservationCustomerRoutes);
router.use('/slots', slotRoutes);

// Admin Dashboard Routes
router.use('/admin/dashboard', dashboardRoutes);
router.use('/admin/customers', customerRoutes);
router.use('/admin/settings', settingsRoutes);
router.use('/admin/reminders', reminderRoutes);
router.use('/admin/reports', reportsRoutes);
router.use('/admin/jobs', adminJobRoutes);
router.use('/admin/reservations', reservationAdminRoutes);
router.use('/admin/menus', menuAdminRoutes);
router.use('/admin/practitioners', practitionerAdminRoutes);
router.use('/admin/options', optionAdminRoutes);
router.use('/admin/stores', storeAdminRoutes);
router.use('/admin/kartes', karteAdminRoutes);
router.use('/admin/karte-templates', karteTemplateAdminRoutes);
router.use('/admin/integrations/google-calendar', googleCalendarAdminRoutes);
router.use('/integrations/google-calendar', googleCalendarCallbackRoutes);

// Job Routes
router.use('/jobs', jobRoutes); // 自動実行用

export const v1Router = router;
