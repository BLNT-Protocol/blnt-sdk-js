import { Buffer } from 'buffer';
import { Keypair, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import { PoolContractV3 } from '../../src/index.js';

const poolId = StrKey.encodeContract(Buffer.alloc(32, 1));
const assetId = StrKey.encodeContract(Buffer.alloc(32, 2));
const userId = Keypair.random().publicKey();

function invocation(operation: string): xdr.InvokeContractArgs {
  return xdr.Operation.fromXDR(operation, 'base64')
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();
}

describe('PoolContractV3', () => {
  test('encodes the optional access controller in the constructor', () => {
    const operation = xdr.Operation.fromXDR(
      PoolContractV3.deploy(Keypair.random().publicKey(), Buffer.alloc(32, 9), {
        admin: userId,
        name: 'Permissioned pool',
        oracle: assetId,
        bstop_rate: 2_000_000,
        max_positions: 10,
        min_collateral: 100n,
        backstop_id: poolId,
        blnd_id: assetId,
      }),
      'base64'
    );
    const constructorArgs = operation
      .body()
      .invokeHostFunctionOp()
      .hostFunction()
      .createContractV2()
      .constructorArgs();

    expect(constructorArgs).toHaveLength(9);
    expect(scValToNative(constructorArgs[8])).toBeNull();
  });

  test('encodes reserve clawback with the v3 ABI', () => {
    const clawback = invocation(
      new PoolContractV3(poolId).clawback({
        asset: assetId,
        from: userId,
        amount: 25n,
      })
    );

    expect(clawback.functionName().toString()).toEqual('clawback');
    expect(clawback.args()).toHaveLength(3);
    expect(scValToNative(clawback.args()[0])).toEqual(assetId);
    expect(scValToNative(clawback.args()[1])).toEqual(userId);
    expect(scValToNative(clawback.args()[2])).toEqual(25n);
  });

  test('encodes reserve-loss reconciliation with the v3 ABI', () => {
    const reconcileLoss = invocation(new PoolContractV3(poolId).reconcileLoss(assetId));

    expect(reconcileLoss.functionName().toString()).toEqual('reconcile_loss');
    expect(reconcileLoss.args()).toHaveLength(1);
    expect(scValToNative(reconcileLoss.args()[0])).toEqual(assetId);
  });

  test('encodes permission-revocation exits with the v3 ABI', () => {
    const pool = new PoolContractV3(poolId);
    const withdrawal = invocation(pool.forceWithdrawal({ user: userId, asset: assetId }));
    expect(withdrawal.functionName().toString()).toEqual('force_withdrawal');
    expect(withdrawal.args()).toHaveLength(2);
    expect(scValToNative(withdrawal.args()[0])).toEqual(userId);
    expect(scValToNative(withdrawal.args()[1])).toEqual(assetId);

    const borrowerExit = invocation(pool.newForcedExitAuction(userId));
    expect(borrowerExit.functionName().toString()).toEqual('new_forced_exit_auction');
    expect(borrowerExit.args()).toHaveLength(1);
    expect(scValToNative(borrowerExit.args()[0])).toEqual(userId);
  });
});
