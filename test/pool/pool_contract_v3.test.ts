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
});
