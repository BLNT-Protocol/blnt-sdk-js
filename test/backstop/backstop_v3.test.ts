import { Buffer } from 'buffer';
import {
  BackstopContractV3,
  decodeMigrationStateV3,
  estimatePoolClaimableV3,
  BackstopPoolV3,
  BackstopTierV3,
  decodeInterestReserveStateV3,
  MigrationStatusV3,
  PoolBackstopDataV3,
} from '../../src/index.js';
import { Address, Keypair, nativeToScVal, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';

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

function tierData(value: bigint, tokens: bigint, shares: bigint) {
  return {
    tokens,
    shares,
    value,
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

  test('decodes exact v3 migration state from contract-instance storage', () => {
    const migrationKey = (name: string) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
    const storage = [
      new xdr.ScMapEntry({ key: migrationKey('BackfillEnd'), val: u64(500n) }),
      mapEntry('BlndBound', xdr.ScVal.scvBool(true)),
      mapEntry('BFundAmt', i128(1_000n)),
      new xdr.ScMapEntry({ key: migrationKey('MigrationEpochStart'), val: u64(100n) }),
      new xdr.ScMapEntry({ key: migrationKey('ScheduledBackfill'), val: i128(1_000n) }),
      mapEntry('Emitter', Address.fromString(contractId).toScVal()),
    ];

    expect(decodeMigrationStateV3(storage)).toEqual({
      activated_at: undefined,
      backfill_end: 500n,
      blnd_binding_verified: true,
      funded_backfill: 1_000n,
      migration_epoch_start: 100n,
      scheduled_backfill: 1_000n,
      status: MigrationStatusV3.Open,
      verified_queue_unlock: undefined,
    });

    storage.push(new xdr.ScMapEntry({ key: migrationKey('ActivatedAt'), val: u64(600n) }));
    expect(decodeMigrationStateV3(storage).status).toEqual(MigrationStatusV3.Active);
  });

  test('keeps tier exchange rates and values independent', () => {
    const data: PoolBackstopDataV3 = {
      active_value: 8_100n,
      blnd_xlm: tierData(4_000n, 2_000n, 1_000n),
      blnd_usdc: tierData(3_000n, 3_000n, 1_500n),
      usdc: tierData(2_000n, 2_000n, 2_000n),
      q4w_pct: 1_000_000n,
    };
    const pool = new BackstopPoolV3(data, 123);

    expect(pool.tier(BackstopTierV3.BlndXlm).sharesToTokens(250n)).toEqual(500n);
    expect(pool.tier(BackstopTierV3.BlndUsdc).sharesToTokens(250n)).toEqual(500n);
    expect(pool.tier(BackstopTierV3.Usdc).sharesToTokens(250n)).toEqual(250n);
    expect(pool.totalActiveValue()).toEqual(8_100n);
    expect(pool.totalValue()).toEqual(9_000n);
  });

  test('estimates v3 backstop BLND without contract-internal carry', () => {
    expect(
      estimatePoolClaimableV3(
        {
          emission: {
            expiration: 10n,
            eps: 20_000_000n,
            index: 0n,
            last_time: 0n,
          },
          pool_queued_shares: 0n,
          pool_shares: 100_000_000n,
          user_emission: { accrued: 3n, index: 0n },
          user_shares: 50_000_000n,
        },
        10n
      )
    ).toEqual(13n);

    expect(
      estimatePoolClaimableV3(
        {
          pool_queued_shares: 0n,
          pool_shares: 0n,
          user_emission: { accrued: 17n, index: 42n },
          user_shares: 0n,
        },
        10n
      )
    ).toEqual(17n);
  });

  test('decodes v3 interest-reserve state from persistent storage', () => {
    const encoded = xdr.ScVal.scvMap([
      mapEntry('blnd_usdc', i128(3n)),
      mapEntry('blnd_xlm', i128(4n)),
      mapEntry('carry', i128(1n)),
      mapEntry('usdc', i128(2n)),
    ]);
    expect(decodeInterestReserveStateV3(encoded)).toEqual({
      blnd_usdc: 3n,
      blnd_xlm: 4n,
      carry: 1n,
      usdc: 2n,
    });
    expect(decodeInterestReserveStateV3()).toEqual({
      blnd_usdc: 0n,
      blnd_xlm: 0n,
      carry: 0n,
      usdc: 0n,
    });
    expect(() =>
      decodeInterestReserveStateV3(
        xdr.ScVal.scvMap([
          mapEntry('blnd_usdc', i128(-1n)),
          mapEntry('blnd_xlm', i128(0n)),
          mapEntry('carry', i128(0n)),
          mapEntry('usdc', i128(0n)),
        ])
      )
    ).toThrow('Invalid v3 interest-reserve state');
    expect(() => decodeInterestReserveStateV3(xdr.ScVal.scvBool(true))).toThrow(
      'Invalid v3 interest-reserve state'
    );
  });
});
