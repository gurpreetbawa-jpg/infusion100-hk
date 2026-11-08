-- Infusion 100 HK 2026 Final route - waypoints from COURSE_528434493.gpx
-- Columns: name, lat, lng, order_index, description, wpt_type, cumulative_km, est_minutes
-- est_minutes is a Naismith-style estimate: 4.5 km/h flat pace plus 1 hour per 500m of ascent.
-- Table is named bridges for schema compatibility; semantically these are route waypoints.
DELETE FROM bridges;
INSERT INTO bridges (name, lat, lng, order_index, description, wpt_type, cumulative_km, est_minutes) VALUES
  ('Start Meet Up', 22.296524, 114.017076, 1, 'Registration at 8, near McDonalds. We walk at 8:30. Toilets, 7-11 etc here.', 'INFO', 0.00, 0),
  ('Toilets', 22.281410, 114.019187, 2, 'Behind this building', 'TOILET', 2.59, 46),
  ('Toilets', 22.270739, 113.999202, 3, NULL, 'TOILET', 5.50, 103),
  ('6.5K - End', 22.264981, 114.001849, 4, 'Please check out, bye bye! There is a 7-11, check out the village bakery. Last chance of WC for a while.', 'MILE MARKER', 6.44, 116),
  ('Toilet', 22.241925, 113.993261, 5, 'Village toilet', 'TOILET', 10.92, 182),
  ('13K - Pui O', 22.242945, 113.976647, 6, '13K point, and a shop here for supplies.', 'MILE MARKER', 13.65, 226),
  ('Toilet', 22.243366, 113.976004, 7, NULL, 'TOILET', 13.88, 230),
  ('Pre-Climb H2O / WC', 22.226721, 113.904171, 8, 'If you feel tired, suggest you do not go on and bail here. Water/supplies and toilets here.', 'GENERIC', 24.21, 389),
  ('Toilet', 22.254557, 113.906404, 9, 'Nice toilets here', 'TOILET', 30.05, 513),
  ('30K - Big Buddha', 22.255047, 113.906040, 10, 'Get a selfie with the Buddha, well done! Shops may be closed after 18:00.', 'GENERAL DISTANCE', 30.12, 514),
  ('Watch this turn', 22.250682, 113.891436, 11, NULL, 'GENERIC', 32.27, 543),
  ('37K - Tai O', 22.252896, 113.862289, 12, 'WC, free water, food here and snacks at shops.', 'GENERAL DISTANCE', 37.11, 609),
  ('toilet', 22.279357, 113.892166, 13, 'Public toilet', 'TOILET', 42.80, 699),
  ('Watch the turn', 22.287905, 113.902763, 14, NULL, 'GENERIC', 44.57, 725),
  ('50K - Finish (Tung Chung)', 22.288830, 113.940833, 15, 'We will have medals and supplies in the square, maybe some drinks in Ola :)', 'GENERAL DISTANCE', 50.89, 821)
ON CONFLICT DO NOTHING;
