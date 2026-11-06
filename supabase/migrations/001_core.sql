-- TeraFi Clinic · migración 001: clínica, usuarios con roles, pacientes, notas SOAP, adendas y auditoría
create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid not null references clinics(id),
  full_name text not null,
  role text not null check (role in ('admin','fisio','recepcion')),
  cedula text,
  active boolean not null default true
);

create function my_role() returns text language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;
create function my_clinic() returns uuid language sql stable security definer set search_path = public as
$$ select clinic_id from profiles where id = auth.uid() and active $$;

create table patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default my_clinic() references clinics(id),
  file_no bigint generated always as identity unique,
  first_name text not null, last_name1 text not null, last_name2 text,
  birth_date date, sex text check (sex in ('femenino','masculino','otro')),
  phone text, email text, emergency_contact text, emergency_relation text,
  status text not null default 'primera_valoracion'
    check (status in ('primera_valoracion','en_tratamiento','en_seguimiento','alta','suspendido','abandono')),
  admitted_on date not null default current_date,
  assigned_to uuid references profiles(id),
  created_by uuid not null default auth.uid() references profiles(id),
  created_at timestamptz not null default now()
);
create index on patients (clinic_id, created_at desc);

create table evolution_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default my_clinic() references clinics(id),
  patient_id uuid not null references patients(id) on delete restrict,
  session_no int not null,
  author_id uuid not null default auth.uid() references profiles(id),
  s text not null default '', o text not null default '', a text not null default '', p text not null default '',
  eva smallint check (eva between 0 and 10),
  status text not null default 'draft' check (status in ('draft','final')),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, session_no)
);

create table note_addenda (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references evolution_notes(id) on delete restrict,
  author_id uuid not null default auth.uid() references profiles(id),
  reason text not null check (length(trim(reason)) > 0),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

-- Auditoría: solo ids y acción, nunca contenido clínico
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid, table_name text not null, row_id text, action text not null
);

create function set_session_no() returns trigger language plpgsql as $$
begin
  select coalesce(max(session_no), 0) + 1 into new.session_no from evolution_notes where patient_id = new.patient_id;
  return new;
end $$;
create trigger t_session_no before insert on evolution_notes for each row execute function set_session_no();

-- Una nota finalizada no se edita ni se borra; se corrige con adenda
create function guard_note() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'final' then raise exception 'Nota finalizada: no se puede eliminar'; end if;
    return old;
  end if;
  if old.status = 'final' then raise exception 'Nota finalizada: registre una adenda'; end if;
  if new.patient_id <> old.patient_id or new.author_id <> old.author_id or new.session_no <> old.session_no then
    raise exception 'Paciente, autor y sesión no se pueden cambiar';
  end if;
  if new.status = 'final' then new.finalized_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger t_guard before update or delete on evolution_notes for each row execute function guard_note();

create function audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (user_id, table_name, row_id, action)
  values (auth.uid(), tg_table_name, (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id', tg_op);
  return null;
end $$;
create trigger a_patients after insert or update or delete on patients for each row execute function audit();
create trigger a_notes after insert or update or delete on evolution_notes for each row execute function audit();
create trigger a_addenda after insert or update or delete on note_addenda for each row execute function audit();

-- Seguridad a nivel de fila
alter table clinics enable row level security;
alter table profiles enable row level security;
alter table patients enable row level security;
alter table evolution_notes enable row level security;
alter table note_addenda enable row level security;
alter table audit_log enable row level security;
revoke all on all tables in schema public from anon;
revoke insert, update, delete on audit_log from authenticated;

create policy clinics_read on clinics for select using (id = my_clinic());
create policy profiles_read on profiles for select using (clinic_id = my_clinic());
create policy profiles_admin on profiles for all
  using (my_role() = 'admin' and clinic_id = my_clinic()) with check (my_role() = 'admin' and clinic_id = my_clinic());

-- Pacientes: datos administrativos (recepción incluida). Sin DELETE: los expedientes se conservan.
create policy patients_read on patients for select using (clinic_id = my_clinic() and my_role() in ('admin','fisio','recepcion'));
create policy patients_ins on patients for insert
  with check (clinic_id = my_clinic() and my_role() in ('admin','fisio','recepcion') and created_by = auth.uid());
create policy patients_upd on patients for update
  using (clinic_id = my_clinic() and my_role() in ('admin','fisio','recepcion')) with check (clinic_id = my_clinic());

-- Notas clínicas: recepción no tiene acceso
create policy notes_read on evolution_notes for select using (clinic_id = my_clinic() and my_role() in ('admin','fisio'));
create policy notes_ins on evolution_notes for insert
  with check (clinic_id = my_clinic() and my_role() in ('admin','fisio') and author_id = auth.uid() and status = 'draft');
create policy notes_upd on evolution_notes for update
  using (author_id = auth.uid() and status = 'draft' and my_role() in ('admin','fisio')) with check (author_id = auth.uid());
create policy notes_del on evolution_notes for delete using (author_id = auth.uid() and status = 'draft');

create policy addenda_read on note_addenda for select
  using (my_role() in ('admin','fisio') and exists (select 1 from evolution_notes n where n.id = note_id and n.clinic_id = my_clinic()));
create policy addenda_ins on note_addenda for insert
  with check (author_id = auth.uid() and my_role() in ('admin','fisio')
    and exists (select 1 from evolution_notes n where n.id = note_id and n.clinic_id = my_clinic() and n.status = 'final'));

create policy audit_read on audit_log for select using (my_role() = 'admin');
