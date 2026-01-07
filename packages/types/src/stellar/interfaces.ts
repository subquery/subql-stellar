// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import type {Operation, rpc, xdr} from '@stellar/stellar-sdk';

export type StellarBlock = rpc.Api.LedgerResponse & {
  transactions: StellarTransaction[];
  operations: StellarOperation[];
  events: StellarEvent[];
};

export type StellarTransaction = {
  tx: rpc.Api.TransactionInfo;
  events: rpc.Api.EventResponse[];
};

export type StellarOperation<O extends Operation = Operation> = {
  /**
   * The index of the operation within the transaction
   **/
  index: number;
  /**
   * The xdr operation as you would get from the stellar RPC
   **/
  operation: xdr.Operation<O>;
  transaction: StellarTransaction;
};
export type StellarEvent = {
  event: rpc.Api.EventResponse;
  block: StellarBlock;
  tx: rpc.Api.TransactionInfo;
};

export interface StellarBlockFilter {
  modulo?: number;
  timestamp?: string;
}

export interface StellarTransactionFilter {
  account?: string;
}

export interface StellarOperationFilter {
  type?: xdr.OperationType['name'];
  sourceAccount?: string;
}

export interface StellarEventFilter {
  contractId?: string;
  topics?: string[];
}

export type StellarBlockWrapper = {
  block: StellarBlock;
  transactions: StellarTransaction[];
  operations: StellarOperation[];
  events: StellarEvent[];
};
