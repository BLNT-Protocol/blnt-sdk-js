import { Network } from '../index.js';
import { simulateAndParse } from '../simulation_helper.js';
import {
  BackstopAssetV3,
  BackstopContractV3,
  BackstopTierV3,
  PoolBackstopDataV3,
  PoolTierDataV3,
  UserBalanceV3,
} from './backstop_contract_v3.js';
import { BackstopMigrationV3, MigrationStateV3 } from './backstop_migration_v3.js';

/** All representable v3 loss-waterfall positions, in order. */
export const BACKSTOP_TIERS_V3 = [
  BackstopTierV3.FirstLoss,
  BackstopTierV3.SecondLoss,
  BackstopTierV3.ThirdLoss,
] as const;

export type BackstopTierMapV3<T> = Partial<Record<BackstopTierV3, T>>;

export function configuredBackstopTiersV3(count: number): BackstopTierV3[] {
  if (!Number.isInteger(count) || count < 1 || count > BACKSTOP_TIERS_V3.length) {
    throw new Error('A v3 pool must configure between one and three backstop tiers');
  }
  return BACKSTOP_TIERS_V3.slice(0, count);
}

/** One independently accounted v3 backstop tier for a pool. */
export class BackstopTierPoolV3 {
  constructor(public tier: BackstopTierV3, public data: PoolTierDataV3) {}

  /** A funded plain-USDC tier whose shared backstop balance is deauthorized. */
  public get isDeauthorized(): boolean {
    return (
      this.data.asset === BackstopAssetV3.Usdc && this.data.tokens > 0n && this.data.value === 0n
    );
  }

  public sharesToTokens(shares: bigint): bigint {
    if (this.data.shares === 0n) {
      return shares;
    }
    return (shares * this.data.tokens) / this.data.shares;
  }

  public tokensToShares(tokens: bigint): bigint {
    if (this.data.tokens === 0n || this.data.shares === 0n) {
      return tokens;
    }
    return (tokens * this.data.shares) / this.data.tokens;
  }
}

/** Immutable tier accounting and authorization-aware transferable valuation for one v3 pool. */
export class BackstopPoolV3 {
  public readonly tiers: BackstopTierMapV3<BackstopTierPoolV3>;
  public readonly configuredTiers: BackstopTierV3[];

  constructor(public data: PoolBackstopDataV3, public latestLedger: number) {
    this.configuredTiers = configuredBackstopTiersV3(data.tiers.length);
    this.tiers = {};
    this.configuredTiers.forEach((tier, index) => {
      this.tiers[tier] = new BackstopTierPoolV3(tier, data.tiers[index]);
    });
  }

  public static async load(
    network: Network,
    backstopId: string,
    poolId: string
  ): Promise<BackstopPoolV3> {
    const contract = new BackstopContractV3(backstopId);
    const response = await simulateAndParse(
      network,
      contract.poolData(poolId),
      BackstopContractV3.parsers.poolData
    );
    return new BackstopPoolV3(response.result, response.latestLedger);
  }

  public tier(tier: BackstopTierV3): BackstopTierPoolV3 {
    const result = this.tiers[tier];
    if (result === undefined) throw new Error(`${tier} is not configured for this pool`);
    return result;
  }

  public totalActiveValue(): bigint {
    return this.data.active_value;
  }

  public totalValue(): bigint {
    return this.configuredTiers.reduce((total, tier) => total + this.tier(tier).data.value, 0n);
  }
}

/** One user's tier-isolated backstop balances for a v3 pool. */
export class BackstopPoolUserV3 {
  constructor(
    public userId: string,
    public poolId: string,
    public balances: BackstopTierMapV3<UserBalanceV3>,
    public latestLedger: number
  ) {}

  public static async load(
    network: Network,
    backstopId: string,
    poolId: string,
    userId: string
  ): Promise<BackstopPoolUserV3> {
    const contract = new BackstopContractV3(backstopId);
    const pool = await BackstopPoolV3.load(network, backstopId, poolId);
    const responses = await Promise.all(
      pool.configuredTiers.map((tier) =>
        simulateAndParse(
          network,
          contract.userBalance(tier, poolId, userId),
          BackstopContractV3.parsers.userBalance
        )
      )
    );
    const balances = {} as BackstopTierMapV3<UserBalanceV3>;
    pool.configuredTiers.forEach((tier, index) => {
      balances[tier] = responses[index].result;
    });
    return new BackstopPoolUserV3(
      userId,
      poolId,
      balances,
      Math.max(...responses.map((response) => response.latestLedger))
    );
  }

  public balance(tier: BackstopTierV3): UserBalanceV3 {
    const result = this.balances[tier];
    if (result === undefined) throw new Error(`${tier} is not configured for this pool`);
    return result;
  }

  public queuedShares(tier: BackstopTierV3): bigint {
    return this.balance(tier).q4w.reduce((total, item) => total + item.amount, 0n);
  }

  public unlockedQueuedShares(tier: BackstopTierV3, timestamp: number): bigint {
    return this.balance(tier).q4w.reduce(
      (total, item) => (item.exp <= BigInt(timestamp) ? total + item.amount : total),
      0n
    );
  }
}

/** Global migration and reward-zone state for the v3 backstop. */
export class BackstopV3 {
  constructor(
    public id: string,
    public migration: MigrationStateV3,
    public rewardZone: string[],
    public latestLedger: number
  ) {}

  public static async load(network: Network, id: string): Promise<BackstopV3> {
    const contract = new BackstopContractV3(id);
    const [migration, rewardZone] = await Promise.all([
      BackstopMigrationV3.load(network, id),
      simulateAndParse(network, contract.rewardZone(), BackstopContractV3.parsers.rewardZone),
    ]);
    return new BackstopV3(
      id,
      migration.state,
      rewardZone.result,
      Math.max(migration.latestLedger, rewardZone.latestLedger)
    );
  }
}
