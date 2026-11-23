import { xdr } from '@stellar/stellar-sdk';

// Protocol 30 mainnet ledger header returned by Soroban RPC getLatestLedger.
// Its StellarValue extension uses STELLAR_VALUE_SIGNED_MS (value 3).
const PROTOCOL_30_LEDGER_HEADER_XDR =
  'AAAAHroiSUyEQRo6HzJQOwpOAsmjSJmQJGdEoXLAtvZAwpQ2R+r0NaUGSboefa4HEAVZ/JXaVtB96VgE6WiiiC5wvq8AAAAAawR0IgAAAAAAAAADAAABogllpVYAAAAAS/g5ZXzPQg6PnPmZ0WOYNwuNDv9SdSW6Rgf8GgvFJx8AAABAymjCeojWhJV7NTdKviZ4YJmXcvHs23OVdG/2swE8v9KUhEbxbOJ4vxAGG7j8bB0hTm6MlceQOnX+WeYbEk/3BcmhGuxGH2C5xsiOWacorbGW4JCq3rNMGaTsMxAvddByPDzLwhXXUnbFYjyQR0fW3uJAiWraZAmeEvJ1H333KHED6X00DqIes+x5W2EAAGTUMmVzJQAAARYAAAAAb0yj3QAAAGQATEtAAAAD6HxubCm0OR+zTu4tkf82mSyU88K1bsHP+5bNTwgRc1r+2mBJ1ujkqH6YMW/Opp6NS3I0LWRcRD7xMM/OZ0zG8fZXN1BjG6+wzGG8/3nA73Xgq25hAUY9Ixd/bxZVyNSwm34Tx2EmkiOkdQW3vG3aDWviGzPDZNvk37cyFbMqTL+xAAAAAA==';

test('decodes Protocol 30 millisecond-resolution ledger headers', () => {
  const header = xdr.LedgerHeader.fromXdr(PROTOCOL_30_LEDGER_HEADER_XDR, 'base64');
  const stellarValueExt = header.scpValue.ext;

  expect(header.ledgerVersion).toEqual(30);
  expect(stellarValueExt.type).toEqual('stellarValueSignedMs');
  expect(stellarValueExt.signedMsValue.closeTimeMs.toString()).toEqual('1795453986134');
});
