import type { Practitioner } from '../types/index.js';

export function sanitizePractitionerForResponse(practitioner: Practitioner): Practitioner {
    if (!practitioner.lineConfig) {
        return practitioner;
    }

    return {
        ...practitioner,
        lineConfig: {
            liffId: practitioner.lineConfig.liffId,
            channelId: practitioner.lineConfig.channelId,
        },
    };
}

export function sanitizePractitionersForResponse(practitioners: Practitioner[]): Practitioner[] {
    return practitioners.map(sanitizePractitionerForResponse);
}
