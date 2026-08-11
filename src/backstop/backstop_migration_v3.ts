import { Address, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { i128, Network, u64 } from '../index.js';
import { decodeEntryKey } from '../ledger_entry_helper.js';

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
