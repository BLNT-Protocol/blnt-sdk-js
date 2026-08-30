import {
  Address,
  Contract,
  nativeToScVal,
  Operation,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { i128, u64 } from '../index.js';

/** Blend v3 loss-waterfall positions, in order. */
export enum BackstopTierV3 {
  FirstLoss = 'FirstLoss',
  SecondLoss = 'SecondLoss',
  ThirdLoss = 'ThirdLoss',
}

/** Canonical assets permitted in a Blend v3 backstop configuration. */
export enum BackstopAssetV3 {
  BlntXlm = 'BlntXlm',
  BlntUsdc = 'BlntUsdc',
  Usdc = 'Usdc',
  Xlm = 'Xlm',
}

export interface Q4WV3 {
  amount: i128;
  exp: u64;
}

export interface UserBalanceV3 {
  q4w: Q4WV3[];
  shares: i128;
}

export interface PoolTierDataV3 {
  asset: BackstopAssetV3;
  blnt_emission_eligible: boolean;
  take_rate_weight: number;
  token: string;
  shares: i128;
  tokens: i128;
  /** Transferable USDC-equivalent value; zero while plain USDC is deauthorized. */
  value: i128;
}

export interface PoolBackstopDataV3 {
  /** Aggregate transferable value excluding queued withdrawals. */
  active_value: i128;
  q4w_pct: i128;
  tiers: PoolTierDataV3[];
}

export interface BackstopConstructorArgsV3 {
  blnd_usdc_token: Address | string;
  blnd_xlm_token: Address | string;
  emitter: Address | string;
  blnd_token: Address | string;
  usdc_token: Address | string;
  xlm_token: Address | string;
  pool_factory: Address | string;
  drop_list: Array<readonly [Address | string, i128]>;
}

export interface TierBackstopActionArgsV3 {
  tier: BackstopTierV3;
  from: Address | string;
  pool_address: Address | string;
  amount: i128;
}

export interface TierBackstopWithdrawArgsV3 extends TierBackstopActionArgsV3 {
  to: Address | string;
}

export interface ForcedBackstopExitArgsV3 {
  tier: BackstopTierV3;
  user: Address | string;
  pool_address: Address | string;
}

export interface BackstopClaimArgsV3 {
  tier: BackstopTierV3;
  from: Address | string;
  pool_addresses: Array<Address | string>;
  min_lp_tokens_out: i128;
}

function addressToScVal(address: Address | string): xdr.ScVal {
  return typeof address === 'string' ? Address.fromString(address).toScVal() : address.toScVal();
}

function i128ToScVal(value: i128): xdr.ScVal {
  return nativeToScVal(value, { type: 'i128' });
}

function tierToScVal(tier: BackstopTierV3): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tier)]);
}

function addressesToScVal(addresses: Array<Address | string>): xdr.ScVal {
  return xdr.ScVal.scvVec(addresses.map(addressToScVal));
}

function optionAddressToScVal(address: Address | string | undefined): xdr.ScVal {
  return address === undefined ? xdr.ScVal.scvVoid() : addressToScVal(address);
}

function parseNative<T>(result: string): T {
  return scValToNative(xdr.ScVal.fromXDR(result, 'base64')) as T;
}

export function parseBackstopAssetV3(value: unknown): BackstopAssetV3 {
  const tag =
    Array.isArray(value)
      ? value[0]
      : typeof value === 'object' && value !== null && 'tag' in value
      ? (value as { tag: unknown }).tag
      : value;
  if (Object.values(BackstopAssetV3).includes(tag as BackstopAssetV3)) {
    return tag as BackstopAssetV3;
  }
  throw new Error(`Unknown v3 backstop asset: ${String(tag)}`);
}

function parsePoolData(result: string): PoolBackstopDataV3 {
  const data = parseNative<Omit<PoolBackstopDataV3, 'tiers'> & { tiers: Array<Omit<PoolTierDataV3, 'asset'> & { asset: unknown }> }>(result);
  return {
    ...data,
    tiers: data.tiers.map((tier) => ({ ...tier, asset: parseBackstopAssetV3(tier.asset) })),
  };
}

/**
 * Transaction and read-operation adapter for the Blend v3 backstop.
 *
 * Encoding is kept explicit because v3's tier argument has no v1/v2 analogue.
 * Result parsers accept the canonical Soroban native representation returned
 * by the Stellar SDK.
 */
export class BackstopContractV3 extends Contract {
  static readonly parsers = {
    deposit: (result: string): i128 => parseNative(result),
    queueWithdrawal: (result: string): Q4WV3 => parseNative(result),
    dequeueWithdrawal: () => {},
    withdraw: (result: string): i128 => parseNative(result),
    forceQueueWithdrawal: (result: string): Q4WV3 => parseNative(result),
    forceWithdrawal: (result: string): i128 => parseNative(result),
    userBalance: (result: string): UserBalanceV3 => parseNative(result),
    poolData: (result: string): PoolBackstopDataV3 => parsePoolData(result),
    blntPrice: (result: string): i128 => parseNative(result),
    backstopToken: (result: string): string => parseNative(result),
    drop: () => {},
    distribute: (result: string): i128 => parseNative(result),
    claim: (result: string): i128 => parseNative(result),
    gulpEmissions: (result: string): i128 => parseNative(result),
    rewardZone: (result: string): string[] => parseNative(result),
    addReward: () => {},
    removeReward: () => {},
    draw: () => {},
    donate: () => {},
  };

