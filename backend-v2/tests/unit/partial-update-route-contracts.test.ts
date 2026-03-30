import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRouteSource(relativePath: string): string {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('partial update route contracts', () => {
    it('uses PATCH for admin customer updates', () => {
        const source = readRouteSource('../../src/routes/v1/customer.routes.ts');

        expect(source).toMatch(/router\.patch\(\s*'\/:id'/);
        expect(source).not.toMatch(/router\.put\(\s*'\/:id'/);
    });

    it('uses PATCH for admin reservation updates', () => {
        const source = readRouteSource('../../src/routes/v1/reservation.admin.routes.ts');

        expect(source).toMatch(/router\.patch\(\s*'\/:id'/);
        expect(source).not.toMatch(/router\.put\(\s*'\/:id'/);
    });

    it('uses PATCH for customer reservation updates', () => {
        const source = readRouteSource('../../src/routes/v1/reservation.customer.routes.ts');

        expect(source).toMatch(/router\.patch\(\s*'\/:id'/);
        expect(source).not.toMatch(/router\.put\(\s*'\/:id'/);
    });

    it('uses PATCH for settings partial update routes', () => {
        const source = readRouteSource('../../src/routes/v1/settings.routes.ts');

        for (const path of ['/notifications', '/profile', '/business', '/line', '/branding']) {
            const escapedPath = path.replace('/', '\\/');

            expect(source).toMatch(new RegExp(`router\\.patch\\(\\s*'${escapedPath}'`));
            expect(source).not.toMatch(new RegExp(`router\\.put\\(\\s*'${escapedPath}'`));
        }
    });
});
