BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_trace_chains (
  trace_chain_id text PRIMARY KEY,
  actor_trace_id text,
  target_agent text,
  route_decision text,
  status text,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_traces (
  trace_id text PRIMARY KEY,
  trace_chain_id text,
  request_id text,
  agent_id text,
  target_agent text,
  route_decision text,
  status text,
  runtime text,
  approval_required boolean NOT NULL DEFAULT false,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_approval_queue (
  approval_id text PRIMARY KEY,
  trace_id text,
  trace_chain_id text,
  request_id text,
  agent_id text,
  target_agent text,
  status text,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_run_events (
  event_id bigserial PRIMARY KEY,
  trace_id text,
  trace_chain_id text,
  agent_id text,
  event_type text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_trace_chains, public.agent_traces, public.agent_approval_queue, public.agent_run_events TO meids_app_runtime;
GRANT USAGE, SELECT ON SEQUENCE public.agent_run_events_event_id_seq TO meids_app_runtime;

COMMIT;
