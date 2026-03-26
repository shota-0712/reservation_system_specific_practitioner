# DB V3 スキーマ依存 DAG（Mermaid graph TD）

```mermaid
graph TD
    TENANTS((tenants))
    STORES((stores))
    ADMINS((admins))
    CUSTOMERS((customers))
    PRACTITIONERS((practitioners))
    MENUS((menus))
    MENU_OPTIONS((menu_options))
    RESERVATIONS((reservations))
    RESERVATION_MENUS((reservation_menus))
    RESERVATION_OPTIONS((reservation_options))
    BOOKING_LINK_TOKENS((booking_link_tokens))
    SETTINGS((settings))
    EXPORT_JOBS((export_jobs))
    TENANT_RFM_SETTINGS((tenant_rfm_settings))
    TENANT_NOTIFICATION_SETTINGS((tenant_notification_settings))
    PRACTITIONER_STORE_ASSIGNMENTS((practitioner_store_assignments))
    MENU_PRACTITIONER_ASSIGNMENTS((menu_practitioner_assignments))
    OPTION_MENU_ASSIGNMENTS((option_menu_assignments))
    ADMIN_STORE_ASSIGNMENTS((admin_store_assignments))
    LEGACY_ARRAYS(["legacy arrays\n(practitioners.store_ids,\nmenus.practitioner_ids,\nmenu_options.applicable_menu_ids,\nadmins.store_ids)"])

    TENANTS -->|owns| STORES
    TENANTS -->|owns| ADMINS
    TENANTS -->|owns| CUSTOMERS
    TENANTS -->|owns| PRACTITIONERS
    TENANTS -->|owns| MENUS
    TENANTS -->|owns| MENU_OPTIONS
    TENANTS -->|owns| BOOKING_LINK_TOKENS
    TENANTS -->|owns| SETTINGS
    TENANTS -->|owns| EXPORT_JOBS
    TENANTS -->|extends| TENANT_RFM_SETTINGS
    TENANTS -->|extends| TENANT_NOTIFICATION_SETTINGS

    STORES -->|hosts| RESERVATIONS
    STORES -->|configures| SETTINGS

    PRACTITIONERS -->|handles| RESERVATIONS
    MENUS --> RESERVATION_MENUS
    MENU_OPTIONS --> RESERVATION_OPTIONS
    RESERVATIONS --> RESERVATION_MENUS
    RESERVATIONS --> RESERVATION_OPTIONS

    PRACTITIONERS --> PRACTITIONER_STORE_ASSIGNMENTS
    STORES --> PRACTITIONER_STORE_ASSIGNMENTS
    MENUS --> MENU_PRACTITIONER_ASSIGNMENTS
    PRACTITIONERS --> MENU_PRACTITIONER_ASSIGNMENTS
    MENU_OPTIONS --> OPTION_MENU_ASSIGNMENTS
    MENUS --> OPTION_MENU_ASSIGNMENTS
    ADMINS --> ADMIN_STORE_ASSIGNMENTS
    STORES --> ADMIN_STORE_ASSIGNMENTS

    BOOKING_LINK_TOKENS --> STORES
    BOOKING_LINK_TOKENS --> PRACTITIONERS

    LEGACY_ARRAYS --> PRACTITIONER_STORE_ASSIGNMENTS
    LEGACY_ARRAYS --> MENU_PRACTITIONER_ASSIGNMENTS
    LEGACY_ARRAYS --> OPTION_MENU_ASSIGNMENTS
    LEGACY_ARRAYS --> ADMIN_STORE_ASSIGNMENTS

    EXPORT_JOBS --> STORES
    SETTINGS --> STORES
```

この DAG は core masters → transactional → extension/integration に向かう主要依存方向を示し、legacy arrays から assignment テーブルへの cleanup 境界（`LEGACY_ARRAYS`）を注記している。全 table inventory と検証ステータスは `DB_V3_CAPABILITY_MATRIX.md` を正本とする。
