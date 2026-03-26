# reserve-v3 real LINE smoke findings

- Date: {{DATE}}
- Operator:
- Project: {{PROJECT_ID}}
- API URL: {{API_URL}}
- Customer URL: {{CUSTOMER_URL}}
- Root URL: {{ROOT_URL}}
- Booking token URL: {{BOOKING_TOKEN_URL}}
- Tenant key: {{TENANT_KEY}}
- Booking token: {{BOOKING_TOKEN}}
- Output file: {{OUTPUT_PATH}}

## Checklist

| Step | Expected | Observed | Status |
| --- | --- | --- | --- |
| Root URL | LIFF init -> login -> reservation create -> my reservations -> cancel | | |
| Booking token URL | LIFF init -> login -> reservation create -> my reservations -> cancel | | |
| Preflight | auth/config and both booking link resolve paths succeed | | |
| Log watch | relevant Cloud Run logs visible during the run | | |
| Recovery | `auth/session 401` x2 procedure is documented and repeatable | | |

## Notes

- Root URL:
- Booking token URL:
- Booking token resolve:
- Login path:
- Reservation create:
- My reservations:
- Cancel:

## Evidence

- Screenshots:
- Console notes:
- Backend log references:
- Follow-up items:
