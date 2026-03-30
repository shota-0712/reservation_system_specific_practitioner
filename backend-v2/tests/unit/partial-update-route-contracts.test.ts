import { beforeAll, describe, expect, it } from 'vitest';

let customerRoutes: any;
let settingsRoutes: any;
let reservationAdminRoutes: any;
let reservationCustomerRoutes: any;

function getMethodsForPath(router: any, path: string): string[] {
    return router.stack
        .filter((layer: any) => layer.route?.path === path)
        .flatMap((layer: any) => Object.keys(layer.route.methods));
}

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ default: customerRoutes } = await import('../../src/routes/v1/customer.routes.js'));
    ({ default: settingsRoutes } = await import('../../src/routes/v1/settings.routes.js'));
    ({ reservationAdminRoutes } = await import('../../src/routes/v1/reservation.admin.routes.js'));
    ({ reservationCustomerRoutes } = await import('../../src/routes/v1/reservation.customer.routes.js'));
});

describe('partial update route contracts', () => {
    it('exposes PATCH for admin customer updates', () => {
        const methods = getMethodsForPath(customerRoutes, '/:id');

        expect(methods).toContain('patch');
        expect(methods).not.toContain('put');
    });

    it('exposes PATCH for admin reservation updates', () => {
        const methods = getMethodsForPath(reservationAdminRoutes, '/:id');

        expect(methods).toContain('patch');
        expect(methods).not.toContain('put');
    });

    it('exposes PATCH for customer reservation updates', () => {
        const methods = getMethodsForPath(reservationCustomerRoutes, '/:id');

        expect(methods).toContain('patch');
        expect(methods).not.toContain('put');
    });

    it('exposes PATCH for settings partial update routes', () => {
        for (const path of ['/notifications', '/profile', '/business', '/line', '/branding']) {
            const methods = getMethodsForPath(settingsRoutes, path);

            expect(methods).toContain('patch');
            expect(methods).not.toContain('put');
        }
    });
});
