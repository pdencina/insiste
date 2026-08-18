-- Insiste — esquema inicial
-- Uso personal: aislamiento por usuario (auth.uid()) con RLS.

create extension if not exists "pgcrypto";

-- ============================================================
-- CUENTA DE GOOGLE
-- ============================================================

create table cuentas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  refresh_token_cifrado bytea not null,
  access_token text,
  access_expira_en timestamptz,
  estado text not null default 'activa'
    check (estado in ('activa','revocada','error')),
  envio_habilitado boolean not null default false,   -- arranca apagado
  creado_en timestamptz not null default now(),
  unique (user_id, email)
);

-- ============================================================
-- REGLAS
-- ============================================================

create table reglas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  cadencia_dias int[] not null default '{1,3,7,12}',
  hora_inicio time not null default '08:00',
  hora_fin time not null default '19:00',
  solo_dias_habiles boolean not null default true,
  solo_borradores boolean not null default true,      -- arranca en seguro
  acuse_automatico boolean not null default true,
  tope_semanal_destinatario int not null default 3,
  umbral_confianza numeric(3,2) not null default 0.75,
  actualizado_en timestamptz not null default now()
);

-- ============================================================
-- SEGUIMIENTOS
-- ============================================================

create table seguimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cuenta_id uuid not null references cuentas(id) on delete cascade,
  thread_id text not null,
  asunto text not null,
  destinatarios text[] not null,
  objetivo text,                                       -- qué se está esperando
  estado text not null default 'activo'
    check (estado in ('activo','pausado','cerrado','agotado')),
  motivo_cierre text
    check (motivo_cierre in ('entregado','rechazo','rebote','manual','agotado')),
  motivo_pausa text,
  intentos int not null default 0,
  ultimo_envio_propio timestamptz not null,
  ultimo_message_id text not null,
  referencias text,                                    -- cadena References acumulada
  proximo_intento timestamptz,
  mensajes_vistos int not null default 1,
  creado_en timestamptz not null default now(),
  unique (user_id, thread_id)
);

create index on seguimientos(user_id, estado, proximo_intento);
create index on seguimientos(user_id, estado);

-- ============================================================
-- MENSAJES Y CLASIFICACIONES
-- ============================================================

create table mensajes_hilo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seguimiento_id uuid not null references seguimientos(id) on delete cascade,
  gmail_message_id text not null,
  rfc_message_id text,
  direccion text not null check (direccion in ('propio','contraparte')),
  remitente text,
  extracto text,                                       -- solo un extracto acotado
  tiene_adjuntos boolean not null default false,
  recibido_en timestamptz not null,
  unique (seguimiento_id, gmail_message_id)
);

create table clasificaciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seguimiento_id uuid not null references seguimientos(id) on delete cascade,
  mensaje_id uuid not null references mensajes_hilo(id) on delete cascade,
  clase text not null
    check (clase in ('entregado','promesa','pregunta','rechazo',
                     'irrelevante','automatico','rebote')),
  confianza numeric(3,2),
  razon text,
  fecha_prometida date,
  por_headers boolean not null default false,          -- true = sin llamar al modelo
  modelo text,
  creado_en timestamptz not null default now()
);

create index on clasificaciones(seguimiento_id, creado_en desc);

-- ============================================================
-- ENVÍOS
-- ============================================================

create table envios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seguimiento_id uuid not null references seguimientos(id) on delete cascade,
  tipo text not null check (tipo in ('recordatorio','acuse','borrador')),
  intento int,
  escalon_tono int,
  cuerpo text not null,                                -- contenido exacto enviado
  gmail_message_id text,
  estado text not null default 'enviado'
    check (estado in ('enviado','fallido','borrador')),
  error text,
  clave_idempotencia text not null,
  creado_en timestamptz not null default now(),
  unique (user_id, clave_idempotencia)
);

create index on envios(seguimiento_id, creado_en desc);

-- ============================================================
-- FERIADOS Y AUDITORÍA
-- ============================================================

create table feriados (
  fecha date primary key,
  nombre text not null,
  irrenunciable boolean not null default false
);

create table eventos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seguimiento_id uuid references seguimientos(id) on delete set null,
  accion text not null,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

create index on eventos(user_id, creado_en desc);

-- ============================================================
-- RLS
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'cuentas','reglas','seguimientos','mensajes_hilo',
    'clasificaciones','envios','eventos'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy propio on %I for all to authenticated
       using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

alter table feriados enable row level security;
create policy feriados_lectura on feriados for select to authenticated using (true);

-- eventos y envios: sin UPDATE ni DELETE. La policy 'propio' permite all;
-- se restringe explícitamente revocando en el rol de aplicación.
revoke update, delete on eventos from authenticated;
revoke update, delete on envios from authenticated;
