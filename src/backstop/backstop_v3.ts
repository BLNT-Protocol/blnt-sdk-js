import { Network } from '../index.js';
import { simulateAndParse } from '../simulation_helper.js';
import {
  BackstopContractV3,
  BackstopTierV3,
  PoolBackstopDataV3,
  PoolTierDataV3,
  UserBalanceV3,
} from './backstop_contract_v3.js';
import { BackstopMigrationV3, MigrationStateV3 } from './backstop_migration_v3.js';

/** Fixed v3 loss-waterfall order. */
export const BACKSTOP_TIERS_V3 = [
  BackstopTierV3.BlndXlm,
  BackstopTierV3.BlndUsdc,
  BackstopTierV3.Usdc,
] as const;

export type BackstopTierMapV3<T> = Record<BackstopTierV3, T>;

/** One independently accounted v3 backstop tier for a pool. */
export class BackstopTierPoolV3 {
  constructor(public tier: BackstopTierV3, public data: PoolTierDataV3) {}

  public sharesToTokens(shares: bigint): bigint {
    if (this.data.shares === 0n) {
      return shares;
    }
    return (shares * this.data.assets) / this.data.shares;
  }

  public tokensToShares(tokens: bigint): bigint {
    if (this.data.assets === 0n || this.data.shares === 0n) {
      return tokens;
    }
    return (tokens * this.data.shares) / this.data.assets;
  }
}

/** Canonical three-tier accounting and valuation for one v3 pool. */
export class BackstopPoolV3 {
  public readonly tiers: BackstopTierMapV3<BackstopTierPoolV3>;

  constructor(public data: PoolBackstopDataV3, public latestLedger: number) {
    this.tiers = {
      [BackstopTierV3.BlndXlm]: new BackstopTierPoolV3(BackstopTierV3.BlndXlm, data.blnd_xlm),
      [BackstopTierV3.BlndUsdc]: new BackstopTierPoolV3(BackstopTierV3.BlndUsdc, data.blnd_usdc),
      [BackstopTierV3.Usdc]: new BackstopTierPoolV3(BackstopTierV3.Usdc, data.usdc),
    };
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
    return this.tiers[tier];
  }

  public totalActiveValue(): bigint {
    return BACKSTOP_TIERS_V3.reduce(
      (total, tier) => total + this.tiers[tier].data.active_value,
      0n
    );
  }

  public totalValue(): bigint {
    return BACKSTOP_TIERS_V3.reduce((total, tier) => total + this.tiers[tier].data.total_value, 0n);
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
    const responses = await Promise.all(
      BACKSTOP_TIERS_V3.map((tier) =>
        simulateAndParse(
          network,
          contract.userBalance(tier, poolId, userId),
          BackstopContractV3.parsers.userBalance
        )
      )
    );
    const balances = {} as BackstopTierMapV3<UserBalanceV3>;
    BACKSTOP_TIERS_V3.forEach((tier, index) => {
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
    return this.balances[tier];
  }

  public queuedShares(tier: BackstopTierV3): bigint {
    return this.balances[tier].q4w.reduce((total, item) => total + item.amount, 0n);
  }

  public unlockedQueuedShares(tier: BackstopTierV3, timestamp: number): bigint {
    return this.balances[tier].q4w.reduce(
      (total, item) => (item.exp <= BigInt(timestamp) ? total + item.amount : total),
      0n
    );
  }
}

/** Immutable token bindings and migration state for the v3 backstop. */
export class BackstopV3 {
  constructor(
    public id: string,
    public tokens: BackstopTierMapV3<string>,
    public migration: MigrationStateV3,
    public rewardZone: string[],
    public latestLedger: number
  ) {}

  public static async load(network: Network, id: string): Promise<BackstopV3> {
    const contract = new BackstopContractV3(id);
    const [blndXlm, blndUsdc, usdc, migration, rewardZone] = await Promise.all([
      simulateAndParse(
        network,
        contract.backstopToken(BackstopTierV3.BlndXlm),
        BackstopContractV3.parsers.backstopToken
      ),
      simulateAndParse(
        network,
        contract.backstopToken(BackstopTierV3.BlndUsdc),
        BackstopContractV3.parsers.backstopToken
      ),
      simulateAndParse(
        network,
        contract.backstopToken(BackstopTierV3.Usdc),
        BackstopContractV3.parsers.backstopToken
      ),
      BackstopMigrationV3.load(network, id),
      simulateAndParse(network, contract.rewardZone(), BackstopContractV3.parsers.rewardZone),
    ]);
    return new BackstopV3(
      id,
      {
        [BackstopTierV3.BlndXlm]: blndXlm.result,
        [BackstopTierV3.BlndUsdc]: blndUsdc.result,
        [BackstopTierV3.Usdc]: usdc.result,
      },
      migration.state,
      rewardZone.result,
      Math.max(
        blndXlm.latestLedger,
        blndUsdc.latestLedger,
        usdc.latestLedger,
        migration.latestLedger,
        rewardZone.latestLedger
      )
    );
  }
}
