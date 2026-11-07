insert into public.giving_projects(id,name,goal_cents) values
('screen','LED Screen Main',2300000),
('montage','Yamaha Montage M8x · 88 Keys',750000),
('modx','Yamaha MODX M7 · 76 Keys',310000),
('sony-fx2','Sony FX2',400000),
('sony-fx30','Sony FX30',250000),
('canon-r6','Canon EOS R6 Mark II Body',350000),
('sigma-24-70','Sigma 24–70mm f/2.8',200000),
('sigma-70-200','Sigma 70–200mm f/2.8',250000),
('monitors','Monitors for Production Room',100000),
('rug','Stage Rug',150000),
('security','Security Camera',90000),
('water','Water Dispenser',40000)
on conflict(id) do update set name=excluded.name,goal_cents=excluded.goal_cents;
