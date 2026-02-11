import { beforeAll, describe, expect, it } from 'vitest';

let v1Router: any;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
    const routes = await import('../../src/routes/v1/index.js');
    v1Router = routes.v1Router;
});

describe('v1 router', () => {
    it('inherits parent params for tenant resolution', () => {
        expect(v1Router).toBeDefined();
        expect(v1Router.mergeParams).toBe(true);
    });
});
