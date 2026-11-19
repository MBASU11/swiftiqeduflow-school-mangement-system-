-- Kenyan education reference data: geographic counties, CBC/CBE grade stages,
-- school categories, assessment levels, pathways, and school-term templates.

create table public.kenya_counties (
  code text primary key check (code ~ '^[0-9]{3}$'),
  name text not null unique,
  ordinal smallint not null unique check (ordinal between 1 and 47)
);

insert into public.kenya_counties (code, name, ordinal) values
  ('001', 'Mombasa', 1),
  ('002', 'Kwale', 2),
  ('003', 'Kilifi', 3),
  ('004', 'Tana River', 4),
  ('005', 'Lamu', 5),
  ('006', 'Taita Taveta', 6),
  ('007', 'Garissa', 7),
  ('008', 'Wajir', 8),
  ('009', 'Mandera', 9),
  ('010', 'Marsabit', 10),
  ('011', 'Isiolo', 11),
  ('012', 'Meru', 12),
  ('013', 'Tharaka-Nithi', 13),
  ('014', 'Embu', 14),
  ('015', 'Kitui', 15),
  ('016', 'Machakos', 16),
  ('017', 'Makueni', 17),
  ('018', 'Nyandarua', 18),
  ('019', 'Nyeri', 19),
  ('020', 'Kirinyaga', 20),
  ('021', 'Murang''a', 21),
  ('022', 'Kiambu', 22),
  ('023', 'Turkana', 23),
  ('024', 'West Pokot', 24),
  ('025', 'Samburu', 25),
  ('026', 'Trans Nzoia', 26),
  ('027', 'Uasin Gishu', 27),
  ('028', 'Elgeyo-Marakwet', 28),
  ('029', 'Nandi', 29),
  ('030', 'Baringo', 30),
  ('031', 'Laikipia', 31),
  ('032', 'Nakuru', 32),
  ('033', 'Narok', 33),
  ('034', 'Kajiado', 34),
  ('035', 'Kericho', 35),
  ('036', 'Bomet', 36),
  ('037', 'Kakamega', 37),
  ('038', 'Vihiga', 38),
  ('039', 'Bungoma', 39),
  ('040', 'Busia', 40),
  ('041', 'Siaya', 41),
  ('042', 'Kisumu', 42),
  ('043', 'Homa Bay', 43),
  ('044', 'Migori', 44),
  ('045', 'Kisii', 45),
  ('046', 'Nyamira', 46),
  ('047', 'Nairobi City', 47);

create table public.kenya_school_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null unique,
  sort_order smallint not null unique,
  is_legacy boolean not null default false
);

insert into public.kenya_school_types (code, label, sort_order, is_legacy) values
  ('pre_primary', 'Pre-primary', 1, false),
  ('primary', 'Primary', 2, false),
  ('junior_school', 'Junior School', 3, false),
  ('senior_school', 'Senior School', 4, false),
  ('integrated', 'Integrated school', 5, false),
  ('special_needs', 'Special-needs school', 6, false),
  ('international', 'International school', 7, false),
  ('mixed', 'Mixed levels', 8, false),
  ('other', 'Other', 9, false),
  ('secondary', 'Secondary (legacy)', 10, true),
  ('high_school', 'High school (legacy)', 11, true);

create table public.kenya_education_stages (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null unique,
  sort_order smallint not null unique
);

insert into public.kenya_education_stages (code, label, sort_order) values
  ('pre_primary', 'Pre-primary', 1),
  ('primary', 'Primary', 2),
  ('junior_school', 'Junior School', 3),
  ('senior_school', 'Senior School', 4);

create table public.kenya_grade_levels (
  code text primary key check (code ~ '^(PP[12]|G([1-9]|1[0-2]))$'),
  label text not null unique,
  stage_code text not null references public.kenya_education_stages(code),
  sort_order smallint not null unique
);

insert into public.kenya_grade_levels (code, label, stage_code, sort_order) values
  ('PP1', 'Pre-Primary 1', 'pre_primary', 1),
  ('PP2', 'Pre-Primary 2', 'pre_primary', 2),
  ('G1', 'Grade 1', 'primary', 3),
  ('G2', 'Grade 2', 'primary', 4),
  ('G3', 'Grade 3', 'primary', 5),
  ('G4', 'Grade 4', 'primary', 6),
  ('G5', 'Grade 5', 'primary', 7),
  ('G6', 'Grade 6', 'primary', 8),
  ('G7', 'Grade 7', 'junior_school', 9),
  ('G8', 'Grade 8', 'junior_school', 10),
  ('G9', 'Grade 9', 'junior_school', 11),
  ('G10', 'Grade 10', 'senior_school', 12),
  ('G11', 'Grade 11', 'senior_school', 13),
  ('G12', 'Grade 12', 'senior_school', 14);

