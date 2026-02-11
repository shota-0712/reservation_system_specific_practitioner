import type { BaseEntity, Timestamp } from './index.js';

export interface ServiceMessageLog extends BaseEntity {
    reservationId: string;
    customerId: string;
    templateName: string;
    status: 'success' | 'failed';
    sentAt: Timestamp;
    error?: string;
    messageId?: string; // LINE message ID
}
