import {
  deriveMigrationLifecycleV3,
  MigrationBlockerV3,
  MigrationLifecycleContextV3,
  MigrationPhaseV3,
  MigrationStateV3,
  MigrationStatusV3,
} from '../../src/index.js';

const CANDIDATE = 'candidate';
const INCUMBENT = 'incumbent';
const BLND_XLM = 'blnd-xlm';

function state(overrides: Partial<MigrationStateV3> = {}): MigrationStateV3 {
  return {
    activated_at: undefined,
    backfill_end: undefined,
    blnd_binding_verified: false,
    funded_backfill: undefined,
    migration_epoch_start: 1n,
    scheduled_backfill: 100n,
    status: MigrationStatusV3.Open,
    verified_queue_unlock: undefined,
    ...overrides,
  };
}

function context(
  overrides: Partial<MigrationLifecycleContextV3> = {}
): MigrationLifecycleContextV3 {
  return {
    candidateAddress: CANDIDATE,
    candidateBlndUsdcBalance: 101n,
    candidateState: state(),
    emitterBackstop: INCUMBENT,
    expectedBlndXlmToken: BLND_XLM,
    incumbentBackstop: INCUMBENT,
    incumbentBlndUsdcBalance: 100n,
    queuedSwap: undefined,
    timestamp: 1_000n,
    ...overrides,
  };
}

test('derives pending and open migration phases', () => {
  expect(
    deriveMigrationLifecycleV3(
      context({
        candidateState: state({
          migration_epoch_start: undefined,
          scheduled_backfill: 0n,
          status: MigrationStatusV3.Pending,
        }),
      })
    ).phase
  ).toEqual(MigrationPhaseV3.Pending);
  expect(deriveMigrationLifecycleV3(context()).phase).toEqual(MigrationPhaseV3.BackfillOpen);
});

test('derives queue scheduling, attestation, and readiness', () => {
  const queue = {
    new_backstop: CANDIDATE,
    new_backstop_token: BLND_XLM,
    unlock_time: 1_000_000n,
  };
  const beforeAttestation = deriveMigrationLifecycleV3(
    context({ queuedSwap: queue, timestamp: 1_000n })
  );
  expect(beforeAttestation).toMatchObject({
    phase: MigrationPhaseV3.QueueScheduled,
    blocker: undefined,
  });

  const attestationRequired = deriveMigrationLifecycleV3(
    context({ queuedSwap: queue, timestamp: queue.unlock_time - 1n })
  );
  expect(attestationRequired).toMatchObject({
    phase: MigrationPhaseV3.QueueScheduled,
    blocker: MigrationBlockerV3.AttestationRequired,
  });

  const attestedState = state({ verified_queue_unlock: queue.unlock_time });
  expect(
    deriveMigrationLifecycleV3(
      context({
        candidateState: attestedState,
        queuedSwap: queue,
        timestamp: queue.unlock_time - 1n,
      })
    ).phase
  ).toEqual(MigrationPhaseV3.QueueAttested);

  expect(
    deriveMigrationLifecycleV3(
      context({ candidateState: attestedState, queuedSwap: queue, timestamp: queue.unlock_time })
    )
  ).toMatchObject({
    phase: MigrationPhaseV3.ReadyToSwap,
    qualificationSatisfied: true,
    blocker: undefined,
  });
});

test('reports queue and qualification blockers', () => {
  const queue = {
    new_backstop: CANDIDATE,
    new_backstop_token: BLND_XLM,
    unlock_time: 1_000_000n,
  };
  expect(
    deriveMigrationLifecycleV3(
      context({ queuedSwap: { ...queue, new_backstop_token: 'wrong-token' } })
    ).blocker
  ).toEqual(MigrationBlockerV3.InvalidQueue);

  const insufficient = deriveMigrationLifecycleV3(
    context({
      candidateBlndUsdcBalance: 100n,
      candidateState: state({ verified_queue_unlock: queue.unlock_time }),
      queuedSwap: queue,
      timestamp: queue.unlock_time,
    })
  );
  expect(insufficient).toMatchObject({
    phase: MigrationPhaseV3.ReadyToSwap,
    qualificationSatisfied: false,
    blocker: MigrationBlockerV3.InsufficientBlndUsdc,
  });
});

test('derives post-swap activation and backfill funding phases', () => {
  const awaitingActivation = deriveMigrationLifecycleV3(
    context({
      candidateState: state({ verified_queue_unlock: 1_000n }),
      emitterBackstop: CANDIDATE,
      timestamp: 1_001n,
    })
  );
  expect(awaitingActivation).toMatchObject({
    phase: MigrationPhaseV3.AwaitingActivation,
    blocker: undefined,
  });

  expect(
    deriveMigrationLifecycleV3(context({ emitterBackstop: CANDIDATE, timestamp: 1_001n })).blocker
  ).toEqual(MigrationBlockerV3.MissingAttestation);

  const activeState = state({
    activated_at: 1_000n,
    status: MigrationStatusV3.Active,
  });
  expect(deriveMigrationLifecycleV3(context({ candidateState: activeState })).phase).toEqual(
    MigrationPhaseV3.FundingBackfill
  );
  expect(
    deriveMigrationLifecycleV3(
      context({ candidateState: state({ ...activeState, funded_backfill: 100n }) })
    )
  ).toMatchObject({
    phase: MigrationPhaseV3.Complete,
    claimsAvailable: true,
  });
});
