## Summary
- What changed:
- Why:

## Scope Labels (required)
- [ ] `backend`
- [ ] `admin`
- [ ] `customer`
- [ ] `infra`
- [ ] `docs`

## Validation
- [ ] `backend-v2`: `npm run lint && npm run typecheck && npm run test:ci`
- [ ] `admin-dashboard`: `npm run lint && npm run build`
- [ ] `landing-page`: `npm run lint && npm run build`
- [ ] DB migration added/updated if schema changed

## Release Impact
- [ ] Cloud Build substitutions reviewed
- [ ] Secret/credential changes reviewed (no plaintext secret in diff)
- [ ] Backward compatibility checked for public API changes
- [ ] Runbook/docs updated (`/Users/shotahorie/dev/github/shota-0712/reservation_system_practitioner/docs`)

## Smoke Plan
- [ ] `/health` returns 200
- [ ] `/ready` policy result is expected
- [ ] Admin `/register` and `/onboarding` render
- [ ] Customer app initializes with expected tenant/api config
