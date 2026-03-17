-- CRM-BE-005: 旧RFMセグメント値を新体系へ正規化
-- 旧: vip / loyal / new / dormant / lost
-- 新: champion / loyal / new / atRisk / hibernating
--
-- 対応:
--   vip     → champion
--   dormant → atRisk
--   lost    → hibernating
--   loyal / new はそのまま（値が一致）
BEGIN;

UPDATE customers
SET rfm_segment = 'champion',
    updated_at  = NOW()
WHERE rfm_segment = 'vip';

UPDATE customers
SET rfm_segment = 'atRisk',
    updated_at  = NOW()
WHERE rfm_segment = 'dormant';

UPDATE customers
SET rfm_segment = 'hibernating',
    updated_at  = NOW()
WHERE rfm_segment = 'lost';

COMMIT;
