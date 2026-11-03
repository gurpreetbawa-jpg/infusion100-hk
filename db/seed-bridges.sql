-- Infusion 100 HK 2026 Final route — waypoints from COURSE_528434493.gpx
-- Ordered along the route: Discovery Bay → Mui Wo → Pui O → Shek Pik → Ngong Ping → Tai O → Tung Chung
DELETE FROM bridges;
INSERT INTO bridges (name, lat, lng, order_index, description, wpt_type) VALUES
  ('Start Meet Up',            22.296524, 114.017076, 1,  'Registration at 8, near McDonalds. We walk at 8:30. Toilets, 7-11 etc here.', 'INFO'),
  ('Toilets (Mui Wo)',         22.281410, 114.019187, 2,  'Behind this building.', 'TOILET'),
  ('Toilets',                  22.270739, 113.999202, 3,  NULL, 'TOILET'),
  ('6.5K — End',               22.264981, 114.001849, 4,  'Check out here, bye bye! 7-11 nearby, check out the village bakery. Last WC for a while.', 'MILE MARKER'),
  ('Toilet (village)',         22.241925, 113.993261, 5,  'Village toilet.', 'TOILET'),
  ('Toilets (near Pui O)',     22.243881, 113.978809, 6,  'If you are not stopping there is a toilet a short walk to the right.', 'TOILET'),
  ('13K — Pui O',              22.243195, 113.976666, 7,  'Thank you — 13K done! Shop nearby, Treasure Island beach for drinks and lunch. Pui O!', 'GENERAL DISTANCE'),
  ('Pre-Climb H₂O / WC',       22.226721, 113.904171, 8,  'If you feel tired, bail here. Water, supplies, and toilets available.', 'GENERIC'),
  ('Toilets (Ngong Ping)',     22.254557, 113.906404, 9,  'Nice toilets here.', 'TOILET'),
  ('30K — Big Buddha',         22.255047, 113.906040, 10, 'Get a selfie with the Buddha — well done! Shops may be closed after 18:00.', 'GENERAL DISTANCE'),
  ('Watch this turn',          22.250682, 113.891436, 11, NULL, 'GENERIC'),
  ('37K — Tai O',              22.252896, 113.862289, 12, 'WC & food here, snacks at shops.', 'GENERAL DISTANCE'),
  ('Watch the turn',           22.287905, 113.902763, 13, NULL, 'GENERIC'),
  ('50K — Finish (Tung Chung)', 22.288830, 113.940833, 14, 'You made it! Medals and supplies in the square. Drinks at Ola :)', 'GENERAL DISTANCE')
ON CONFLICT DO NOTHING;