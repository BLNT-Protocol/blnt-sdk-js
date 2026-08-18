import { Buffer } from 'buffer';
import { Keypair, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import { BackstopAssetV3, PoolFactoryContractV3 } from '../../src/index.js';

const factoryId = StrKey.encodeContract(Buffer.alloc(32, 1));
const poolId = StrKey.encodeContract(Buffer.alloc(32, 2));
const oracleId = StrKey.encodeContract(Buffer.alloc(32, 4));
const admin = Keypair.random().publicKey();

function invocation(operation: string): xdr.InvokeContractArgs {
  return xdr.Operation.fromXDR(operation, 'base64')
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();
}

describe('PoolFactoryContractV3', () => {
  test('encodes an ordered pool backstop configuration', () => {
    const factory = new PoolFactoryContractV3(factoryId);
    const deploy = invocation(
      factory.deployPool({
        admin,
        name: 'Configurable backstop',
        salt: Buffer.alloc(32, 5),
        oracle: oracleId,
        backstop_take_rate: 2_000_000,
        max_positions: 10,
        min_collateral: 100n,
        backstop_config: [
          {
            asset: BackstopAssetV3.BlndXlm,
            take_rate_weight: 4,
          },
          {
            asset: BackstopAssetV3.Usdc,
            take_rate_weight: 2,
          },
        ],
      })
    );

    expect(deploy.functionName().toString()).toEqual('deploy');
    expect(deploy.args()).toHaveLength(8);
    expect(scValToNative(deploy.args()[7])).toEqual([
      {
        asset: ['BlndXlm'],
        take_rate_weight: 4,
      },
      {
        asset: ['Usdc'],
        take_rate_weight: 2,
      },
    ]);
  });

  test('encodes factory reads with their v3 entrypoint names', () => {
    const factory = new PoolFactoryContractV3(factoryId);
    const isPool = invocation(factory.isPool(poolId));
    const config = invocation(factory.backstopConfig(poolId));

    expect(isPool.functionName().toString()).toEqual('is_pool');
    expect(scValToNative(isPool.args()[0])).toEqual(poolId);
    expect(config.functionName().toString()).toEqual('backstop_config');
    expect(scValToNative(config.args()[0])).toEqual(poolId);
  });
});
