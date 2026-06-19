import { toFixed } from '../../src/math.js';
import { ReserveV1, ReserveV2 } from '../../src/pool/reserve.js';
import { ReserveConfig, ReserveData } from '../../src/pool/reserve_types.js';

test('reserve accrual', () => {
  const config = new ReserveConfig(
    0, // index
    7, // decimals
    7500000, // c_factor
    7500000, // l_factor
    7500000, // util
    9500000, // max_util
    100000, // r_base
    500000, // r_one
    5000000, // r_two
    1_5000000, // r_three
    20 // reactivity
  );
  const data = new ReserveData(
    BigInt(1_345_678_123), // d_rate
    BigInt(1_123_456_789), // b_rate
    BigInt(1e9), // ir_mod
    BigInt(65_0000000), // d_supply
    BigInt(99_0000000), // b_supply
    BigInt(0), // backstop_credit
    0 // last_time
  );

  const timestamp = 123456 * 5;
  const take_rate = toFixed(0.2, 7);
  const reserve = new ReserveV1(
    'poolId',
    'assetId',
    config,
    data,
    undefined,
    undefined,
    0,
    0,
    0,
    0,
    123
  );
  reserve.accrue(take_rate, timestamp);

  expect(reserve.data.dRate).toEqual(BigInt(1_349_657_800));
  expect(reserve.data.bRate).toEqual(BigInt(1_125_547_124));
  expect(reserve.data.interestRateModifier).toEqual(BigInt(1_044_981_563));
  expect(reserve.data.dSupply).toEqual(BigInt(65_0000000));
  expect(reserve.data.bSupply).toEqual(BigInt(99_0000000));
  expect(reserve.data.backstopCredit).toEqual(BigInt(517358));
  expect(reserve.data.lastTime).toEqual(617280);
  expect(reserve.borrowApr).toEqual(0.1510883);
  expect(reserve.estBorrowApy).toBeCloseTo(0.163064, 4);
  expect(reserve.supplyApr).toEqual(0.0950569);
  expect(reserve.estSupplyApy).toBeCloseTo(0.099626, 4);
});

test('reserve accrual no supplied', () => {
  const config = new ReserveConfig(
    0, // index
    7, // decimals
    7500000, // c_factor
    7500000, // l_factor
    7500000, // util
    9500000, // max_util
    100000, // r_base
    500000, // r_one
    5000000, // r_two
    1_5000000, // r_three
    20 // reactivity
  );
  const data = new ReserveData(
    BigInt(0), // d_rate
    BigInt(0), // b_rate
    BigInt(1e9), // ir_mod
    BigInt(0), // d_supply
    BigInt(0), // b_supply
    BigInt(0), // backstop_credit
    0 // last_time
  );

  const timestamp = 123456 * 5;
  const take_rate = toFixed(0.2, 7);
  const reserve = new ReserveV1(
    'poolId',
    'assetId',
    config,
    data,
    undefined,
    undefined,
    0,
    0,
    0,
    0,
    123
  );
  reserve.accrue(take_rate, timestamp);

  expect(reserve.data.dRate).toEqual(BigInt(0));
  expect(reserve.data.bRate).toEqual(BigInt(0));
  expect(reserve.data.interestRateModifier).toEqual(BigInt(1_000_000_000));
  expect(reserve.data.dSupply).toEqual(BigInt(0));
  expect(reserve.data.bSupply).toEqual(BigInt(0));
  expect(reserve.data.backstopCredit).toEqual(BigInt(0));
  expect(reserve.data.lastTime).toEqual(617280);
  expect(reserve.borrowApr).toEqual(0.01);
  expect(reserve.supplyApr).toEqual(0);
});

