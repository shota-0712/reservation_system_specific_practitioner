# DB V3 スキーマ領域図（Mermaid flowchart）

この図は主要なスキーマ領域をドメインごとに俯瞰する overview であり、全 table inventory の網羅表ではない。exhaustive coverage と verification status は `docs/architecture/DB_V3_CAPABILITY_MATRIX.md` を参照する。

```mermaid
flowchart LR
    subgraph "Tenant/Auth"
        TENANTS((tenants))
        ADMINS((admins))
        SETTINGS((settings))
    end
    subgraph "Catalog/Staff"
        STORES((stores))
        PRACTITIONERS((practitioners))
        MENUS((menus))
        MENU_OPTIONS((menu_options))
        PRACTITIONER_ASSIGNMENTS((practitioner_store_assignments))
        MENU_ASSIGNMENTS((menu_practitioner_assignments))
        OPTION_ASSIGNMENTS((option_menu_assignments))
        ADMIN_ASSIGNMENTS((admin_store_assignments))
    end
    subgraph Booking
        RESERVATIONS((reservations))
        RESERVATION_MENUS((reservation_menus))
        RESERVATION_OPTIONS((reservation_options))
    end
    subgraph CRM
        CUSTOMERS((customers))
        TENANT_RFM_SETTINGS((tenant_rfm_settings))
        TENANT_NOTIFICATION_SETTINGS((tenant_notification_settings))
    end
    subgraph Integrations
        BOOKING_LINK_TOKENS((booking_link_tokens))
    end
    subgraph "Exports/Notifications"
        EXPORT_JOBS((export_jobs))
    end

    TENANTS --> STORES
    TENANTS --> ADMINS
    TENANTS --> CUSTOMERS
    TENANTS --> TENANT_RFM_SETTINGS
    TENANTS --> TENANT_NOTIFICATION_SETTINGS
    TENANTS --> EXPORT_JOBS

    STORES --> RESERVATIONS
    STORES --> SETTINGS

    PRACTITIONERS --> RESERVATIONS
    MENUS --> RESERVATION_MENUS
    MENU_OPTIONS --> RESERVATION_OPTIONS

    PRACTITIONER_ASSIGNMENTS --> PRACTITIONERS
    PRACTITIONER_ASSIGNMENTS --> STORES
    MENU_ASSIGNMENTS --> MENUS
    MENU_ASSIGNMENTS --> PRACTITIONERS
    OPTION_ASSIGNMENTS --> MENU_OPTIONS
    OPTION_ASSIGNMENTS --> MENUS
    ADMIN_ASSIGNMENTS --> ADMINS
    ADMIN_ASSIGNMENTS --> STORES

    RESERVATIONS --> RESERVATION_MENUS
    RESERVATIONS --> RESERVATION_OPTIONS

    BOOKING_LINK_TOKENS --> STORES
    BOOKING_LINK_TOKENS --> PRACTITIONERS
    BOOKING_LINK_TOKENS --> TENANTS

    EXPORT_JOBS --> STORES

    SETTINGS --> STORES
    SETTINGS --> TENANTS
```

クラスタは実装側でも使われる論理領域 `Tenant/Auth`, `Catalog/Staff`, `Booking`, `CRM`, `Integrations`, `Exports/Notifications` を反映し、各ドメインがどのマスター/トランザクションを抱えるかを示している。網羅確認は capability matrix を正本とする。
