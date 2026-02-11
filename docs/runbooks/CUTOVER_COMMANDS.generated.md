# Cutover Command Sheet

- Generated: 2026-02-09 20:12:56 UTC
- Project: `keyexpress-reserve`
- Region: `asia-northeast1`

## 1) Export Variables

```bash
export PROJECT_ID=keyexpress-reserve
export REGION=asia-northeast1
export API_SERVICE=reserve-api
export ADMIN_SERVICE=reserve-admin
export CUSTOMER_SERVICE=reserve-customer
export LANDING_SERVICE=reserve-landing
export JOB_LOCATION=asia-northeast1
```

## 2) Preflight

```bash
gcloud config set project ${PROJECT_ID}
gcloud auth list
gcloud run services describe ${API_SERVICE} --region ${REGION}
gcloud run services describe ${ADMIN_SERVICE} --region ${REGION}
gcloud run services describe ${CUSTOMER_SERVICE} --region ${REGION}
```

## 3) Freeze Writes + Pause Scheduler

```bash
gcloud run services update ${API_SERVICE} \
  --project ${PROJECT_ID} \
  --region ${REGION} \
  --update-env-vars=WRITE_FREEZE_MODE=true
```

```bash
gcloud scheduler jobs pause reminder-day-before --project ${PROJECT_ID} --location ${JOB_LOCATION}
gcloud scheduler jobs pause reminder-same-day --project ${PROJECT_ID} --location ${JOB_LOCATION}
gcloud scheduler jobs pause daily-analytics --project ${PROJECT_ID} --location ${JOB_LOCATION}
gcloud scheduler jobs pause google-calendar-sync --project ${PROJECT_ID} --location ${JOB_LOCATION}
```

## 4) Deploy (Freeze On)

```bash
gcloud builds submit . --config=cloudbuild.yaml \
  --substitutions=_NEXT_PUBLIC_API_URL=https://reserve-api-486894262412.asia-northeast1.run.app,\
_CUSTOMER_API_URL=https://reserve-api-486894262412.asia-northeast1.run.app,\
_CUSTOMER_TENANT_KEY=default,\
_NEXT_PUBLIC_TENANT_ID=default,\
_NEXT_PUBLIC_ADMIN_URL=https://reserve-admin-486894262412.asia-northeast1.run.app,\
_NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyDlgWGNiYP50yBRlFaWUdQg4NFSsHGx_Ro,\
_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=keyexpress-reserve.firebaseapp.com,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=keyexpress-reserve,\
_CLOUDSQL_CONNECTION=keyexpress-reserve:asia-northeast1:reservation-system-db,\
_RUN_INTEGRATION=true,\
_RUN_MIGRATIONS=true,\
_WRITE_FREEZE_MODE=true,\
_CLOUDSQL_INSTANCE=reservation-system-db,\
_DB_USER=app_user,\
_DB_NAME=reservation_system
```

## 5) Smoke / Ready Checks

```bash
curl -sS https://reserve-api-486894262412.asia-northeast1.run.app/health
curl -sS https://reserve-api-486894262412.asia-northeast1.run.app/ready
```

## 6) Unfreeze + Resume Scheduler

```bash
gcloud run services update ${API_SERVICE} \
  --project ${PROJECT_ID} \
  --region ${REGION} \
  --update-env-vars=WRITE_FREEZE_MODE=false
```

```bash
gcloud scheduler jobs resume reminder-day-before --project ${PROJECT_ID} --location ${JOB_LOCATION}
gcloud scheduler jobs resume reminder-same-day --project ${PROJECT_ID} --location ${JOB_LOCATION}
gcloud scheduler jobs resume daily-analytics --project ${PROJECT_ID} --location ${JOB_LOCATION}
gcloud scheduler jobs resume google-calendar-sync --project ${PROJECT_ID} --location ${JOB_LOCATION}
```

## 7) Rollback

Dry-run:
```bash
PROJECT_ID=${PROJECT_ID} REGION=${REGION} API_SERVICE=${API_SERVICE} ADMIN_SERVICE=${ADMIN_SERVICE} CUSTOMER_SERVICE=${CUSTOMER_SERVICE} JOB_LOCATION=${JOB_LOCATION} JOB_NAMES=reminder-day-before,reminder-same-day,daily-analytics,google-calendar-sync ./scripts/rollback_cutover.sh --resume-jobs
```

Apply:
```bash
PROJECT_ID=${PROJECT_ID} REGION=${REGION} API_SERVICE=${API_SERVICE} ADMIN_SERVICE=${ADMIN_SERVICE} CUSTOMER_SERVICE=${CUSTOMER_SERVICE} JOB_LOCATION=${JOB_LOCATION} JOB_NAMES=reminder-day-before,reminder-same-day,daily-analytics,google-calendar-sync ./scripts/rollback_cutover.sh --apply --resume-jobs
```

## 8) Decommission Legacy Backend

Dry-run:
```bash
PROJECT_ID=${PROJECT_ID} REGION=${REGION} OLD_BACKEND_SERVICE=reserve-api-legacy OLD_BACKEND_DOMAINS= OLD_BACKEND_SECRET_NAMES= OLD_BACKEND_SERVICE_ACCOUNT= ./scripts/decommission_old_backend.sh
```

Apply:
```bash
PROJECT_ID=${PROJECT_ID} REGION=${REGION} OLD_BACKEND_SERVICE=reserve-api-legacy OLD_BACKEND_DOMAINS= OLD_BACKEND_SECRET_NAMES= OLD_BACKEND_SERVICE_ACCOUNT= ./scripts/decommission_old_backend.sh --apply
```
