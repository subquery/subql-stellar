// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {Contract, encodeMuxedAccountToAddress, hash, rpc, StrKey, xdr} from '@stellar/stellar-sdk';
import {Header, IBlock} from '@subql/node-core';
import {StellarBlock, StellarBlockWrapper, StellarTransaction} from '@subql/types-stellar';

export function stellarBlockToHeader(block: StellarBlock | rpc.Api.LedgerResponse): Header {
  return {
    blockHeight: block.sequence,
    blockHash: block.hash,
    parentHash: block.headerXdr.header().previousLedgerHash().toString('hex'),
    timestamp: getBlockTimestamp(block),
  };
}

export function formatBlockUtil<B extends StellarBlockWrapper = StellarBlockWrapper>(block: B): IBlock<B> {
  return {
    block,
    getHeader: () => stellarBlockToHeader(block.block),
  };
}

export function calcInterval(): number {
  return 4000; // Stellar on average produces a block every 4 seconds
}

export const DEFAULT_PAGE_SIZE = 150;

export function getBlockTimestamp(block: rpc.Api.LedgerResponse): Date {
  return new Date(parseInt(block.ledgerCloseTime, 10) * 1000);
}

// Reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0035.md#specification
export function makeTOID(sequence: number, txIndex: number, opIndex: number): string {
  const L = BigInt(sequence);
  const T = BigInt(txIndex);
  const O = BigInt(opIndex);

  const L_mask = (1n << 32n) - 1n;
  const T_mask = (1n << 20n) - 1n;
  const O_mask = (1n << 12n) - 1n;

  return (((L & L_mask) << 32n) | ((T & T_mask) << 12n) | ((O & O_mask) << 0n)).toString().padStart(19, '0');
}

export function toidToParts(toidInput: bigint | string): {ledgerSeq: number; txIndex: number; opIndex: number} {
  const toid = typeof toidInput === 'string' ? BigInt(toidInput) : toidInput;

  const ledgerSeq = Number(toid >> 32n); // top 32 bits
  const txIndex = Number((toid >> 12n) & ((1n << 20n) - 1n)); // next 20 bits
  const opIndex = Number(toid & ((1n << 12n) - 1n)); // low 12 bits

  return {ledgerSeq, txIndex, opIndex};
}

/**
 * Converts a ContractEvent from TransactionInfo into an EventResponse
 * For transactionEventsXdr the txIndex and opIndex are always 0, eventIndex is the applicationOrder - 1
 */
export function contractEventToEventResponse(
  evt: xdr.ContractEvent,
  tx: rpc.Api.TransactionInfo,
  txIndex: number,
  opIndex: number,
  eventIndex: number,
  ledgerClosedAt: Date,
): rpc.Api.EventResponse {
  const rawContractId = evt.contractId();
  const contract = rawContractId ? new Contract(StrKey.encodeContract(rawContractId as any)) : undefined;

  const TOID = makeTOID(tx.ledger, txIndex, opIndex);

  return {
    type: rawContractId ? 'contract' : 'system', // TODO test system case
    ledger: tx.ledger,
    ledgerClosedAt: ledgerClosedAt.toISOString().replace(`.000Z`, 'Z'), // Strip MS
    id: `${TOID}-${String(eventIndex).padStart(10, '0')}`,
    operationIndex: opIndex,
    transactionIndex: txIndex,
    txHash: tx.txHash,
    inSuccessfulContractCall: tx.status === rpc.Api.GetTransactionStatus.SUCCESS, // TODO test with non successful values
    topic: evt.body().value().topics(),
    value: evt.body().value().data(),
    contractId: contract,
  } satisfies rpc.Api.EventResponse;
}

