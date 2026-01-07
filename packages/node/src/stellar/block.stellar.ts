// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {scValToNative} from '@stellar/stellar-sdk';
import {filterBlockTimestamp} from '@subql/node-core';
import {
  StellarBlockFilter,
  StellarBlockWrapper,
  StellarEventFilter,
  StellarOperationFilter,
  StellarTransactionFilter,
  StellarBlock,
  StellarTransaction,
  StellarOperation,
  StellarEvent,
  getTransactionSourceAccount,
} from '@subql/types-stellar';
import {SubqlProjectBlockFilter} from '../configure/SubqueryProject';
import {stringNormalizedEq} from '../utils/string';
import {getBlockTimestamp} from './utils.stellar';

export class StellarBlockWrapped implements StellarBlockWrapper {
  constructor(
    private _block: StellarBlock,
    private _transactions: StellarTransaction[],
    private _operations: StellarOperation[],
    private _events: StellarEvent[],
  ) {}

  get block(): StellarBlock {
    return this._block;
  }

  get transactions(): StellarTransaction[] {
    return this._transactions;
  }

  get operations(): StellarOperation[] {
    return this._operations;
  }

  get events(): StellarEvent[] {
    return this._events;
  }

  static filterBlocksProcessor(block: StellarBlock, filter: StellarBlockFilter): boolean {
    if (!filter) return true;
    if (filter?.modulo && block.sequence % filter.modulo !== 0) {
      return false;
    }
    if (!filterBlockTimestamp(getBlockTimestamp(block).getTime(), filter as SubqlProjectBlockFilter)) {
      return false;
    }
    return true;
  }

  static filterTransactionProcessor(
    tx: StellarTransaction,
    filter: StellarTransactionFilter,
    address?: string,
  ): boolean {
    if (!filter) return true;

    const sourceAccount = getTransactionSourceAccount(tx.tx);
    if (filter.account && filter.account !== sourceAccount) {
      return false;
    }

    return true;
  }

  static filterOperationProcessor(op: StellarOperation, filter: StellarOperationFilter): boolean {
    if (!filter) return true;

    if (filter.type && filter.type !== op.operation.body().switch().name) {
      return false;
    }
    const sourceAccount = getTransactionSourceAccount(op.transaction.tx);
    if (filter.sourceAccount && sourceAccount !== null && filter.sourceAccount !== sourceAccount) {
      return false;
    }

    return true;
  }

  static filterEventProcessor(event: StellarEvent, filter: StellarEventFilter, address?: string): boolean {
    if (address && !stringNormalizedEq(address, event.event.contractId?.toString())) {
      return false;
    }

    if (!filter) return true;

    if (filter.contractId && filter.contractId !== event.event.contractId?.toString()) {
      return false;
    }

    if (filter.topics) {
      for (let i = 0; i < Math.min(filter.topics.length, 4); i++) {
        const topic = filter.topics[i];
        if (!topic) {
          continue;
        }

        if (!event.event.topic[i]) {
          return false;
        }
        if (topic !== scValToNative(event.event.topic[i])) {
          return false;
        }
      }
    }
    return true;
  }
}