  static deploy(
    deployer: string,
    wasmHash: Buffer | string,
    args: BackstopConstructorArgsV3,
    salt?: Buffer,
    format?: 'hex' | 'base64'
  ): string {
    const constructorArgs = [
      addressToScVal(args.blnd_usdc_token),
      addressToScVal(args.blnd_xlm_token),
      addressToScVal(args.emitter),
      addressToScVal(args.blnd_token),
      addressToScVal(args.usdc_token),
      addressToScVal(args.xlm_token),
      addressToScVal(args.pool_factory),
      xdr.ScVal.scvVec(
        args.drop_list.map(([recipient, amount]) =>
          xdr.ScVal.scvVec([addressToScVal(recipient), i128ToScVal(amount)])
        )
      ),
    ];
    return Operation.createCustomContract({
      address: Address.fromString(deployer),
      wasmHash:
        typeof wasmHash === 'string'
          ? Buffer.from(wasmHash, format ?? 'hex')
          : (wasmHash as Buffer),
      salt,
      constructorArgs,
    }).toXDR('base64');
  }

  constructor(address: string) {
    super(address);
  }

  deposit(args: TierBackstopActionArgsV3): string {
    return this.call(
      'deposit',
      tierToScVal(args.tier),
      addressToScVal(args.from),
      addressToScVal(args.pool_address),
      i128ToScVal(args.amount)
    ).toXDR('base64');
  }

  queueWithdrawal(args: TierBackstopActionArgsV3): string {
    return this.call(
      'queue_withdrawal',
      tierToScVal(args.tier),
      addressToScVal(args.from),
      addressToScVal(args.pool_address),
      i128ToScVal(args.amount)
    ).toXDR('base64');
  }

  dequeueWithdrawal(args: TierBackstopActionArgsV3): string {
    return this.call(
      'dequeue_withdrawal',
      tierToScVal(args.tier),
      addressToScVal(args.from),
      addressToScVal(args.pool_address),
      i128ToScVal(args.amount)
    ).toXDR('base64');
  }

  withdraw(args: TierBackstopWithdrawArgsV3): string {
    return this.call(
      'withdraw',
      tierToScVal(args.tier),
      addressToScVal(args.from),
      addressToScVal(args.pool_address),
      i128ToScVal(args.amount),
      addressToScVal(args.to)
    ).toXDR('base64');
  }

  forceQueueWithdrawal(args: ForcedBackstopExitArgsV3): string {
    return this.call(
      'force_queue_withdrawal',
      tierToScVal(args.tier),
      addressToScVal(args.user),
      addressToScVal(args.pool_address)
    ).toXDR('base64');
  }

  forceWithdrawal(args: ForcedBackstopExitArgsV3): string {
    return this.call(
      'force_withdrawal',
      tierToScVal(args.tier),
      addressToScVal(args.user),
      addressToScVal(args.pool_address)
    ).toXDR('base64');
  }

  userBalance(tier: BackstopTierV3, pool: Address | string, user: Address | string): string {
    return this.call(
      'user_balance',
      tierToScVal(tier),
      addressToScVal(pool),
      addressToScVal(user)
    ).toXDR('base64');
  }

  poolData(pool: Address | string): string {
    return this.call('pool_data', addressToScVal(pool)).toXDR('base64');
  }

  blntPrice(): string {
    return this.call('blnt_price').toXDR('base64');
  }

  backstopToken(tier: BackstopTierV3, pool: Address | string): string {
    return this.call('backstop_token', tierToScVal(tier), addressToScVal(pool)).toXDR('base64');
  }

  drop(): string {
    return this.call('drop').toXDR('base64');
  }

  distribute(): string {
    return this.call('distribute').toXDR('base64');
  }

  claim(args: BackstopClaimArgsV3): string {
    return this.call(
      'claim',
      tierToScVal(args.tier),
      addressToScVal(args.from),
      addressesToScVal(args.pool_addresses),
      i128ToScVal(args.min_lp_tokens_out)
    ).toXDR('base64');
  }

  gulpEmissions(pool: Address | string): string {
    return this.call('gulp_emissions', addressToScVal(pool)).toXDR('base64');
  }

  rewardZone(): string {
    return this.call('reward_zone').toXDR('base64');
  }

  addReward(to_add: Address | string, to_remove?: Address | string): string {
    return this.call('add_reward', addressToScVal(to_add), optionAddressToScVal(to_remove)).toXDR(
      'base64'
    );
  }

  removeReward(to_remove: Address | string): string {
    return this.call('remove_reward', addressToScVal(to_remove)).toXDR('base64');
  }

  draw(
    tier: BackstopTierV3,
    pool_address: Address | string,
    amount: i128,
    to: Address | string
  ): string {
    return this.call(
      'draw',
      tierToScVal(tier),
      addressToScVal(pool_address),
      i128ToScVal(amount),
      addressToScVal(to)
    ).toXDR('base64');
  }

  donate(args: TierBackstopActionArgsV3): string {
    return this.call(
      'donate',
      tierToScVal(args.tier),
      addressToScVal(args.from),
      addressToScVal(args.pool_address),
      i128ToScVal(args.amount)
    ).toXDR('base64');
  }
}
