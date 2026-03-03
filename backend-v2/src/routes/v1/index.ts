/**
 * V1 Public/Customer Router
 * Tenant is resolved from the :tenantKey URL parameter.
 * Mounted at /api/v1/:tenantKey — customer-facing routes only.
 * Admin routes have been moved to admin-index.ts (JWT Custom Claims based).
 */

import { Router } from 'express';
import { resolveTenant } from '../../middleware/index.js';
import { authRoutes } from './auth.routes.js';
import { slotRoutes } from './slot.routes.js';
import { menuPublicRoutes } from './menu.public.routes.js';
import { practitionerPublicRoutes } from './practitioner.public.routes.js';
import { optionPublicRoutes } from './option.public.routes.js';
import { reservationCustomerRoutes } from './reservation.customer.routes.js';
import { googleCalendarCallbackRoutes } from './google-calendar.routes.js';
import jobRoutes from './jobs.routes.js';

// Keep parent params (e.g. :tenantKey from /api/v1/:tenantKey) available in child routes.
const router = Router({ mergeParams: true });

// All customer routes require tenant context resolved from URL slug
router.use(resolveTenant({ required: true }));

// Public / customer routes
router.use('/auth', authRoutes);
router.use('/menus', menuPublicRoutes);
router.use('/practitioners', practitionerPublicRoutes);
router.use('/options', optionPublicRoutes);
router.use('/reservations', reservationCustomerRoutes);
router.use('/slots', slotRoutes);
router.use('/integrations/google-calendar', googleCalendarCallbackRoutes);

// Job Routes (Cloud Scheduler から呼ばれる自動実行用)
router.use('/jobs', jobRoutes);

export const v1Router = router;
