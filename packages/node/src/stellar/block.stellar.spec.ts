// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {nativeToScVal, Contract, xdr, rpc, Operation} from '@stellar/stellar-sdk';
import {
  StellarBlockFilter,
  StellarOperationFilter,
  StellarTransaction,
  StellarTransactionFilter,
  StellarOperation,
  StellarEvent,
  StellarBlock,
} from '@subql/types-stellar';
import {StellarBlockWrapped} from './block.stellar';

const testAddress = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
const testSourceAccount = 'GAJ7ZNAZOWGPIFOEHBPQZIHQQM265OIUY55E6CBFRO56JKGBB7J7U7XI';
describe('StellarBlockWrapped', () => {
  let tx: StellarTransaction;

  beforeEach(async () => {
    const server = new rpc.Server('https://rpc-futurenet.stellar.org');

    // Use a simple valid XDR string for testing
    const metaV4Xdr =
      'AAAAAgAAAAIAAAADAtL5awAAAAAAAAAAS0CFMhOtWUKJWerx66zxkxORaiH6/3RUq7L8zspD5RoAAAAAAcm9QAKVkpMAAHpMAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAwAAAAAC0vi5AAAAAGTB02oAAAAAAAAAAQLS+WsAAAAAAAAAAEtAhTITrVlCiVnq8eus8ZMTkWoh+v90VKuy/M7KQ+UaAAAAAAHJvUAClZKTAAB6TQAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAMAAAAAAtL5awAAAABkwdd1AAAAAAAAAAEAAAAGAAAAAwLS+VQAAAACAAAAAG4cwu71zHNXx3jHCzRGOIthcnfwRgfN2f/AoHFLLMclAAAAAEySDkgAAAAAAAAAAkJVU0lORVNTAAAAAAAAAAC3JfDeo9vreItKNPoe74EkFIqWybeUQNFvLvURhHtskAAAAAAeQtHTL5f6TAAAXH0AAAAAAAAAAAAAAAAAAAABAtL5awAAAAIAAAAAbhzC7vXMc1fHeMcLNEY4i2Fyd/BGB83Z/8CgcUssxyUAAAAATJIOSAAAAAAAAAACQlVTSU5FU1MAAAAAAAAAALcl8N6j2+t4i0o0+h7vgSQUipbJt5RA0W8u9RGEe2yQAAAAAB5C0dNHf4CAAACLCQAAAAAAAAAAAAAAAAAAAAMC0vlUAAAAAQAAAABuHMLu9cxzV8d4xws0RjiLYXJ38EYHzdn/wKBxSyzHJQAAAAJCVVNJTkVTUwAAAAAAAAAAtyXw3qPb63iLSjT6Hu+BJBSKlsm3lEDRby71EYR7bJAAAAAAAABAL3//////////AAAAAQAAAAEAE3H3TnhnuQAAAAAAAAAAAAAAAAAAAAAAAAABAtL5awAAAAEAAAAAbhzC7vXMc1fHeMcLNEY4i2Fyd/BGB83Z/8CgcUssxyUAAAACQlVTSU5FU1MAAAAAAAAAALcl8N6j2+t4i0o0+h7vgSQUipbJt5RA0W8u9RGEe2yQAAAAAAAAQC9//////////wAAAAEAAAABABNx9J6Z4RkAAAAAAAAAAAAAAAAAAAAAAAAAAwLS+WsAAAAAAAAAAG4cwu71zHNXx3jHCzRGOIthcnfwRgfN2f/AoHFLLMclAAAAH37+zXQCXdRTAAASZAAAApIAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAEAAABbBXKIigAAABhZWyiOAAAAAgAAAAAAAAAAAAAAAAAAAAMAAAAAAtL0awAAAABkwbqrAAAAAAAAAAEC0vlrAAAAAAAAAABuHMLu9cxzV8d4xws0RjiLYXJ38EYHzdn/wKBxSyzHJQAAAB9+/s10Al3UUwAAEmQAAAKSAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAABAAAAWwVyiIoAAAAYWVsojgAAAAIAAAAAAAAAAAAAAAAAAAADAAAAAALS9GsAAAAAZMG6qwAAAAAAAAAA';

    // only injected in the success case
    //
    // this data was picked from a random transaction in horizon:
    // aa6a8e198abe53c7e852e4870413b29fe9ef04da1415a97a5de1a4ae489e11e2

    const rawTxInfo = {
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      txHash: 'ae9f315c048d87a5f853bc15bf284a2c3c89eb0e1cb38c10409b77a877b830a8',
      latestLedger: 100,
      latestLedgerCloseTime: 12345,
      oldestLedger: 50,
      oldestLedgerCloseTime: 500,
      ledger: 1234,
      createdAt: 123456789010,
      applicationOrder: 2,
      feeBump: false,
      envelopeXdr:
        'AAAAAgAAAAAT/LQZdYz0FcQ4Xwyg8IM17rkUx3pPCCWLu+SowQ/T+gBLB24poiQa9iwAngAAAAEAAAAAAAAAAAAAAABkwdeeAAAAAAAAAAEAAAABAAAAAC/9E8hDhnktyufVBS5tqA734Yz5XrLX2XNgBgH/YEkiAAAADQAAAAAAAAAAAAA1/gAAAAAv/RPIQ4Z5Lcrn1QUubagO9+GM+V6y19lzYAYB/2BJIgAAAAAAAAAAAAA1/gAAAAQAAAACU0lMVkVSAAAAAAAAAAAAAFDutWuu6S6UPJBrotNSgfmXa27M++63OT7TYn1qjgy+AAAAAVNHWAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AAAACUEFMTEFESVVNAAAAAAAAAFDutWuu6S6UPJBrotNSgfmXa27M++63OT7TYn1qjgy+AAAAAlNJTFZFUgAAAAAAAAAAAABQ7rVrrukulDyQa6LTUoH5l2tuzPvutzk+02J9ao4MvgAAAAAAAAACwQ/T+gAAAEA+ztVEKWlqHXNnqy6FXJeHr7TltHzZE6YZm5yZfzPIfLaqpp+5cyKotVkj3d89uZCQNsKsZI48uoyERLne+VwL/2BJIgAAAEA7323gPSaezVSa7Vi0J4PqsnklDH1oHLqNBLwi5EWo5W7ohLGObRVQZ0K0+ufnm4hcm9J4Cuj64gEtpjq5j5cM',
      resultXdr:
        'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAANAAAAAAAAAAUAAAACZ4W6fmN63uhVqYRcHET+D2NEtJvhCIYflFh9GqtY+AwAAAACU0lMVkVSAAAAAAAAAAAAAFDutWuu6S6UPJBrotNSgfmXa27M++63OT7TYn1qjgy+AAAYW0toL2gAAAAAAAAAAAAANf4AAAACcgyAkXD5kObNTeRYciLh7R6ES/zzKp0n+cIK3Y6TjBkAAAABU0dYAAAAAABQ7rVrrukulDyQa6LTUoH5l2tuzPvutzk+02J9ao4MvgAAGlGnIJrXAAAAAlNJTFZFUgAAAAAAAAAAAABQ7rVrrukulDyQa6LTUoH5l2tuzPvutzk+02J9ao4MvgAAGFtLaC9oAAAAApmc7UgUBInrDvij8HMSridx2n1w3I8TVEn4sLr1LSpmAAAAAlBBTExBRElVTQAAAAAAAABQ7rVrrukulDyQa6LTUoH5l2tuzPvutzk+02J9ao4MvgAAIUz88EqYAAAAAVNHWAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AABpRpyCa1wAAAAKYUsaaCZ233xB1p+lG7YksShJWfrjsmItbokiR3ifa0gAAAAJTSUxWRVIAAAAAAAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AABv52PPa5wAAAAJQQUxMQURJVU0AAAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AACFM/PBKmAAAAAJnhbp+Y3re6FWphFwcRP4PY0S0m+EIhh+UWH0aq1j4DAAAAAAAAAAAAAA9pAAAAAJTSUxWRVIAAAAAAAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AABv52PPa5wAAAAAv/RPIQ4Z5Lcrn1QUubagO9+GM+V6y19lzYAYB/2BJIgAAAAAAAAAAAAA9pAAAAAA=',
      resultMetaXdr: metaV4Xdr,
      events: {
        contractEventsXdr: [],
        transactionEventsXdr: [],
      },
    };
    // const txInfo: rpc.Api.TransactionInfo = {
    //   status: rpc.Api.GetTransactionStatus.SUCCESS,
    //   txHash: 'ae9f315c048d87a5f853bc15bf284a2c3c89eb0e1cb38c10409b77a877b830a8',
    //   ...parseTransactionInfo(),
    // };

    jest.spyOn(server, '_getTransactions').mockResolvedValue({transactions: [rawTxInfo]} as any);

    const {
      transactions: [txInfo],
    } = await server.getTransactions({} as any);

    tx = {
      tx: txInfo,
      // operations: [],
      events: [],
    };
  });
  describe('filterBlocksProcessor', () => {
    it('should filter by modulo', () => {
      const block = {sequence: 5} as unknown as StellarBlock;
      const filter: StellarBlockFilter = {modulo: 2};

      const result = StellarBlockWrapped.filterBlocksProcessor(block, filter);

      expect(result).toBe(false);
    });
  });

  describe('filterTransactionProcessor', () => {
    it('should filter by account', () => {
      const filter: StellarTransactionFilter = {account: 'BadAccount'};

      const result = StellarBlockWrapped.filterTransactionProcessor(tx, filter);

      expect(result).toBe(false);
    });

    it('should pass when account filter condition is fulfilled', () => {
      const filter: StellarTransactionFilter = {account: testSourceAccount};

      const result = StellarBlockWrapped.filterTransactionProcessor(tx, filter);

      expect(result).toBe(true);
    });

    it('should pass when there is no account filter', () => {
      const filter: StellarTransactionFilter = {};

      const result = StellarBlockWrapped.filterTransactionProcessor(tx, filter);

      expect(result).toBe(true);
    });
  });

  describe('filterOperationProcessor', () => {
    let operation: StellarOperation;

    beforeEach(() => {
      const op = Operation.createAccount({
        destination: testSourceAccount,
        startingBalance: '50',
      });

      operation = {
        index: 0,
        operation: op,
        transaction: tx,
      };
    });

    it('should filter by source_account and type', () => {
      const filter: StellarOperationFilter = {
        sourceAccount: 'account2',
        type: xdr.OperationType.createAccount().name,
      };

      const result = StellarBlockWrapped.filterOperationProcessor(operation, filter);

      expect(result).toBe(false);
    });

    it('should pass when source_account and type filter conditions are fulfilled', () => {
      const filter: StellarOperationFilter = {
        sourceAccount: testSourceAccount,
        type: xdr.OperationType.createAccount().name,
      };

      const result = StellarBlockWrapped.filterOperationProcessor(operation, filter);

      expect(result).toBe(true);
    });

    it('should pass when there are no filter conditions', () => {
      const filter: StellarOperationFilter = {};

      const result = StellarBlockWrapped.filterOperationProcessor(operation, filter);

      expect(result).toBe(true);
    });
  });

  // TODO these tests need to be fixed, the mockEvent has changed so all the filters need updating
  describe('StellarBlockWrapped', function () {
    const contractId = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
    const topicVals = [
      nativeToScVal('transfer', {type: 'symbol'}),
      nativeToScVal(contractId, {type: 'address'}),
      nativeToScVal(1234),
    ];

    const mockEvent: StellarEvent = {
      event: {
        type: 'contract',
        ledger: 2,
        ledgerClosedAt: '2022-11-16T16:10:41Z',
        transactionIndex: 0,
        operationIndex: 0,
        contractId: new Contract(contractId),
        id: '0164090849041387521-0000000003',
        // cursor: '164090849041387521-3',
        inSuccessfulContractCall: true,
        topic: topicVals.slice(0, 2),
        value: nativeToScVal('wassup'),
        txHash: 'd7d09af2ca4f2929ee701cf86d05e4ca5f849a726d0db344785a8f9894e79e6c',
      },
      block: undefined as any,
      tx: undefined as any,
    };

    it('should pass filter - valid address and topics', function () {
      expect(
        StellarBlockWrapped.filterEventProcessor(
          mockEvent,
          {
            topics: ['transfer', contractId],
          },
          testAddress,
        ),
      ).toEqual(true);
    });

    it('should pass filter - no address and valid topics', function () {
      expect(
        StellarBlockWrapped.filterEventProcessor(mockEvent, {
          topics: ['transfer', contractId],
        }),
      ).toEqual(true);
    });

    it('should fail filter - valid address and invalid topics', function () {
      expect(
        StellarBlockWrapped.filterEventProcessor(
          mockEvent,
          {
            topics: ['topics3'],
          },
          testAddress,
        ),
      ).toEqual(false);
    });

    it('should fail filter - event not found', function () {
      expect(
        StellarBlockWrapped.filterEventProcessor(mockEvent, {
          topics: ['topic1', 'topic2', 'topic3'],
        }),
      ).toEqual(false);
    });

    it('should pass filter - skip null topics', function () {
      expect(
        StellarBlockWrapped.filterEventProcessor(mockEvent, {
          topics: ['', contractId],
        }),
      ).toEqual(true);
    });

    it('should pass filer - valid contractId', function () {
      expect(
        StellarBlockWrapped.filterEventProcessor(mockEvent, {
          topics: ['transfer', testAddress],
          contractId: testAddress,
        }),
      ).toEqual(true);
    });

    it('should fail filter - invalid contractId', function () {
      expect(
        StellarBlockWrapped.filterEventProcessor(mockEvent, {
          contractId: 'invalidaddress',
        }),
      ).toEqual(false);
    });

    it('should fail filter - invalid address', function () {
      expect(
        StellarBlockWrapped.filterEventProcessor(
          mockEvent,
          {
            topics: ['topic1', 'topic2'],
          },
          'invalidaddress',
        ),
      ).toEqual(false);
    });
  });
});
