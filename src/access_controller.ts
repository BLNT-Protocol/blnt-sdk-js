import { Address, Contract, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { Network } from './index.js';
import { simulateAndParse } from './simulation_helper.js';

export const RESERVE_SUPPLY_ALLOWED = 1 << 0;
export const RESERVE_BORROW_ALLOWED = 1 << 1;
export const BACKSTOP_DEPOSIT_ALLOWED = 1 << 2;
export const ALL_ACCESS_PERMISSIONS =
  RESERVE_SUPPLY_ALLOWED | RESERVE_BORROW_ALLOWED | BACKSTOP_DEPOSIT_ALLOWED;

function addressToScVal(address: Address | string): xdr.ScVal {
  return typeof address === 'string' ? Address.fromString(address).toScVal() : address.toScVal();
}

/** Adapter for the sole interface Blend requires from an external pool access controller. */
export class AccessControllerContract extends Contract {
  static readonly parsers = {
    permissions: (result: string): number =>
      scValToNative(xdr.ScVal.fromXDR(result, 'base64')) as number,
  };

  permissions(pool: Address | string, user: Address | string): string {
    return this.call('permissions', addressToScVal(pool), addressToScVal(user)).toXDR('base64');
  }
}

/** Read one user's pool-local flags through the controller's sole required ABI. */
export async function loadAccessPermissions(
  network: Network,
  controller: Address | string,
  pool: Address | string,
  user: Address | string
): Promise<{ permissions: number; latestLedger: number }> {
  const contract = new AccessControllerContract(
    typeof controller === 'string' ? controller : controller.toString()
  );
  const response = await simulateAndParse(
    network,
    contract.permissions(pool, user),
    AccessControllerContract.parsers.permissions
  );
  return { permissions: response.result, latestLedger: response.latestLedger };
}
