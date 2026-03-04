import { describe, it, expect, vi, afterEach } from 'vitest';

describe('logger', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('開発環境ではコンソールに出力する', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        const { logger } = await import('./logger');

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const infoSpy  = vi.spyOn(console, 'info').mockImplementation(() => {});

        logger.error('test error');
        logger.warn('test warn');
        logger.info('test info');

        expect(errorSpy).toHaveBeenCalledWith('test error');
        expect(warnSpy).toHaveBeenCalledWith('test warn');
        expect(infoSpy).toHaveBeenCalledWith('test info');
    });

    it('本番環境ではコンソールに出力しない', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const { logger } = await import('./logger');

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const infoSpy  = vi.spyOn(console, 'info').mockImplementation(() => {});

        logger.error('should not appear');
        logger.warn('should not appear');
        logger.info('should not appear');

        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(infoSpy).not.toHaveBeenCalled();
    });
});
