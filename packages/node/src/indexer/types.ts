// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {StellarBlockWrapper} from '@subql/types-stellar';

export type BestBlocks = Record<number, string>;

export function getBlockSize(block: StellarBlockWrapper): number {
  return block.block.transactions.length + block.block.operations.length;
}