test('reserve accrual v2', () => {
  const config = new ReserveConfig(
    0, // index
    7, // decimals
    7500000, // c_factor
    7500000, // l_factor
    7500000, // util
    9500000, // max_util
    100000, // r_base
    500000, // r_one
    5000000, // r_two
    1_5000000, // r_three
    20 // reactivity
  );
  const data = new ReserveData(
    BigInt(1_345_678_123_000), // d_rate
    BigInt(1_123_456_789_000), // b_rate
    BigInt(1e7), // ir_mod
    BigInt(65_0000000), // d_supply
    BigInt(99_0000000), // b_supply
    BigInt(0), // backstop_credit
    0 // last_time
  );

  const timestamp = 123456 * 5;
  const take_rate = toFixed(0.2, 7);
  const reserve = new ReserveV2(
    'poolId',
    'assetId',
    config,
    data,
    undefined,
    undefined,
    0,
    0,
    0,
    0,
    123
  );
  reserve.accrue(take_rate, timestamp);

  expect(reserve.data.dRate).toEqual(BigInt(1_349_657_798_173));
  expect(reserve.data.bRate).toEqual(BigInt(1_125_547_124_242));
  expect(reserve.data.interestRateModifier).toEqual(BigInt(1_0449815));
  expect(reserve.data.dSupply).toEqual(BigInt(65_0000000));
  expect(reserve.data.bSupply).toEqual(BigInt(99_0000000));
  expect(reserve.data.backstopCredit).toEqual(BigInt(517357));
  expect(reserve.data.lastTime).toEqual(617280);
  expect(reserve.borrowApr).toEqual(0.1510883);
  expect(reserve.estBorrowApy).toBeCloseTo(0.163064, 4);
  expect(reserve.supplyApr).toEqual(0.0950569);
  expect(reserve.estSupplyApy).toBeCloseTo(0.099626, 4);
});

test('reserve v2 utilization uses 7 decimals for non-7 decimal assets', () => {
  const config = new ReserveConfig(
    0, // index
    18, // decimals
    7500000, // c_factor
    7500000, // l_factor
    7500000, // util
    9500000, // max_util
    100000, // r_base
    500000, // r_one
    5000000, // r_two
    1_5000000, // r_three
    20 // reactivity
  );
  const assetScalar = 10n ** 18n;
  const data = new ReserveData(
    BigInt(1_000_000_000_000), // d_rate
    BigInt(1_000_000_000_000), // b_rate
    BigInt(1e7), // ir_mod
    BigInt(65) * assetScalar, // d_supply
    BigInt(100) * assetScalar, // b_supply
    BigInt(0), // backstop_credit
    0 // last_time
  );

  const take_rate = toFixed(0.2, 7);
  const reserve = new ReserveV2(
    'poolId',
    'assetId',
    config,
    data,
    undefined,
    undefined,
    0,
    0,
    0,
    0,
    123
  );

  const curIr = reserve.setRates(take_rate);

  expect(reserve.getUtilization()).toEqual(BigInt(6_500_000));
  expect(reserve.getUtilizationFloat()).toEqual(0.65);
  expect(curIr).toEqual(BigInt(533334));
  expect(reserve.borrowApr).toEqual(0.0533334);
  expect(reserve.supplyApr).toEqual(0.0277333);
});

test('reserve v2 zero utilization applies interest rate modifier with zero target utilization', () => {
  const config = new ReserveConfig(
    0, // index
    7, // decimals
    7500000, // c_factor
    7500000, // l_factor
    0, // util
    9500000, // max_util
    100000, // r_base
    500000, // r_one
    5000000, // r_two
    1_5000000, // r_three
    20 // reactivity
  );
  const data = new ReserveData(
    BigInt(1_000_000_000_000), // d_rate
    BigInt(1_000_000_000_000), // b_rate
    toFixed(1.5, 7), // ir_mod
    BigInt(0), // d_supply
    BigInt(100_0000000), // b_supply
    BigInt(0), // backstop_credit
    0 // last_time
  );

  const reserve = new ReserveV2(
    'poolId',
    'assetId',
    config,
    data,
    undefined,
    undefined,
    0,
    0,
    0,
    0,
    123
  );

  const curIr = reserve.setRates(toFixed(0.2, 7));

  expect(reserve.getUtilization()).toEqual(BigInt(0));
  expect(curIr).toEqual(BigInt(150000));
  expect(reserve.borrowApr).toEqual(0.015);
  expect(reserve.estBorrowApy).toBeCloseTo(0.015113, 6);
  expect(reserve.supplyApr).toEqual(0);
  expect(reserve.estSupplyApy).toEqual(0);
});
