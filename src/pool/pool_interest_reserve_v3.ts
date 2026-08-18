import { Address, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { i128, Network } from '../index.js';

/** Pending take-rate assets apportioned to each v3 backstop tier. */
export interface InterestReserveStateV3 {
  carry: i128;
  first_loss: i128;
  second_loss: i128;
  third_loss: i128;
}

const EMPTY_INTEREST_RESERVE_STATE: InterestReserveStateV3 = {
  carry: 0n,
  first_loss: 0n,
  second_loss: 0n,
  third_loss: 0n,
};

function reserveStateKey(poolId: string, asset: string): xdr.LedgerKey {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Reserve'),
    Address.fromString(asset).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(poolId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

/** Decode one stored v3 interest allocation, or its contract default. */
export function decodeInterestReserveStateV3(value?: xdr.ScVal): InterestReserveStateV3 {
  if (value === undefined) {
    return { ...EMPTY_INTEREST_RESERVE_STATE };
  }
  const decoded = scValToNative(value) as unknown;
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid v3 interest-reserve state');
  }
  const state = decoded as Partial<InterestReserveStateV3>;
  if (
    typeof state.carry !== 'bigint' ||
    typeof state.first_loss !== 'bigint' ||
    typeof state.second_loss !== 'bigint' ||
    typeof state.third_loss !== 'bigint' ||
    state.carry < 0n ||
    state.first_loss < 0n ||
    state.second_loss < 0n ||
    state.third_loss < 0n
  ) {
    throw new Error('Invalid v3 interest-reserve state');
  }
  return {
    carry: state.carry,
    first_loss: state.first_loss,
    second_loss: state.second_loss,
    third_loss: state.third_loss,
  };
}

/**
 * Direct-ledger view of one reserve's v3 tier-specific take-rate allocation.
 * Reading does not extend the persistent entry's TTL. A false `entryExists`
 * means the entry is absent or unavailable through the live-ledger RPC view.
 */
export class PoolInterestReserveV3 {
  constructor(
    public state: InterestReserveStateV3,
    public entryExists: boolean,
    public latestLedger: number
  ) {}

  static async load(
    network: Network,
    poolId: string,
    asset: string
  ): Promise<PoolInterestReserveV3> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const key = reserveStateKey(poolId, asset);
    const response = await stellarRpc.getLedgerEntries(key);
    if (response.entries.length > 1) {
      throw new Error('Unexpected v3 interest-reserve ledger response');
    }
    const state =
      response.entries.length === 0
        ? decodeInterestReserveStateV3()
        : decodeInterestReserveStateV3(response.entries[0].val.contractData().val());
    return new PoolInterestReserveV3(state, response.entries.length === 1, response.latestLedger);
  }
}
