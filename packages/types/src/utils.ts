// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

// These imports must be as granular/narrow as possible to ensure they work in the sandbox
import type {rpc} from '@stellar/stellar-sdk';
import {encodeMuxedAccountToAddress, StrKey, xdr} from '@stellar/stellar-base';

export function getTransactionSourceAccount(tx: rpc.Api.TransactionInfo): string {
  // Use the name in the switch to avoid using the types directly as there could be conflicting package versions
  switch (tx.envelopeXdr.switch().name) {
    case xdr.EnvelopeType.envelopeTypeTxV0().name:
      return StrKey.encodeEd25519PublicKey(tx.envelopeXdr.v0().tx().sourceAccountEd25519());
    case xdr.EnvelopeType.envelopeTypeTx().name:
      return encodeMuxedAccountToAddress(tx.envelopeXdr.v1().tx().sourceAccount(), true);
    case xdr.EnvelopeType.envelopeTypeTxFeeBump().name:
      return encodeMuxedAccountToAddress(tx.envelopeXdr.feeBump().tx().feeSource(), true);
    default:
      throw new Error(`Unknown Transaction envelope type ${tx.envelopeXdr.switch().name}`);
  }
}
