import { Address, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { EmitterContract, Swap } from '../emitter/index.js';
import { i128, Network, u64 } from '../index.js';
import { decodeEntryKey } from '../ledger_entry_helper.js';
import { simulateAndParse } from '../simulation_helper.js';
import { getTokenBalance } from '../token.js';

const DAY_IN_SECONDS = 24n * 60n * 60n;
const QUEUE_ATTESTATION_WINDOW_SECONDS = 7n * DAY_IN_SECONDS;
const ACTIVATION_GRACE_SECONDS = 7n * DAY_IN_SECONDS;

export enum MigrationStatusV3 {
  Pending = 'Pending',
  Open = 'Open',
  Active = 'Active',
}

export interface MigrationStateV3 {
  activated_at: u64 | undefined;
  backfill_end: u64 | undefined;
  blnd_binding_verified: boolean;
  funded_backfill: i128 | undefined;
  migration_epoch_start: u64 | undefined;
  scheduled_backfill: i128;
  status: MigrationStatusV3;
  verified_queue_unlock: u64 | undefined;
}

/** Application-facing phases derived from candidate, emitter, and token state. */
export enum MigrationPhaseV3 {
  Pending = 'Pending',
  BackfillOpen = 'BackfillOpen',
  QueueScheduled = 'QueueScheduled',
  QueueAttested = 'QueueAttested',
  ReadyToSwap = 'ReadyToSwap',
  AwaitingActivation = 'AwaitingActivation',
  FundingBackfill = 'FundingBackfill',
  Complete = 'Complete',
}

/** Recoverable or terminal conditions that prevent the phase's next transition. */
export enum MigrationBlockerV3 {
  InvalidQueue = 'InvalidQueue',
  AttestationRequired = 'AttestationRequired',
  InsufficientBlndUsdc = 'InsufficientBLND_USDC',
  MissingAttestation = 'MissingAttestation',
  AttestationWindowExpired = 'AttestationWindowExpired',
  ActivationWindowExpired = 'ActivationWindowExpired',
  UnexpectedEmitterRecipient = 'UnexpectedEmitterRecipient',
}

export interface MigrationLifecycleContextV3 {
  candidateAddress: string;
  candidateBlndUsdcBalance?: i128;
  candidateState: MigrationStateV3;
  emitterBackstop: string;
  expectedBlndXlmToken: string;
  incumbentBackstop: string;
  incumbentBlndUsdcBalance?: i128;
  queuedSwap?: Swap;
  timestamp: u64;
}

export interface MigrationLifecycleV3 {
  activationDeadline?: u64;
  attestationStart?: u64;
  blocker?: MigrationBlockerV3;
  candidateState: MigrationStateV3;
  claimsAvailable: boolean;
  fundedBackfill: i128;
  latestLedger?: number;
  localStatus: MigrationStatusV3;
  nextAction?: string;
  phase: MigrationPhaseV3;
  qualificationSatisfied?: boolean;
  queueUnlock?: u64;
  scheduledBackfill: i128;
  timestamp: u64;
}

export interface LoadMigrationLifecycleArgsV3 {
  candidateAddress: string;
  emitterAddress: string;
  expectedBlndXlmToken: string;
  incumbentBackstop: string;
  incumbentBlndUsdcToken: string;
}

function asBigInt(value: xdr.ScVal): bigint {
  return BigInt(scValToNative(value));
}

/** Decode the exact migration snapshot from a v3 backstop contract instance. */
export function decodeMigrationStateV3(storage: xdr.ScMapEntry[]): MigrationStateV3 {
  let activatedAt: bigint | undefined;
  let backfillEnd: bigint | undefined;
  let blndBindingVerified = false;
  let fundedBackfill: bigint | undefined;
  let migrationEpochStart: bigint | undefined;
  let scheduledBackfill = 0n;
  let verifiedQueueUnlock: bigint | undefined;

  for (const entry of storage) {
    switch (decodeEntryKey(entry.key())) {
      case 'ActivatedAt':
        activatedAt = asBigInt(entry.val());
        break;
      case 'BackfillEnd':
        backfillEnd = asBigInt(entry.val());
        break;
      case 'BlndBound':
        blndBindingVerified = Boolean(scValToNative(entry.val()));
        break;
      case 'BFundAmt':
        fundedBackfill = asBigInt(entry.val());
        break;
      case 'MigrationEpochStart':
        migrationEpochStart = asBigInt(entry.val());
        break;
      case 'ScheduledBackfill':
        scheduledBackfill = asBigInt(entry.val());
        break;
      case 'VerifiedQueueUnlock':
        verifiedQueueUnlock = asBigInt(entry.val());
        break;
      default:
        // Other instance keys configure ordinary backstop behavior.
        break;
    }
  }

  const status =
    activatedAt !== undefined
      ? MigrationStatusV3.Active
      : migrationEpochStart !== undefined
      ? MigrationStatusV3.Open
      : MigrationStatusV3.Pending;

  return {
    activated_at: activatedAt,
    backfill_end: backfillEnd,
    blnd_binding_verified: blndBindingVerified,
    funded_backfill: fundedBackfill,
    migration_epoch_start: migrationEpochStart,
    scheduled_backfill: scheduledBackfill,
    status,
    verified_queue_unlock: verifiedQueueUnlock,
  };
}

/**
 * Derive a human-facing lifecycle without changing the candidate's canonical
 * Pending/Open/Active state. Contract checks remain authoritative.
 */
export function deriveMigrationLifecycleV3(
  context: MigrationLifecycleContextV3
): MigrationLifecycleV3 {
  const state = context.candidateState;
  const scheduledBackfill = state.scheduled_backfill;
  const fundedBackfill = state.funded_backfill ?? 0n;
  const claimsAvailable =
    state.status === MigrationStatusV3.Active &&
    (scheduledBackfill === 0n || fundedBackfill === scheduledBackfill);
  const base = {
    candidateState: state,
    claimsAvailable,
    fundedBackfill,
    localStatus: state.status,
    scheduledBackfill,
    timestamp: context.timestamp,
  };

  if (state.status === MigrationStatusV3.Active) {
    if (!claimsAvailable) {
      return {
        ...base,
        phase: MigrationPhaseV3.FundingBackfill,
        nextAction: 'Call candidate drop() to fund the scheduled backfill.',
      };
    }
    return {
      ...base,
      phase: MigrationPhaseV3.Complete,
    };
  }

  if (context.emitterBackstop === context.candidateAddress) {
    const queueUnlock = state.verified_queue_unlock;
    const activationDeadline =
      queueUnlock === undefined ? undefined : queueUnlock + ACTIVATION_GRACE_SECONDS;
    const blocker =
      queueUnlock === undefined
        ? MigrationBlockerV3.MissingAttestation
        : context.timestamp > activationDeadline!
        ? MigrationBlockerV3.ActivationWindowExpired
        : undefined;
    return {
      ...base,
      activationDeadline,
      blocker,
      phase: MigrationPhaseV3.AwaitingActivation,
      queueUnlock,
      nextAction:
        blocker === undefined ? 'Call candidate distribute() to activate migration.' : undefined,
    };
  }

  if (state.status === MigrationStatusV3.Pending) {
    return {
      ...base,
      phase: MigrationPhaseV3.Pending,
      nextAction: 'Call candidate distribute() to open migration backfill.',
    };
  }

  if (context.emitterBackstop !== context.incumbentBackstop) {
    return {
      ...base,
      blocker: MigrationBlockerV3.UnexpectedEmitterRecipient,
      phase: MigrationPhaseV3.BackfillOpen,
    };
  }

  const queuedSwap = context.queuedSwap;
  if (queuedSwap === undefined) {
    return {
      ...base,
      phase: MigrationPhaseV3.BackfillOpen,
      nextAction: 'Create a compatible emitter migration queue.',
    };
  }

  const queueUnlock = queuedSwap.unlock_time;
  const attestationStart =
    queueUnlock > QUEUE_ATTESTATION_WINDOW_SECONDS
      ? queueUnlock - QUEUE_ATTESTATION_WINDOW_SECONDS
      : 0n;
  const activationDeadline = queueUnlock + ACTIVATION_GRACE_SECONDS;
  const queueCompatible =
    queuedSwap.new_backstop === context.candidateAddress &&
    queuedSwap.new_backstop_token === context.expectedBlndXlmToken;
  if (!queueCompatible) {
    return {
      ...base,
      activationDeadline,
      attestationStart,
      blocker: MigrationBlockerV3.InvalidQueue,
      phase: MigrationPhaseV3.QueueScheduled,
      queueUnlock,
    };
  }

  const queueAttested = state.verified_queue_unlock === queueUnlock;
  if (context.timestamp > activationDeadline) {
    return {
      ...base,
      activationDeadline,
      attestationStart,
      blocker: MigrationBlockerV3.AttestationWindowExpired,
      phase: MigrationPhaseV3.QueueScheduled,
      queueUnlock,
      nextAction: 'Establish and attest a fresh compatible emitter queue.',
    };
  }

  if (!queueAttested) {
    const attestationRequired = context.timestamp >= attestationStart;
    return {
      ...base,
      activationDeadline,
      attestationStart,
      blocker: attestationRequired ? MigrationBlockerV3.AttestationRequired : undefined,
      phase: MigrationPhaseV3.QueueScheduled,
      queueUnlock,
      nextAction: attestationRequired
        ? 'Call candidate distribute() to attest the emitter queue.'
        : 'Wait for the queue attestation window.',
    };
  }

  if (context.timestamp < queueUnlock) {
    return {
      ...base,
      activationDeadline,
      attestationStart,
      phase: MigrationPhaseV3.QueueAttested,
      queueUnlock,
      nextAction: 'Wait for the emitter queue to unlock.',
    };
  }

  const qualificationSatisfied =
    context.candidateBlndUsdcBalance !== undefined &&
    context.incumbentBlndUsdcBalance !== undefined &&
    context.candidateBlndUsdcBalance > context.incumbentBlndUsdcBalance;
  return {
    ...base,
    activationDeadline,
    attestationStart,
    blocker: qualificationSatisfied ? undefined : MigrationBlockerV3.InsufficientBlndUsdc,
    phase: MigrationPhaseV3.ReadyToSwap,
    qualificationSatisfied,
    queueUnlock,
    nextAction: qualificationSatisfied
      ? 'Call emitter swap_backstop().'
      : 'Restore the candidate qualifying BLND:USDC balance.',
  };
}

/** Load the external context needed for the richer application lifecycle. */
export async function loadMigrationLifecycleV3(
  network: Network,
  args: LoadMigrationLifecycleArgsV3
): Promise<MigrationLifecycleV3> {
  const emitter = new EmitterContract(args.emitterAddress);
  const stellarRpc = new rpc.Server(network.rpc, network.opts);
  const [migration, emitterBackstop, queuedSwap, latestLedger] = await Promise.all([
    BackstopMigrationV3.load(network, args.candidateAddress),
    simulateAndParse(network, emitter.getBackstop(), EmitterContract.parsers.getBackstop),
    simulateAndParse(network, emitter.getQueuedSwap(), EmitterContract.parsers.getQueuedSwap),
    stellarRpc.getLatestLedger(),
  ]);

  let candidateBlndUsdcBalance: bigint | undefined;
  let incumbentBlndUsdcBalance: bigint | undefined;
  if (emitterBackstop.result !== args.candidateAddress) {
    [candidateBlndUsdcBalance, incumbentBlndUsdcBalance] = await Promise.all([
      getTokenBalance(
        network,
        args.incumbentBlndUsdcToken,
        Address.fromString(args.candidateAddress)
      ),
      getTokenBalance(
        network,
        args.incumbentBlndUsdcToken,
        Address.fromString(args.incumbentBackstop)
      ),
    ]);
  }

  return {
    ...deriveMigrationLifecycleV3({
      candidateAddress: args.candidateAddress,
      candidateBlndUsdcBalance,
      candidateState: migration.state,
      emitterBackstop: emitterBackstop.result,
      expectedBlndXlmToken: args.expectedBlndXlmToken,
      incumbentBackstop: args.incumbentBackstop,
      incumbentBlndUsdcBalance,
      queuedSwap: queuedSwap.result,
      timestamp: BigInt(latestLedger.closeTime),
    }),
    latestLedger: Math.max(
      migration.latestLedger,
      emitterBackstop.latestLedger,
      queuedSwap.latestLedger,
      latestLedger.sequence
    ),
  };
}

/** Exact off-chain view of the v3 incumbent-emitter migration lifecycle. */
export class BackstopMigrationV3 {
  constructor(public state: MigrationStateV3, public latestLedger: number) {}

  static async load(network: Network, backstopId: string): Promise<BackstopMigrationV3> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const instanceKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(backstopId).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      })
    );
    const response = await stellarRpc.getLedgerEntries(instanceKey);
    if (response.entries.length !== 1) {
      throw new Error('Unable to load v3 backstop contract instance');
    }
    const contractData = response.entries[0].val.contractData();
    if (decodeEntryKey(contractData.key()) !== 'ContractInstance') {
      throw new Error('Unexpected ledger entry while loading v3 migration state');
    }
    const storage = contractData.val().instance().storage() ?? [];
    return new BackstopMigrationV3(decodeMigrationStateV3(storage), response.latestLedger);
  }
}
