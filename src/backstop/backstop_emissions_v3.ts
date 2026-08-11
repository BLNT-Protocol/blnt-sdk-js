import { Address, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { i128, Network, u64 } from '../index.js';
import { decodeEntryKey } from '../ledger_entry_helper.js';
import { BackstopTierV3 } from './backstop_contract_v3.js';

const SCALAR_7 = 10_000_000n;
const SCALAR_14 = 100_000_000_000_000n;

export interface BackstopEmissionEstimateDataV3 {
  expiration: u64;
  eps: u64;
  index: i128;
  last_time: u64;
}

export interface UserEmissionEstimateDataV3 {
  accrued: i128;
  index: i128;
}

export interface PoolClaimableEstimateStateV3 {
  emission?: BackstopEmissionEstimateDataV3;
  pool_queued_shares: i128;
  pool_shares: i128;
  user_emission?: UserEmissionEstimateDataV3;
  user_shares: i128;
}

export interface BackstopClaimableEstimateV3 {
  amount: i128;
  by_pool: Record<string, i128>;
  latest_ledger: number;
  timestamp: u64;
}

type PoolLedgerState = {
  emission?: BackstopEmissionEstimateDataV3;
  pool_queued_shares: bigint;
  pool_shares: bigint;
  user_emission?: UserEmissionEstimateDataV3;
  user_shares: bigint;
};

type LedgerValueKind = 'emission' | 'pool_balance' | 'user_balance' | 'user_emission';

function tierToScVal(tier: BackstopTierV3): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tier)]);
}

function mapEntry(name: string, value: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val: value });
}

function poolTierKey(pool: string, tier: BackstopTierV3): xdr.ScVal {
  return xdr.ScVal.scvMap([
    mapEntry('pool', Address.fromString(pool).toScVal()),
    mapEntry('tier', tierToScVal(tier)),
  ]);
}

function poolUserKey(pool: string, user: string): xdr.ScVal {
  return xdr.ScVal.scvMap([
    mapEntry('pool', Address.fromString(pool).toScVal()),
    mapEntry('user', Address.fromString(user).toScVal()),
  ]);
}

function poolUserTierKey(pool: string, tier: BackstopTierV3, user: string): xdr.ScVal {
  return xdr.ScVal.scvMap([
    mapEntry('pool', Address.fromString(pool).toScVal()),
    mapEntry('tier', tierToScVal(tier)),
    mapEntry('user', Address.fromString(user).toScVal()),
  ]);
}

function enumKey(name: string, value: xdr.ScVal): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name), value]);
}

function ledgerKey(backstopId: string, key: xdr.ScVal): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(backstopId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

function poolLedgerKeys(
  backstopId: string,
  tier: BackstopTierV3,
  user: string,
  pool: string
): Array<readonly [LedgerValueKind, xdr.LedgerKey]> {
  const tierKey = poolTierKey(pool, tier);
  const userTierKey = poolUserTierKey(pool, tier, user);
  const poolBalanceKey =
    tier === BackstopTierV3.BlndUsdc
      ? enumKey('PoolBalance', Address.fromString(pool).toScVal())
      : enumKey('TierPoolBalance', tierKey);
  const userBalanceKey =
    tier === BackstopTierV3.BlndUsdc
      ? enumKey('UserBalance', poolUserKey(pool, user))
      : enumKey('TierUserBalance', userTierKey);
  return [
    ['pool_balance', ledgerKey(backstopId, poolBalanceKey)],
    ['user_balance', ledgerKey(backstopId, userBalanceKey)],
    ['emission', ledgerKey(backstopId, enumKey('BEmisData', tierKey))],
    ['user_emission', ledgerKey(backstopId, enumKey('UEmisData', userTierKey))],
  ];
}

function mapValues(value: xdr.ScVal): Map<string, xdr.ScVal> {
  const entries = value.map();
  if (entries === undefined) {
    throw new Error('Expected contract data map');
  }
  return new Map(entries.map((entry) => [decodeEntryKey(entry.key()), entry.val()]));
}

function requiredBigInt(values: Map<string, xdr.ScVal>, key: string): bigint {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error(`Missing ${key} in v3 backstop ledger data`);
  }
  return BigInt(scValToNative(value));
}

function parseEmission(value: xdr.ScVal): BackstopEmissionEstimateDataV3 {
  const values = mapValues(value);
  return {
    expiration: requiredBigInt(values, 'expiration'),
    eps: requiredBigInt(values, 'eps'),
    index: requiredBigInt(values, 'index'),
    last_time: requiredBigInt(values, 'last_time'),
  };
}

function parseUserEmission(value: xdr.ScVal): UserEmissionEstimateDataV3 {
  const values = mapValues(value);
  return {
    accrued: requiredBigInt(values, 'accrued'),
    index: requiredBigInt(values, 'index'),
  };
}

