import { Buffer } from 'buffer';
import { Keypair, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import {
  AccessControllerContract,
  ALL_ACCESS_PERMISSIONS,
  BACKSTOP_DEPOSIT_ALLOWED,
  RESERVE_BORROW_ALLOWED,
  RESERVE_SUPPLY_ALLOWED,
} from '../src/index.js';

const controllerId = StrKey.encodeContract(Buffer.alloc(32, 1));
const poolId = StrKey.encodeContract(Buffer.alloc(32, 2));
const userId = Keypair.random().publicKey();

test('encodes the thin access-controller interface and stable permission bits', () => {
  const operation = xdr.Operation.fromXDR(
    new AccessControllerContract(controllerId).permissions(poolId, userId),
    'base64'
  );
  const invocation = operation
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();

  expect(invocation.functionName().toString()).toEqual('permissions');
  expect(scValToNative(invocation.args()[0])).toEqual(poolId);
  expect(scValToNative(invocation.args()[1])).toEqual(userId);
  expect(RESERVE_SUPPLY_ALLOWED).toEqual(1);
  expect(RESERVE_BORROW_ALLOWED).toEqual(2);
  expect(BACKSTOP_DEPOSIT_ALLOWED).toEqual(4);
  expect(ALL_ACCESS_PERMISSIONS).toEqual(7);
});
