-- Hong Kong Lantau Route checkpoints (Discovery Bay -> Tung Chung), West-to-East by order_index.
-- Note: the table is still named `bridges` for schema compatibility. Semantically these are
-- checkpoints along the Infusion 100 HK 2026 Lantau route.
DELETE FROM bridges;
INSERT INTO bridges (name, lat, lng, order_index) VALUES
  ('Discovery Bay (Start)',   22.296300, 114.016600, 1),
  ('Mui Wo Ferry Pier',       22.265300, 113.999400, 2),
  ('Pui O',                   22.241100, 113.979300, 3),
  ('Shek Pik Reservoir',      22.224700, 113.896300, 4),
  ('Ngong Ping (Big Buddha)', 22.254000, 113.905100, 5),
  ('Tai O Village',           22.254700, 113.857100, 6),
  ('Tung Chung MTR (Finish)', 22.289200, 113.941100, 7)
ON CONFLICT DO NOTHING;
