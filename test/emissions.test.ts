import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  EmissionConfig,
  EmissionData,
  EmissionDataV2,
  EmissionDataV3,
  EmissionsV1,
  UserEmissions,
} from '../src/emissions.js';

test('load emissions for pool and user', () => {
  const config_xdr_string =
    'AAAABgAAAAAAAAABbH7xyqK9TSdA4nUSJJgPtdaQojola63Pjoeh+LNvtzQAAAAQAAAAAQAAAAIAAAAPAAAACkVtaXNDb25maWcAAAAAAAMAAAADAAAAAQAAABEAAAABAAAAAgAAAA8AAAADZXBzAAAAAAUAAAAAAA27oAAAAA8AAAAKZXhwaXJhdGlvbgAAAAAABQAAAABlVmCs';
  const data_xdr_string =
    'AAAABgAAAAAAAAABbH7xyqK9TSdA4nUSJJgPtdaQojola63Pjoeh+LNvtzQAAAAQAAAAAQAAAAIAAAAPAAAACEVtaXNEYXRhAAAAAwAAAAMAAAABAAAAEQAAAAEAAAACAAAADwAAAAVpbmRleAAAAAAAAAoAAAAAAAAAAAAAAAACUpz/AAAADwAAAAlsYXN0X3RpbWUAAAAAAAAFAAAAAGVSMp8=';
  const user_xdr_string =
    'AAAABgAAAAAAAAABbH7xyqK9TSdA4nUSJJgPtdaQojola63Pjoeh+LNvtzQAAAAQAAAAAQAAAAIAAAAPAAAACFVzZXJFbWlzAAAAEQAAAAEAAAACAAAADwAAAApyZXNlcnZlX2lkAAAAAAADAAAAAwAAAA8AAAAEdXNlcgAAABIAAAAAAAAAACyfzOsG6kr4egXEnuSiQ/GlhwkxRxrt2FCrVKgB9OblAAAAAQAAABEAAAABAAAAAgAAAA8AAAAHYWNjcnVlZAAAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAFaW5kZXgAAAAAAAAKAAAAAAAAAAAAAAAAAlKc/w==';

  const config = EmissionConfig.fromLedgerEntryData(config_xdr_string);
  const data = EmissionData.fromLedgerEntryData(data_xdr_string);
  const emissions = new EmissionsV1(config, data, 1);
  const user = UserEmissions.fromLedgerEntryData(user_xdr_string);

  expect(config.eps).toEqual(BigInt(900000));
  expect(config.expiration).toEqual(1700159660);
  expect(data.index).toEqual(BigInt(38968575));
  expect(data.lastTime).toEqual(1699885727);
  expect(user.accrued).toEqual(BigInt(0));
  expect(user.index).toEqual(BigInt(38968575));

  const supply = BigInt(235026470698);
  const balance = BigInt(9986916470);
  const timestamp = 1699888478;

  emissions.accrue(supply, 7, timestamp);
  const accrued = user.estimateAccrual(emissions, 7, balance);
  expect(accrued).toEqual(10.5207171);
});

test('v3 reserve emissions accept internal carry fields without weakening v2 parsing', () => {
  const mapEntry = (key: string, value: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: value });
  const ledgerEntry = xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      contract: Address.fromString(
        'CC6W2UPMNMBTFTIUECXVYUBUF7HZ5C3R3U6XCOHGF5JO4M5OJAS4YKPU'
      ).toScAddress(),
      key: xdr.ScVal.scvSymbol('EmisData'),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvMap([
        mapEntry('carry_initialized', xdr.ScVal.scvBool(true)),
        mapEntry('eps', nativeToScVal(5n, { type: 'u64' })),
        mapEntry('expiration', nativeToScVal(10n, { type: 'u64' })),
        mapEntry('index', nativeToScVal(3n, { type: 'i128' })),
        mapEntry('index_carry', nativeToScVal(1n, { type: 'i128' })),
        mapEntry('last_time', nativeToScVal(2n, { type: 'u64' })),
        mapEntry('remaining', nativeToScVal(4n, { type: 'i128' })),
      ]),
    })
  );

  expect(() => EmissionDataV2.fromLedgerEntryData(ledgerEntry)).toThrow(
    'EmissionData invalid key: should not contain carry_initialized'
  );
  expect(EmissionDataV3.fromLedgerEntryData(ledgerEntry)).toMatchObject({
    expiration: 10,
    eps: 5n,
    index: 3n,
    lastTime: 2,
  });
});
