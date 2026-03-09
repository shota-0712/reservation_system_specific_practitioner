# DB V3 ER図（Cloud SQL OLTP）

`Cloud SQL(PostgreSQL)` 側の正規化スキーマ（V3）の中核だけを示した ER 図です。
分析系は `BigQuery raw/mart` に分離し、この図には含めません。

**注記**: CRM拡張テーブル（`tenant_rfm_settings`, `tenant_notification_settings`）と
SECURITY DEFINER 関数（`resolve_active_store_context`, `resolve_booking_link_token`）は
この図に含めていません。正本は migration ファイルを参照してください。

詳細なスキーマ定義（制約/RLS/FK 方針 / CRM拡張）は以下を参照:

- `docs/architecture/DB_V3_SCHEMA_DEFINITION.md`

```mermaid
erDiagram
    TENANTS ||--o{ STORES : has
    TENANTS ||--o{ ADMINS : has
    TENANTS ||--o{ CUSTOMERS : has
    TENANTS ||--o{ PRACTITIONERS : has
    TENANTS ||--o{ MENUS : has
    TENANTS ||--o{ MENU_OPTIONS : has
    TENANTS ||--o{ RESERVATIONS : has
    TENANTS ||--o{ EXPORT_JOBS : has

    STORES ||--o{ RESERVATIONS : serves
    CUSTOMERS ||--o{ RESERVATIONS : books
    PRACTITIONERS ||--o{ RESERVATIONS : handles

    RESERVATIONS ||--o{ RESERVATION_MENUS : includes
    MENUS ||--o{ RESERVATION_MENUS : referenced

    RESERVATIONS ||--o{ RESERVATION_OPTIONS : includes
    MENU_OPTIONS ||--o{ RESERVATION_OPTIONS : referenced

    PRACTITIONERS ||--o{ PRACTITIONER_STORE_ASSIGNMENTS : assigned
    STORES ||--o{ PRACTITIONER_STORE_ASSIGNMENTS : assigned

    MENUS ||--o{ MENU_PRACTITIONER_ASSIGNMENTS : assigned
    PRACTITIONERS ||--o{ MENU_PRACTITIONER_ASSIGNMENTS : assigned

    MENU_OPTIONS ||--o{ OPTION_MENU_ASSIGNMENTS : assigned
    MENUS ||--o{ OPTION_MENU_ASSIGNMENTS : assigned

    ADMINS ||--o{ ADMIN_STORE_ASSIGNMENTS : assigned
    STORES ||--o{ ADMIN_STORE_ASSIGNMENTS : assigned

    TENANTS {
      uuid id PK
      varchar slug UK
      varchar name
      varchar status
    }

    STORES {
      uuid id PK
      uuid tenant_id FK
      varchar store_code UK
      varchar name
      varchar status
    }

    CUSTOMERS {
      uuid id PK
      uuid tenant_id FK
      varchar name
      varchar phone
      boolean is_active
    }

    PRACTITIONERS {
      uuid id PK
      uuid tenant_id FK
      varchar name
      boolean is_active
    }

    MENUS {
      uuid id PK
      uuid tenant_id FK
      varchar name
      numeric price
      boolean is_active
    }

    MENU_OPTIONS {
      uuid id PK
      uuid tenant_id FK
      varchar name
      numeric price
      boolean is_active
    }

    RESERVATIONS {
      uuid id PK
      uuid tenant_id FK
      uuid store_id FK
      uuid customer_id FK
      uuid practitioner_id FK
      timestamptz starts_at
      timestamptz ends_at
      varchar timezone
      varchar status
    }

    RESERVATION_MENUS {
      uuid id PK
      uuid tenant_id FK
      uuid reservation_id FK
      uuid menu_id FK
      int quantity
      numeric menu_price
    }

    RESERVATION_OPTIONS {
      uuid id PK
      uuid tenant_id FK
      uuid reservation_id FK
      uuid option_id FK
      int quantity
      numeric option_price
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

    EXPORT_JOBS {
      uuid id PK
      uuid tenant_id FK
      uuid store_id FK
      varchar export_type
      varchar status
      varchar storage_type
      text gcs_object_path
    }
```

## 制約ポリシー（100点品質の要点）
- 親テーブルは複合FK前提で `UNIQUE (tenant_id, id)` を持つ。
- 参照は原則 `FOREIGN KEY (tenant_id, xxx_id) -> parent(tenant_id, id)`。
- `reservations` は `CHECK (starts_at < ends_at)` と `EXCLUDE ... WHERE status NOT IN ('canceled', 'no_show')` を適用。
- 予約ステータス遷移は固定し、`canceled/no_show` になったときのみ同時間帯の再予約を許可する。
- RLS は `ENABLE + FORCE` を適用し、`app_user` は `NOBYPASSRLS` 前提。
- テナントコンテキストはアプリの全Repositoryでトランザクション内 `SET LOCAL app.current_tenant = ...` を必須にする。
- 多対多は配列ではなく assignment テーブルで表現する。