function validateClaimRequest(tier: BackstopTierV3, pools: string[]): void {
  if (tier === BackstopTierV3.Usdc) {
    throw new Error('Plain USDC is not eligible for BLND emissions');
  }
  if (pools.length === 0 || new Set(pools).size !== pools.length) {
    throw new Error('Claim estimate requires unique pool addresses');
  }
}

/** Estimate one pool's claim without consuming contract-internal rounding carry. */
export function estimatePoolClaimableV3(state: PoolClaimableEstimateStateV3, timestamp: u64): i128 {
  if (
    state.pool_shares < 0n ||
    state.pool_queued_shares < 0n ||
    state.pool_shares < state.pool_queued_shares ||
    state.user_shares < 0n
  ) {
    throw new Error('Invalid v3 backstop balance data');
  }

  const userEmission = state.user_emission ?? { accrued: 0n, index: 0n };
  if (userEmission.accrued < 0n || userEmission.index < 0n) {
    throw new Error('Invalid v3 user emission data');
  }

  // The contract returns an existing user's accrued amount unchanged when a
  // pool emission record is absent (for example, after its shorter TTL
  // expires). The user record can legitimately retain a nonzero index.
  if (state.emission === undefined) {
    return userEmission.accrued;
  }

  const emission = state.emission;
  if (
    emission.expiration < 0n ||
    emission.eps < 0n ||
    emission.index < 0n ||
    emission.last_time > timestamp
  ) {
    throw new Error('Invalid v3 backstop emission data');
  }
  let currentIndex = emission.index;
  const streamEnd = timestamp < emission.expiration ? timestamp : emission.expiration;
  const activeShares = state.pool_shares - state.pool_queued_shares;
  if (activeShares > 0n && streamEnd > emission.last_time) {
    const emittedScaled = (streamEnd - emission.last_time) * emission.eps;
    currentIndex += (emittedScaled * SCALAR_7) / activeShares;
  }
  if (currentIndex < userEmission.index) {
    throw new Error('Invalid v3 user emission data');
  }
  return (
    userEmission.accrued + (state.user_shares * (currentIndex - userEmission.index)) / SCALAR_14
  );
}

/** Off-chain v2-style estimator for one user's v3 backstop BLND claim. */
export class BackstopEmissionsV3 {
  static async estimateClaimable(
    network: Network,
    backstopId: string,
    tier: BackstopTierV3,
    user: string,
    pools: string[],
    timestamp: u64 = BigInt(Math.floor(Date.now() / 1000))
  ): Promise<BackstopClaimableEstimateV3> {
    validateClaimRequest(tier, pools);
    const requestEntries: Array<{
      kind: LedgerValueKind;
      key: xdr.LedgerKey;
      pool: string;
    }> = [];
    for (const pool of pools) {
      for (const [kind, key] of poolLedgerKeys(backstopId, tier, user, pool)) {
        requestEntries.push({ kind, key, pool });
      }
    }
    const requestedByKey = new Map(
      requestEntries.map((entry) => [entry.key.contractData().key().toXDR('base64'), entry])
    );
    const states = new Map<string, PoolLedgerState>(
      pools.map((pool) => [
        pool,
        {
          pool_queued_shares: 0n,
          pool_shares: 0n,
          user_shares: 0n,
        },
      ])
    );

    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const response = await stellarRpc.getLedgerEntries(...requestEntries.map((entry) => entry.key));
    for (const entry of response.entries) {
      const contractData = entry.val.contractData();
      const requested = requestedByKey.get(contractData.key().toXDR('base64'));
      if (requested === undefined) {
        throw new Error('Unexpected ledger entry while estimating v3 BLND claim');
      }
      const state = states.get(requested.pool)!;
      const values = mapValues(contractData.val());
      switch (requested.kind) {
        case 'pool_balance':
          state.pool_shares = requiredBigInt(values, 'shares');
          state.pool_queued_shares = requiredBigInt(values, 'q4w');
          break;
        case 'user_balance':
          state.user_shares = requiredBigInt(values, 'shares');
          break;
        case 'emission':
          state.emission = parseEmission(contractData.val());
          break;
        case 'user_emission':
          state.user_emission = parseUserEmission(contractData.val());
          break;
      }
    }

    let amount = 0n;
    const byPool: Record<string, bigint> = {};
    for (const pool of pools) {
      const poolAmount = estimatePoolClaimableV3(states.get(pool)!, timestamp);
      byPool[pool] = poolAmount;
      amount += poolAmount;
    }
    return {
      amount,
      by_pool: byPool,
      latest_ledger: response.latestLedger,
      timestamp,
    };
  }
}
