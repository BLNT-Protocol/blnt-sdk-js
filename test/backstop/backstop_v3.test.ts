import { Buffer } from 'buffer';
import {
  BackstopContractV3,
  BackstopPoolV3,
  BackstopTierV3,
  MigrationStatusV3,
  PoolBackstopDataV3,
  PoolContractV3,
} from '../../src/index.js';
import { Keypair, nativeToScVal, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';

const contractId = StrKey.encodeContract(Buffer.alloc(32, 1));
const poolId = StrKey.encodeContract(Buffer.alloc(32, 2));
const userId = Keypair.random().publicKey();

function invocation(operation: string): xdr.InvokeContractArgs {
  return xdr.Operation.fromXDR(operation, 'base64')
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();
}

function mapEntry(name: string, value: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val: value });
}

function i128(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: 'i128' });
}

function u64(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: 'u64' });
}

function tierData(activeValue: bigint, assets: bigint, shares: bigint, queuedShares: bigint) {
  return {
    active_blnd: 0n,
    active_value: activeValue,
    assets,
    queued_shares: queuedShares,
    queued_value: 0n,
    shares,
    total_value: activeValue,
  };
}

describe('Blend v3 SDK adapters', () => {
  test('encodes tier-aware backstop operations with the v3 ABI', () => {
    const contract = new BackstopContractV3(contractId);
    const deposit = invocation(
      contract.deposit({
        tier: BackstopTierV3.BlndXlm,
        from: userId,
        pool_address: poolId,
        amount: 25n,
      })
    );

    expect(deposit.functionName().toString()).toEqual('deposit');
    expect(deposit.args()).toHaveLength(4);
    expect(deposit.args()[0].vec()?.[0].sym().toString()).toEqual('BlndXlm');
    expect(scValToNative(deposit.args()[1])).toEqual(userId);
    expect(scValToNative(deposit.args()[2])).toEqual(poolId);
    expect(scValToNative(deposit.args()[3])).toEqual(25n);

    const claim = invocation(
      contract.claim({
        tier: BackstopTierV3.BlndUsdc,
        from: userId,
        pool_addresses: [poolId],
        min_lp_tokens_out: 10n,
      })
    );
    expect(claim.functionName().toString()).toEqual('claim');
    expect(claim.args()[0].vec()?.[0].sym().toString()).toEqual('BlndUsdc');
    expect(claim.args()[2].vec()).toHaveLength(1);
    expect(scValToNative(claim.args()[3])).toEqual(10n);

    const withdrawal = invocation(
      contract.withdraw({
        tier: BackstopTierV3.Usdc,
        from: userId,
        pool_address: poolId,
        amount: 5n,
        to: userId,
      })
    );
    expect(withdrawal.functionName().toString()).toEqual('withdraw');
    expect(withdrawal.args()).toHaveLength(5);
    expect(withdrawal.args()[0].vec()?.[0].sym().toString()).toEqual('Usdc');
  });

  test('parses the public v3 migration state', () => {
    const encoded = xdr.ScVal.scvMap([
      mapEntry('activated_at', xdr.ScVal.scvVoid()),
      mapEntry('backfill_end', u64(500n)),
      mapEntry('blnd_binding_verified', xdr.ScVal.scvBool(true)),
      mapEntry('funded_backfill', i128(1_000n)),
      mapEntry('migration_epoch_start', u64(100n)),
      mapEntry('scheduled_backfill', i128(1_000n)),
      mapEntry('status', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Open')])),
      mapEntry('verified_queue_unlock', xdr.ScVal.scvVoid()),
    ]);

    expect(BackstopContractV3.parsers.migrationState(encoded.toXDR('base64'))).toEqual({
      activated_at: undefined,
      backfill_end: 500n,
      blnd_binding_verified: true,
      funded_backfill: 1_000n,
      migration_epoch_start: 100n,
      scheduled_backfill: 1_000n,
      status: MigrationStatusV3.Open,
      verified_queue_unlock: undefined,
    });
  });

  test('keeps tier exchange rates and values independent', () => {
    const data: PoolBackstopDataV3 = {
      blnd_xlm: tierData(4_000n, 2_000n, 1_000n, 100n),
      blnd_usdc: tierData(3_000n, 3_000n, 1_500n, 200n),
      usdc: tierData(2_000n, 2_000n, 2_000n, 300n),
      q4w_percentage: 1_000_000n,
    };
    const pool = new BackstopPoolV3(data, 123);

    expect(pool.tier(BackstopTierV3.BlndXlm).sharesToTokens(250n)).toEqual(500n);
    expect(pool.tier(BackstopTierV3.BlndUsdc).sharesToTokens(250n)).toEqual(500n);
    expect(pool.tier(BackstopTierV3.Usdc).sharesToTokens(250n)).toEqual(250n);
    expect(pool.totalActiveValue()).toEqual(9_000n);
  });

  test('encodes and parses the v3 interest-reserve view', () => {
    const contract = new PoolContractV3(contractId);
    const view = invocation(contract.interestReserveState(poolId));
    expect(view.functionName().toString()).toEqual('interest_reserve_state');
    expect(scValToNative(view.args()[0])).toEqual(poolId);

    const encoded = xdr.ScVal.scvMap([
      mapEntry('blnd_usdc', i128(3n)),
      mapEntry('blnd_xlm', i128(4n)),
      mapEntry('carry', i128(1n)),
      mapEntry('usdc', i128(2n)),
    ]);
    expect(PoolContractV3.parsers.interestReserveState(encoded.toXDR('base64'))).toEqual({
      blnd_usdc: 3n,
      blnd_xlm: 4n,
      carry: 1n,
      usdc: 2n,
    });
  });
});
