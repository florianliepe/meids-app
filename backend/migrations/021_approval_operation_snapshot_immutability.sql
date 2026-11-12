BEGIN;

CREATE OR REPLACE FUNCTION public.guard_agent_approval_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  mutable_record_keys text[] := ARRAY[
    'status',
    'decision_started_at',
    'decision_completed_at',
    'action_result',
    'resumed_at',
    'resumed_trace_id',
    'rejected_at',
    'blocked_reason',
    'expired_at',
    'failure_reason',
    'last_failure_reason',
    'last_failure_at',
    'last_failure_rolled_back',
    'runtime',
    'updated_at'
  ];
BEGIN
  IF OLD.approval_id IS DISTINCT FROM NEW.approval_id
    OR OLD.trace_id IS DISTINCT FROM NEW.trace_id
    OR OLD.trace_chain_id IS DISTINCT FROM NEW.trace_chain_id
    OR OLD.request_id IS DISTINCT FROM NEW.request_id
    OR OLD.agent_id IS DISTINCT FROM NEW.agent_id
    OR OLD.target_agent IS DISTINCT FROM NEW.target_agent
    OR (OLD.record - mutable_record_keys) IS DISTINCT FROM (NEW.record - mutable_record_keys)
  THEN
    RAISE EXCEPTION 'agent approval operation snapshot is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS guard_agent_approval_snapshot_update ON public.agent_approval_queue;
CREATE TRIGGER guard_agent_approval_snapshot_update
BEFORE UPDATE ON public.agent_approval_queue
FOR EACH ROW
EXECUTE FUNCTION public.guard_agent_approval_snapshot();

COMMIT;