create table public.kenya_cbe_pathways (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null unique,
  description text not null,
  sort_order smallint not null unique
);

insert into public.kenya_cbe_pathways (code, label, description, sort_order) values
  ('stem', 'STEM', 'Science, Technology, Engineering and Mathematics', 1),
  ('social_sciences', 'Social Sciences', 'Social Sciences', 2),
  ('arts_sports_science', 'Arts and Sports Science', 'Arts and Sports Science', 3);

create table public.kenya_assessment_levels (
  code text primary key check (code in ('BE', 'AE', 'ME', 'EE')),
  label text not null unique,
  value smallint not null unique check (value between 1 and 4)
);

insert into public.kenya_assessment_levels (code, label, value) values
  ('BE', 'Below expectation', 1),
  ('AE', 'Approaching expectation', 2),
  ('ME', 'Meeting expectation', 3),
  ('EE', 'Exceeding expectation', 4);

create table public.kenya_term_templates (
  code text primary key check (code in ('term_1', 'term_2', 'term_3')),
  label text not null unique,
  sort_order smallint not null unique check (sort_order between 1 and 3)
);

insert into public.kenya_term_templates (code, label, sort_order) values
  ('term_1', 'Term 1', 1),
  ('term_2', 'Term 2', 2),
  ('term_3', 'Term 3', 3);

alter table public.schools
  add column county_code text references public.kenya_counties(code),
  add column school_type text references public.kenya_school_types(code);

update public.schools s
set county_code = nullif(profile.payload ->> 'countyCode', ''),
    school_type = nullif(profile.payload ->> 'type', '')
from public.school_records profile
where profile.school_id = s.id
  and profile.collection = 'school'
  and profile.record_id = 'the-school';

alter table public.kenya_counties enable row level security;
alter table public.kenya_school_types enable row level security;
alter table public.kenya_education_stages enable row level security;
alter table public.kenya_grade_levels enable row level security;
alter table public.kenya_cbe_pathways enable row level security;
alter table public.kenya_assessment_levels enable row level security;
alter table public.kenya_term_templates enable row level security;

create policy kenya_counties_read on public.kenya_counties
for select to anon, authenticated using (true);
create policy kenya_school_types_read on public.kenya_school_types
for select to anon, authenticated using (true);
create policy kenya_education_stages_read on public.kenya_education_stages
for select to anon, authenticated using (true);
create policy kenya_grade_levels_read on public.kenya_grade_levels
for select to anon, authenticated using (true);
create policy kenya_cbe_pathways_read on public.kenya_cbe_pathways
for select to anon, authenticated using (true);
create policy kenya_assessment_levels_read on public.kenya_assessment_levels
for select to anon, authenticated using (true);
create policy kenya_term_templates_read on public.kenya_term_templates
for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
revoke all on public.kenya_counties, public.kenya_school_types, public.kenya_education_stages,
  public.kenya_grade_levels, public.kenya_cbe_pathways, public.kenya_assessment_levels,
  public.kenya_term_templates from public, anon, authenticated;
grant select on public.kenya_counties, public.kenya_school_types, public.kenya_education_stages,
  public.kenya_grade_levels, public.kenya_cbe_pathways, public.kenya_assessment_levels,
  public.kenya_term_templates to anon, authenticated;

create or replace function public.complete_school_setup(records jsonb)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  entry jsonb;
  saved_count integer := 0;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required to complete setup.';
  end if;
  if jsonb_typeof(records) <> 'array' or jsonb_array_length(records) > 1000 then
    raise exception 'Setup records must be an array containing no more than 1,000 records.';
  end if;

  for entry in select value from jsonb_array_elements(records) loop
    if coalesce(entry ->> 'collection', '') !~ '^[a-zA-Z][a-zA-Z0-9_]{0,63}$'
       or nullif(trim(entry ->> 'record_id'), '') is null
       or jsonb_typeof(entry -> 'payload') <> 'object'
       or entry -> 'payload' ->> 'id' is distinct from entry ->> 'record_id' then
      raise exception 'A setup record has an invalid collection, ID, or payload.';
    end if;

    insert into public.school_records (school_id, collection, record_id, payload)
    values (school_key, entry ->> 'collection', entry ->> 'record_id', entry -> 'payload')
    on conflict (school_id, collection, record_id) do update
      set payload = excluded.payload, updated_at = now();
    saved_count := saved_count + 1;
  end loop;

  update public.schools s
  set county_code = nullif(profile.payload ->> 'countyCode', ''),
      school_type = nullif(profile.payload ->> 'type', '')
  from public.school_records profile
  where s.id = school_key
    and profile.school_id = school_key
    and profile.collection = 'school'
    and profile.record_id = 'the-school';

  return saved_count;
end;
$$;