export function getResultEvents(meta: xdr.TransactionMeta): {
  events: rpc.Api.TransactionEvents;
  diagnosticEventsXdr?: xdr.DiagnosticEvent[];
} {
  // Cases are un tested, exept for v4. This is a matter of finding block with older versions
  // NOTE: waiting for clarification from Stellar TG whether events existed and need to be requested from other RPC requests
  switch (meta.switch()) {
    // case 0: {
    // }
    // case 1: {
    // }
    // case 2: {
    // }
    // case 3: {
    // }
    case 4: {
      return {
        diagnosticEventsXdr: meta.v4().diagnosticEvents().length ? meta.v4().diagnosticEvents() : undefined,
        events: {
          transactionEventsXdr: meta.v4().events(),
          contractEventsXdr: meta
            .v4()
            .operations()
            .map((op) => op.events()),
        },
      };
    }
    default: {
      throw new Error(`Unsupported transaction meta version: ${meta.switch()}`);
    }
  }
}

export function constructTransaction(
  ledger: rpc.Api.LedgerResponse,
  meta: xdr.LedgerCloseMetaV0 | xdr.LedgerCloseMetaV1 | xdr.LedgerCloseMetaV2,
  txEnvelope: xdr.TransactionEnvelope,
  idx: number,
): rpc.Api.TransactionInfo {
  const txp = meta.txProcessing()[idx];

  const status =
    txp.result().result().result().switch() === xdr.TransactionResultCode.txSuccess() ||
    txp.result().result().result().switch() === xdr.TransactionResultCode.txFeeBumpInnerSuccess()
      ? rpc.Api.GetTransactionStatus.SUCCESS
      : rpc.Api.GetTransactionStatus.FAILED;

  return {
    ...getResultEvents(txp.txApplyProcessing()),
    status,
    ledger: ledger.sequence,
    createdAt: parseInt(ledger.ledgerCloseTime, 10),
    applicationOrder: idx + 1, // Starts at 1
    feeBump:
      txEnvelope.switch() === xdr.EnvelopeType.envelopeTypeTxFeeBump() &&
      status === rpc.Api.GetTransactionStatus.SUCCESS,
    txHash: txp.result().transactionHash().toString('hex'),
    envelopeXdr: txEnvelope,
    resultXdr: txp.result().result(),
    resultMetaXdr: txp.txApplyProcessing(), // There needs to be some ordering here
  } satisfies rpc.Api.TransactionInfo;
}

export function calculateTxHash(txEnvelope: xdr.TransactionEnvelope, networkPassphrase: string): string {
  let taggedTransaction: xdr.TransactionSignaturePayloadTaggedTransaction;

  switch (txEnvelope.switch()) {
    case xdr.EnvelopeType.envelopeTypeTxV0(): {
      let tx = xdr.Transaction.fromXDR(
        Buffer.concat([
          // TransactionV0 is a transaction with the AccountID discriminant
          // stripped off, we need to put it back to build a valid transaction
          // which we can use to build a TransactionSignaturePayloadTaggedTransaction
          (xdr.PublicKeyType.publicKeyTypeEd25519() as any).toXDR(), // TODO missing type property?
          txEnvelope.v0().tx().toXDR(),
        ]),
      );
      taggedTransaction = xdr.TransactionSignaturePayloadTaggedTransaction.envelopeTypeTx(tx);
      break;
    }
    case xdr.EnvelopeType.envelopeTypeTx(): {
      taggedTransaction = xdr.TransactionSignaturePayloadTaggedTransaction.envelopeTypeTx(txEnvelope.v1().tx());
      break;
    }
    case xdr.EnvelopeType.envelopeTypeTxFeeBump(): {
      taggedTransaction = xdr.TransactionSignaturePayloadTaggedTransaction.envelopeTypeTxFeeBump(
        txEnvelope.feeBump().tx(),
      );
      break;
    }
    default: {
      throw new Error(`Unsupported transaction envelope type: ${txEnvelope.switch()}`);
    }
  }

  const txSignature = new xdr.TransactionSignaturePayload({
    networkId: xdr.Hash.fromXDR(hash(Buffer.from(networkPassphrase, 'utf-8'))),
    taggedTransaction,
  });

  return hash(txSignature.toXDR()).toString('hex');
}
