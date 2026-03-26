# DB V3 ER図（Cloud SQL OLTP）

この ER 図は v3-clean schema の主要業務テーブルと主要依存を示す overview である。全 28 tables の網羅表ではなく、exhaustive feature/table coverage と検証ステータスは `docs/architecture/DB_V3_CAPABILITY_MATRIX.md` を正本とする。

```mermaid
erDiagram
    TENANTS ||--o{ STORES : operates
    TENANTS ||--o{ ADMINS : hires
    TENANTS ||--o{ CUSTOMERS : serves
    TENANTS ||--o{ PRACTITIONERS : staffs
    TENANTS ||--o{ MENUS : offers
    TENANTS ||--o{ MENU_OPTIONS : sells
    TENANTS ||--o{ RESERVATIONS : schedules
    TENANTS ||--o{ EXPORT_JOBS : requests
    TENANTS ||--o{ BOOKING_LINK_TOKENS : publishes
    TENANTS ||--o{ SETTINGS : configures
    TENANTS ||--o{ TENANT_RFM_SETTINGS : scores
    TENANTS ||--o{ TENANT_NOTIFICATION_SETTINGS : notifies

    STORES ||--o{ RESERVATIONS : hosts
    STORES ||--o{ SETTINGS : owns

    CUSTOMERS ||--o{ RESERVATIONS : books
    PRACTITIONERS ||--o{ RESERVATIONS : handles

    RESERVATIONS ||--o{ RESERVATION_MENUS : contains
    MENUS ||--o{ RESERVATION_MENUS : referenced

    RESERVATIONS ||--o{ RESERVATION_OPTIONS : contains
    MENU_OPTIONS ||--o{ RESERVATION_OPTIONS : referenced

    PRACTITIONERS ||--o{ PRACTITIONER_STORE_ASSIGNMENTS : assigned
    STORES ||--o{ PRACTITIONER_STORE_ASSIGNMENTS : assigned

    MENUS ||--o{ MENU_PRACTITIONER_ASSIGNMENTS : assigned
    PRACTITIONERS ||--o{ MENU_PRACTITIONER_ASSIGNMENTS : assigned

    MENU_OPTIONS ||--o{ OPTION_MENU_ASSIGNMENTS : assigned
    MENUS ||--o{ OPTION_MENU_ASSIGNMENTS : assigned

    ADMINS ||--o{ ADMIN_STORE_ASSIGNMENTS : assigned
    STORES ||--o{ ADMIN_STORE_ASSIGNMENTS : assigned

    BOOKING_LINK_TOKENS ||--|| STORES : resolves
    BOOKING_LINK_TOKENS ||--|| PRACTITIONERS : requires
    BOOKING_LINK_TOKENS ||--|| TENANTS : scoped

    SETTINGS ||--|| STORES : scoped
    SETTINGS ||--|| TENANTS : scoped

    EXPORT_JOBS ||--|| STORES : from
    EXPORT_JOBS ||--|| TENANTS : scoped

    TENANT_RFM_SETTINGS ||--|| TENANTS : extends
    TENANT_NOTIFICATION_SETTINGS ||--|| TENANTS : extends

    TENANTS {
      uuid id PK
      varchar slug UK
      varchar name
      varchar plan
      varchar status
      varchar onboarding_status
    }

    STORES {
      uuid id PK
      uuid tenant_id FK
      varchar store_code UK
      varchar name
      varchar timezone
      varchar status
    }

    ADMINS {
      uuid id PK
      uuid tenant_id FK
      varchar firebase_uid UK
      varchar email
      varchar role
      boolean is_active
    }

    CUSTOMERS {
      uuid id PK
      uuid tenant_id FK
      varchar name
      varchar phone
      varchar email
      varchar rfm_segment
      boolean is_active
    }

    PRACTITIONERS {
      uuid id PK
      uuid tenant_id FK
      varchar name
      varchar role
      integer nomination_fee
      boolean is_active
    }

    MENUS {
      uuid id PK
      uuid tenant_id FK
      varchar name
      varchar category
      integer duration
      integer price
      boolean is_active
    }

    MENU_OPTIONS {
      uuid id PK
      uuid tenant_id FK
      varchar name
      integer duration
      integer price
      boolean is_active
    }

    RESERVATIONS {
      uuid id PK
      uuid tenant_id FK
      uuid store_id FK
      uuid practitioner_id FK
      uuid customer_id FK
      timestamptz starts_at
      timestamptz ends_at
      varchar timezone
      varchar status
      varchar source
      integer total_price
      integer total_duration
    }

    RESERVATION_MENUS {
      uuid id PK
      uuid tenant_id FK
      uuid reservation_id FK
      uuid menu_id FK
      varchar menu_name
      integer menu_price
      integer menu_duration
    }

    RESERVATION_OPTIONS {
      uuid id PK
      uuid tenant_id FK
      uuid reservation_id FK
      uuid option_id FK
      varchar option_name
      integer option_price
    }

    PRACTITIONER_STORE_ASSIGNMENTS {
      uuid tenant_id PK
      uuid practitioner_id PK
      uuid store_id PK
    }

    MENU_PRACTITIONER_ASSIGNMENTS {
      uuid tenant_id PK
      uuid menu_id PK
      uuid practitioner_id PK
    }

    OPTION_MENU_ASSIGNMENTS {
      uuid tenant_id PK
      uuid option_id PK
      uuid menu_id PK
    }

    ADMIN_STORE_ASSIGNMENTS {
      uuid tenant_id PK
      uuid admin_id PK
      uuid store_id PK
    }

    BOOKING_LINK_TOKENS {
      uuid id PK
      uuid tenant_id FK
      uuid store_id FK
      uuid practitioner_id FK
      varchar token
    }

    SETTINGS {
      uuid id PK
      uuid tenant_id FK
      uuid store_id FK
      varchar shop_name
      jsonb message_templates
    }

    TENANT_RFM_SETTINGS {
      uuid id PK
      uuid tenant_id FK
      integer recency_score5
      integer frequency_score5
      integer monetary_score5
    }

    TENANT_NOTIFICATION_SETTINGS {
      uuid id PK
      uuid tenant_id FK
      boolean email_new_reservation
      boolean line_reminder
      boolean push_new_reservation
    }

    EXPORT_JOBS {
      uuid id PK
      uuid tenant_id FK
      uuid store_id FK
      varchar export_type
      varchar status
      varchar storage_type
    }
```

図に含まれるすべての FK/assignment は `DB_V3_SCHEMA_DEFINITION.md` で定義された tenant-safe FK 方針に従っている。
