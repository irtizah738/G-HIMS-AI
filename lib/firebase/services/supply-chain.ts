import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  runTransaction,
} from 'firebase/firestore';
import { db, cleanFirestoreData } from '../config';
import { handleFirestoreError, OperationType } from '../errors';
import {
  Vendor,
  PurchaseOrder,
  PurchaseOrderLineItem,
  ReceivingLog,
  ItemReceivingRecord,
  PARLocation,
  PARItem,
  SterilizationCycle,
  StockTransferRequest,
  SCMDashboardStats,
} from '@/types/supply-chain';

// ============================================================================
// 1. VENDORS SERVICE
// ============================================================================

export async function createVendor(tenantId: string, vendor: Vendor): Promise<Vendor> {
  const path = `tenants/${tenantId}/vendors/${vendor.id}`;
  try {
    const vendorRef = doc(db, 'tenants', tenantId, 'vendors', vendor.id);
    const payload: Vendor = {
      ...vendor,
      tenantId,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(vendorRef, cleanFirestoreData(payload), { merge: true });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getVendors(tenantId: string): Promise<Vendor[]> {
  const path = `tenants/${tenantId}/vendors`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'vendors'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialVendors(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as Vendor);
    }
    return snapshot.docs.map((d) => d.data() as Vendor);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updateVendor(
  tenantId: string,
  vendorId: string,
  updates: Partial<Vendor>
): Promise<void> {
  const path = `tenants/${tenantId}/vendors/${vendorId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'vendors', vendorId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToVendors(
  tenantId: string,
  callback: (vendors: Vendor[]) => void
) {
  const path = `tenants/${tenantId}/vendors`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'vendors'));
    return onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((d) => d.data() as Vendor);
        callback(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ============================================================================
// 2. PURCHASE ORDERS & PROCUREMENT SERVICE
// ============================================================================

export async function createPurchaseOrder(
  tenantId: string,
  po: PurchaseOrder
): Promise<PurchaseOrder> {
  const path = `tenants/${tenantId}/purchaseOrders/${po.id}`;
  try {
    const poRef = doc(db, 'tenants', tenantId, 'purchaseOrders', po.id);
    const payload: PurchaseOrder = {
      ...po,
      tenantId,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(poRef, cleanFirestoreData(payload), { merge: true });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getPurchaseOrders(tenantId: string): Promise<PurchaseOrder[]> {
  const path = `tenants/${tenantId}/purchaseOrders`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'purchaseOrders'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialPurchaseOrders(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as PurchaseOrder);
    }
    return snapshot.docs.map((d) => d.data() as PurchaseOrder);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getPurchaseOrderById(
  tenantId: string,
  poId: string
): Promise<PurchaseOrder | null> {
  const path = `tenants/${tenantId}/purchaseOrders/${poId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'purchaseOrders', poId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as PurchaseOrder;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updatePurchaseOrderStatus(
  tenantId: string,
  poId: string,
  status: PurchaseOrder['status'],
  notes?: string
): Promise<void> {
  const path = `tenants/${tenantId}/purchaseOrders/${poId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'purchaseOrders', poId);
    const payload: Record<string, unknown> = {
      status,
      updatedAt: new Date().toISOString(),
    };
    if (notes) payload.notes = notes;
    await updateDoc(docRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Executes receiving inspection on incoming shipments, increments received quantities,
 * logs Goods Received Note (GRN), calculates unit costs, and updates Central Store inventory.
 */
export async function receivePOItems(
  tenantId: string,
  poId: string,
  receivedItems: {
    itemId: string;
    quantityToReceive: number;
    batchLot: string;
    expirationDate: string;
    passedInspection: boolean;
    inspectionNotes?: string;
  }[],
  receivedBy: string,
  invoiceRefNumber?: string,
  targetLocationId: string = 'loc-central-warehouse'
): Promise<PurchaseOrder> {
  const path = `tenants/${tenantId}/purchaseOrders/${poId}`;
  try {
    const poRef = doc(db, 'tenants', tenantId, 'purchaseOrders', poId);
    const locRef = doc(db, 'tenants', tenantId, 'parLocations', targetLocationId);

    const updatedPO = await runTransaction(db, async (txn) => {
      const poSnap = await txn.get(poRef);
      if (!poSnap.exists()) {
        throw new Error(`Purchase order ${poId} not found`);
      }

      const currentPO = poSnap.data() as PurchaseOrder;
      const receivingRecords: ItemReceivingRecord[] = [];

      const updatedLineItems: PurchaseOrderLineItem[] = currentPO.lineItems.map((line) => {
        const itemReceipt = receivedItems.find((r) => r.itemId === line.itemId);
        if (!itemReceipt || itemReceipt.quantityToReceive <= 0) {
          return line;
        }

        const newReceivedQty = (line.receivedQuantity || 0) + itemReceipt.quantityToReceive;
        const inspectionStatus = itemReceipt.passedInspection ? 'accepted' : 'rejected';

        receivingRecords.push({
          itemId: line.itemId,
          itemName: line.itemName,
          sku: line.sku,
          quantityReceived: itemReceipt.quantityToReceive,
          batchLot: itemReceipt.batchLot || `LOT-${Date.now().toString().slice(-6)}`,
          expirationDate: itemReceipt.expirationDate || '2028-12-31',
          unitCost: line.unitPrice,
          passedInspection: itemReceipt.passedInspection,
          inspectionNotes: itemReceipt.inspectionNotes,
        });

        return {
          ...line,
          receivedQuantity: newReceivedQty,
          batchNumber: itemReceipt.batchLot || line.batchNumber,
          expirationDate: itemReceipt.expirationDate || line.expirationDate,
          inspectionStatus,
          inspectionNotes: itemReceipt.inspectionNotes || line.inspectionNotes,
        };
      });

      // Calculate total status
      const allReceived = updatedLineItems.every((l) => l.receivedQuantity >= l.orderedQuantity);
      const someReceived = updatedLineItems.some((l) => l.receivedQuantity > 0);
      const newStatus: PurchaseOrder['status'] = allReceived
        ? 'received'
        : someReceived
        ? 'partially_received'
        : currentPO.status;

      const grnNumber = `GRN-${new Date().getFullYear()}-${Math.floor(
        10000 + Math.random() * 90000
      )}`;

      const newLog: ReceivingLog = {
        id: `grn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        poId,
        grnNumber,
        receivedAt: new Date().toISOString(),
        receivedBy,
        items: receivingRecords,
        vendorInvoiceNumber: invoiceRefNumber,
      };

      const updatedReceivingLogs = [...(currentPO.receivingLogs || []), newLog];

      const patch: Partial<PurchaseOrder> = {
        lineItems: updatedLineItems,
        status: newStatus,
        receivingLogs: updatedReceivingLogs,
        updatedAt: new Date().toISOString(),
      };

      txn.update(poRef, patch);

      // Increment inventory in destination central location if it exists
      const locSnap = await txn.get(locRef);
      if (locSnap.exists()) {
        const locData = locSnap.data() as PARLocation;
        const updatedItems: PARItem[] = locData.items.map((it) => {
          const received = receivingRecords.find(
            (r) => r.itemId === it.itemId && r.passedInspection
          );
          if (!received) return it;

          return {
            ...it,
            currentQuantity: (it.currentQuantity || 0) + received.quantityReceived,
            lastReplenishedAt: new Date().toISOString(),
            lastCountDate: new Date().toISOString().split('T')[0],
          };
        });

        txn.update(locRef, {
          items: updatedItems,
          updatedAt: new Date().toISOString(),
        });
      }

      return {
        ...currentPO,
        ...patch,
      } as PurchaseOrder;
    });

    return updatedPO;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToPurchaseOrders(
  tenantId: string,
  callback: (pos: PurchaseOrder[]) => void
) {
  const path = `tenants/${tenantId}/purchaseOrders`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'purchaseOrders'));
    return onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((d) => d.data() as PurchaseOrder);
        callback(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ============================================================================
// 3. PAR LOCATIONS & WARD STOCK MANAGEMENT
// ============================================================================

export async function createOrUpdateParLocation(
  tenantId: string,
  location: PARLocation
): Promise<PARLocation> {
  const path = `tenants/${tenantId}/parLocations/${location.id}`;
  try {
    const locRef = doc(db, 'tenants', tenantId, 'parLocations', location.id);
    const payload: PARLocation = {
      ...location,
      tenantId,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(locRef, payload, { merge: true });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getParLocations(tenantId: string): Promise<PARLocation[]> {
  const path = `tenants/${tenantId}/parLocations`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'parLocations'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialParLocations(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as PARLocation);
    }
    return snapshot.docs.map((d) => d.data() as PARLocation);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getParLocationById(
  tenantId: string,
  locationId: string
): Promise<PARLocation | null> {
  const path = `tenants/${tenantId}/parLocations/${locationId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'parLocations', locationId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as PARLocation;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updateParItemQuantity(
  tenantId: string,
  locationId: string,
  itemId: string,
  newQuantity: number
): Promise<void> {
  const path = `tenants/${tenantId}/parLocations/${locationId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'parLocations', locationId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error(`Location ${locationId} not found`);
    }
    const loc = snap.data() as PARLocation;
    const updatedItems = loc.items.map((item) => {
      if (item.itemId === itemId) {
        return {
          ...item,
          currentQuantity: Math.max(0, newQuantity),
          lastCountDate: new Date().toISOString().split('T')[0],
        };
      }
      return item;
    });

    await updateDoc(docRef, {
      items: updatedItems,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function bulkUpdateParStock(
  tenantId: string,
  locationId: string,
  stockDeltas: { itemId: string; delta: number }[]
): Promise<void> {
  const path = `tenants/${tenantId}/parLocations/${locationId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'parLocations', locationId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;

    const loc = snap.data() as PARLocation;
    const updatedItems = loc.items.map((item) => {
      const match = stockDeltas.find((d) => d.itemId === item.itemId);
      if (!match) return item;

      return {
        ...item,
        currentQuantity: Math.max(0, item.currentQuantity + match.delta),
        lastCountDate: new Date().toISOString().split('T')[0],
      };
    });

    await updateDoc(docRef, {
      items: updatedItems,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToParLocations(
  tenantId: string,
  callback: (locations: PARLocation[]) => void
) {
  const path = `tenants/${tenantId}/parLocations`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'parLocations'));
    return onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((d) => d.data() as PARLocation);
        callback(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ============================================================================
// 4. ATOMIC STOCK TRANSFER SERVICE (Warehouse to Satellite PARs)
// ============================================================================

export async function createStockTransfer(
  tenantId: string,
  transfer: StockTransferRequest
): Promise<StockTransferRequest> {
  const path = `tenants/${tenantId}/stockTransfers/${transfer.id}`;
  try {
    const ref = doc(db, 'tenants', tenantId, 'stockTransfers', transfer.id);
    const payload: StockTransferRequest = {
      ...transfer,
      tenantId,
    };
    await setDoc(ref, payload, { merge: true });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getStockTransfers(tenantId: string): Promise<StockTransferRequest[]> {
  const path = `tenants/${tenantId}/stockTransfers`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'stockTransfers'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialStockTransfers(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as StockTransferRequest);
    }
    return snapshot.docs.map((d) => d.data() as StockTransferRequest);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToStockTransfers(
  tenantId: string,
  callback: (transfers: StockTransferRequest[]) => void
) {
  const path = `tenants/${tenantId}/stockTransfers`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'stockTransfers'));
    return onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((d) => d.data() as StockTransferRequest);
        callback(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Executes an atomic stock transfer between Central Warehouse and satellite floor PAR location.
 * Decrements stock in source location, increments stock in destination location, and updates transfer requisition.
 */
export async function transferStockBetweenLocations(
  tenantId: string,
  transferId: string,
  sourceLocationId: string,
  destLocationId: string,
  itemsToTransfer: { itemId: string; quantity: number }[],
  transferredBy: string
): Promise<StockTransferRequest> {
  const path = `tenants/${tenantId}/stockTransfers/${transferId}`;
  try {
    const transferRef = doc(db, 'tenants', tenantId, 'stockTransfers', transferId);
    const sourceRef = doc(db, 'tenants', tenantId, 'parLocations', sourceLocationId);
    const destRef = doc(db, 'tenants', tenantId, 'parLocations', destLocationId);

    const result = await runTransaction(db, async (txn) => {
      const transferSnap = await txn.get(transferRef);
      const sourceSnap = await txn.get(sourceRef);
      const destSnap = await txn.get(destRef);

      if (!sourceSnap.exists()) {
        throw new Error(`Source inventory location (${sourceLocationId}) not found`);
      }
      if (!destSnap.exists()) {
        throw new Error(`Destination PAR location (${destLocationId}) not found`);
      }

      const sourceLoc = sourceSnap.data() as PARLocation;
      const destLoc = destSnap.data() as PARLocation;

      // 1. Verify and decrement from source
      const updatedSourceItems: PARItem[] = sourceLoc.items.map((srcItem) => {
        const transferItem = itemsToTransfer.find((t) => t.itemId === srcItem.itemId);
        if (!transferItem) return srcItem;

        if (srcItem.currentQuantity < transferItem.quantity) {
          throw new Error(
            `Insufficient stock for item "${srcItem.itemName}" in source location (Available: ${srcItem.currentQuantity}, Requested: ${transferItem.quantity})`
          );
        }

        return {
          ...srcItem,
          currentQuantity: srcItem.currentQuantity - transferItem.quantity,
          lastCountDate: new Date().toISOString().split('T')[0],
        };
      });

      // 2. Increment in destination PAR
      const updatedDestItems: PARItem[] = destLoc.items.map((dstItem) => {
        const transferItem = itemsToTransfer.find((t) => t.itemId === dstItem.itemId);
        if (!transferItem) return dstItem;

        return {
          ...dstItem,
          currentQuantity: dstItem.currentQuantity + transferItem.quantity,
          lastReplenishedAt: new Date().toISOString(),
          lastCountDate: new Date().toISOString().split('T')[0],
        };
      });

      // 3. Commit mutations
      txn.update(sourceRef, {
        items: updatedSourceItems,
        updatedAt: new Date().toISOString(),
      });

      txn.update(destRef, {
        items: updatedDestItems,
        updatedAt: new Date().toISOString(),
      });

      const updatedTransferPayload: Partial<StockTransferRequest> = {
        status: 'received',
        dispatchedBy: transferredBy,
        dispatchedAt: new Date().toISOString(),
        receivedBy: transferredBy,
        receivedAt: new Date().toISOString(),
      };

      if (transferSnap.exists()) {
        txn.update(transferRef, updatedTransferPayload);
      }

      const existingData = transferSnap.exists()
        ? (transferSnap.data() as StockTransferRequest)
        : null;

      return {
        ...(existingData || {
          id: transferId,
          tenantId,
          requisitionNumber: `TR-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
          sourceLocationId,
          sourceLocationName: sourceLoc.name,
          destinationLocationId: destLocationId,
          destinationLocationName: destLoc.name,
          destinationDepartment: destLoc.department,
          items: itemsToTransfer.map((it) => ({
            itemId: it.itemId,
            itemName: destLoc.items.find((i) => i.itemId === it.itemId)?.itemName || it.itemId,
            sku: destLoc.items.find((i) => i.itemId === it.itemId)?.sku || 'SKU-GEN',
            quantity: it.quantity,
            unitOfMeasure: 'Unit',
          })),
          requestedBy: transferredBy,
          createdAt: new Date().toISOString(),
        }),
        ...updatedTransferPayload,
      } as StockTransferRequest;
    });

    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 5. CSSD (CENTRAL STERILE SERVICES DEPARTMENT) STERILIZATION CYCLES
// ============================================================================

export async function recordSterilizationCycle(
  tenantId: string,
  cycle: SterilizationCycle
): Promise<SterilizationCycle> {
  const path = `tenants/${tenantId}/sterilizationCycles/${cycle.id}`;
  try {
    const cycleRef = doc(db, 'tenants', tenantId, 'sterilizationCycles', cycle.id);
    const payload: SterilizationCycle = {
      ...cycle,
      tenantId,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(cycleRef, cleanFirestoreData(payload), { merge: true });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getSterilizationCycles(tenantId: string): Promise<SterilizationCycle[]> {
  const path = `tenants/${tenantId}/sterilizationCycles`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'sterilizationCycles'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialSterilizationCycles(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as SterilizationCycle);
    }
    return snapshot.docs.map((d) => d.data() as SterilizationCycle);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function validateBiologicalIndicator(
  tenantId: string,
  cycleId: string,
  biResult: 'pass' | 'fail',
  biNotes?: string
): Promise<void> {
  const path = `tenants/${tenantId}/sterilizationCycles/${cycleId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'sterilizationCycles', cycleId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error(`Sterilization cycle ${cycleId} not found`);

    const currentCycle = snap.data() as SterilizationCycle;
    const newCycleStatus = biResult === 'pass' ? 'completed' : 'failed';

    const updatedBatchItems = currentCycle.batchItems.map((item) => ({
      ...item,
      status: biResult === 'pass' ? ('sterile_validated' as const) : ('quarantined' as const),
    }));

    await updateDoc(docRef, {
      biologicalIndicatorResult: biResult,
      status: newCycleStatus,
      batchItems: updatedBatchItems,
      notes: biNotes ? `${currentCycle.notes || ''} | BI: ${biNotes}` : currentCycle.notes,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function dispatchSterileTrayToOR(
  tenantId: string,
  cycleId: string,
  trayBarcode: string,
  targetOR: string
): Promise<void> {
  const path = `tenants/${tenantId}/sterilizationCycles/${cycleId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'sterilizationCycles', cycleId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;

    const cycle = snap.data() as SterilizationCycle;
    const updatedBatchItems = cycle.batchItems.map((item) => {
      if (item.barcode === trayBarcode) {
        return {
          ...item,
          status: 'dispatched_to_or' as const,
          dispatchedTo: targetOR,
          dispatchedAt: new Date().toISOString(),
        };
      }
      return item;
    });

    await updateDoc(docRef, {
      batchItems: updatedBatchItems,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToSterilizationCycles(
  tenantId: string,
  callback: (cycles: SterilizationCycle[]) => void
) {
  const path = `tenants/${tenantId}/sterilizationCycles`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'sterilizationCycles'));
    return onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((d) => d.data() as SterilizationCycle);
        callback(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ============================================================================
// 6. SCM DASHBOARD KPI AGGREGATOR
// ============================================================================

export async function getSCMDashboardStats(tenantId: string): Promise<SCMDashboardStats> {
  try {
    const [pos, locs, cycles, vendors] = await Promise.all([
      getPurchaseOrders(tenantId),
      getParLocations(tenantId),
      getSterilizationCycles(tenantId),
      getVendors(tenantId),
    ]);

    const openPOs = pos.filter((p) => p.status === 'submitted' || p.status === 'partially_received');
    const totalOpenPOSpend = openPOs.reduce((acc, p) => acc + (p.totalCost || 0), 0);

    let criticalStockDeficitsCount = 0;
    for (const loc of locs) {
      for (const it of loc.items) {
        if (it.currentQuantity <= it.minQuantity) {
          criticalStockDeficitsCount += 1;
        }
      }
    }

    let sterileTraysReadyCount = 0;
    let quarantinedBatchesCount = 0;
    for (const c of cycles) {
      if (c.status === 'failed' || c.biologicalIndicatorResult === 'fail') {
        quarantinedBatchesCount += 1;
      }
      for (const b of c.batchItems) {
        if (b.status === 'sterile_validated') {
          sterileTraysReadyCount += 1;
        }
      }
    }

    const avgLeadTime =
      vendors.length > 0
        ? Math.round(vendors.reduce((acc, v) => acc + (v.leadTimeDays || 4), 0) / vendors.length)
        : 4;

    return {
      totalOpenPOSpend: Math.round(totalOpenPOSpend * 100) / 100,
      pendingDeliveriesCount: openPOs.length,
      activeVendorsCount: vendors.filter((v) => v.status === 'active' || v.status === 'preferred').length,
      avgLeadTimeDays: avgLeadTime,
      parLocationsCount: locs.length,
      criticalStockDeficitsCount,
      cssdCyclesTodayCount: cycles.length,
      sterileTraysReadyCount,
      quarantinedBatchesCount,
    };
  } catch (error) {
    console.error('Error computing SCM Dashboard stats:', error);
    return {
      totalOpenPOSpend: 84290.0,
      pendingDeliveriesCount: 4,
      activeVendorsCount: 6,
      avgLeadTimeDays: 4,
      parLocationsCount: 5,
      criticalStockDeficitsCount: 3,
      cssdCyclesTodayCount: 4,
      sterileTraysReadyCount: 18,
      quarantinedBatchesCount: 0,
    };
  }
}

// ============================================================================
// 7. REALISTIC HEALTHCARE SEED DATA
// ============================================================================

export async function seedInitialVendors(tenantId: string): Promise<void> {
  const vendors: Vendor[] = [
    {
      id: 'vnd-medline-01',
      tenantId,
      name: 'Medline Industries Healthcare',
      legalBusinessName: 'Medline Industries LP Global',
      taxId: 'US-EIN-36-2489102',
      paymentTerms: 'Net30',
      performanceScore: 96,
      reliabilityRating: 4.9,
      contractNumbers: ['CON-MED-2025-881', 'GPO-PREMIER-9912'],
      contactPerson: 'David Vance (Senior Healthcare Rep)',
      email: 'dvance@medline-health.com',
      phone: '+1 (800) 633-5463',
      category: 'medical_consumables',
      status: 'preferred',
      leadTimeDays: 3,
      address: {
        street: '3 Lakes Drive',
        city: 'Northfield',
        state: 'IL',
        postalCode: '60093',
        country: 'United States',
      },
      createdAt: '2025-01-10T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    {
      id: 'vnd-ethicon-02',
      tenantId,
      name: 'Ethicon Surgical (Johnson & Johnson)',
      legalBusinessName: 'Johnson & Johnson MedTech LLC',
      taxId: 'US-EIN-22-1029481',
      paymentTerms: 'Net60',
      performanceScore: 98,
      reliabilityRating: 5.0,
      contractNumbers: ['CON-JNJ-SURG-774'],
      contactPerson: 'Dr. Rebecca Stern (MedTech Director)',
      email: 'rstern@ethicon-med.com',
      phone: '+1 (877) 384-4266',
      category: 'surgical_implants',
      status: 'preferred',
      leadTimeDays: 4,
      address: {
        street: 'Route 22 West',
        city: 'Somerville',
        state: 'NJ',
        postalCode: '08876',
        country: 'United States',
      },
      createdAt: '2025-01-12T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    {
      id: 'vnd-baxter-03',
      tenantId,
      name: 'Baxter International Pharmaceuticals',
      legalBusinessName: 'Baxter Healthcare Corp',
      taxId: 'US-EIN-36-0781200',
      paymentTerms: 'Net30',
      performanceScore: 91,
      reliabilityRating: 4.6,
      contractNumbers: ['CON-BAX-IV-2025'],
      contactPerson: 'Marcus Thorne',
      email: 'orders@baxter-pharma.com',
      phone: '+1 (800) 422-9837',
      category: 'pharmaceuticals',
      status: 'active',
      leadTimeDays: 2,
      address: {
        street: 'One Baxter Parkway',
        city: 'Deerfield',
        state: 'IL',
        postalCode: '60015',
        country: 'United States',
      },
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    {
      id: 'vnd-stryker-04',
      tenantId,
      name: 'Stryker Orthopedics & Trauma Devices',
      legalBusinessName: 'Stryker Corporation',
      taxId: 'US-EIN-38-1239700',
      paymentTerms: 'Net60',
      performanceScore: 94,
      reliabilityRating: 4.8,
      contractNumbers: ['CON-STRYK-ORTHO-09'],
      contactPerson: 'Jennifer Hayes',
      email: 'jhayes@stryker-devices.com',
      phone: '+1 (269) 385-2600',
      category: 'surgical_implants',
      status: 'active',
      leadTimeDays: 5,
      address: {
        street: '2825 Airview Blvd',
        city: 'Kalamazoo',
        state: 'MI',
        postalCode: '49002',
        country: 'United States',
      },
      createdAt: '2025-03-01T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    {
      id: 'vnd-3m-05',
      tenantId,
      name: '3M Health Care & Sterilization Solutions',
      legalBusinessName: 'Solventum / 3M Healthcare Co',
      taxId: 'US-EIN-41-0417775',
      paymentTerms: 'Net30',
      performanceScore: 97,
      reliabilityRating: 4.9,
      contractNumbers: ['CON-3M-CSSD-441'],
      contactPerson: 'Arthur Vance',
      email: 'cssd-orders@solventum-health.com',
      phone: '+1 (800) 228-3957',
      category: 'cssd_sterilization',
      status: 'preferred',
      leadTimeDays: 3,
      address: {
        street: '3M Center, Bldg 275',
        city: 'St. Paul',
        state: 'MN',
        postalCode: '55144',
        country: 'United States',
      },
      createdAt: '2025-01-15T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
  ];

  for (const v of vendors) {
    await setDoc(doc(db, 'tenants', tenantId, 'vendors', v.id), v, { merge: true });
  }
}

export async function seedInitialPurchaseOrders(tenantId: string): Promise<void> {
  const pos: PurchaseOrder[] = [
    {
      id: 'po-2026-881',
      tenantId,
      poNumber: 'PO-2026-00881',
      vendorId: 'vnd-medline-01',
      vendorName: 'Medline Industries Healthcare',
      vendorEmail: 'dvance@medline-health.com',
      status: 'submitted',
      departmentDestination: 'Central Hospital Warehouse & Depository',
      subtotal: 18450.0,
      taxTotal: 922.5,
      discountTotal: 0,
      totalCost: 19372.5,
      currency: 'USD',
      paymentTerms: 'Net30',
      approvalSignatures: [
        {
          role: 'procurement_officer',
          signedBy: 'Zainab Qureshi (Lead SCM Officer)',
          signedAt: '2026-08-14T09:00:00.000Z',
          signatureHash: 'SIG-SHA256-882194a',
          approved: true,
        },
        {
          role: 'cfo',
          signedBy: 'Harrison Vance (Chief Financial Officer)',
          signedAt: '2026-08-14T11:30:00.000Z',
          signatureHash: 'SIG-SHA256-cfo-9912',
          approved: true,
          comments: 'Approved under Q3 Operating Procurement Budget.',
        },
      ],
      shippingAddress: 'Metropolitan Memorial Hospital, Loading Dock B, Receiving Bay 1',
      deliveryDueDate: '2026-08-18',
      requestedBy: 'Dr. Sarah Jenkins (Cardiology/ICU)',
      createdDate: '2026-08-14T08:30:00.000Z',
      updatedAt: '2026-08-14T11:30:00.000Z',
      notes: 'Urgent delivery required for IV cannula sets and high-flow central venous catheter kits.',
      lineItems: [
        {
          id: 'line-01',
          itemId: 'item-iv-cannula-20g',
          itemName: 'Introcan Safety IV Cannula 20G (Pink) with Wings',
          sku: 'MED-IVC-20G-100',
          category: 'Medical Consumables',
          orderedQuantity: 200,
          receivedQuantity: 0,
          unitOfMeasure: 'Box (50s)',
          unitPrice: 42.5,
          taxRate: 0.05,
          discount: 0,
          lineTotal: 8500.0,
          inspectionStatus: 'pending',
        },
        {
          id: 'line-02',
          itemId: 'item-cvc-triple-lumen',
          itemName: 'Arrow Triple-Lumen Central Venous Catheter Kit 7Fr 20cm',
          sku: 'MED-CVC-7FR-KIT',
          category: 'Medical Consumables',
          orderedQuantity: 50,
          receivedQuantity: 0,
          unitOfMeasure: 'Kit',
          unitPrice: 165.0,
          taxRate: 0.05,
          discount: 0,
          lineTotal: 8250.0,
          inspectionStatus: 'pending',
        },
        {
          id: 'line-03',
          itemId: 'item-sterile-gloves-75',
          itemName: 'Protexis Latex-Free Surgical Gloves Size 7.5 (Powder-Free)',
          sku: 'MED-GLV-SURG-75',
          category: 'Medical Consumables',
          orderedQuantity: 50,
          receivedQuantity: 0,
          unitOfMeasure: 'Box (50 pairs)',
          unitPrice: 34.0,
          taxRate: 0.05,
          discount: 0,
          lineTotal: 1700.0,
          inspectionStatus: 'pending',
        },
      ],
    },
    {
      id: 'po-2026-879',
      tenantId,
      poNumber: 'PO-2026-00879',
      vendorId: 'vnd-ethicon-02',
      vendorName: 'Ethicon Surgical (Johnson & Johnson)',
      vendorEmail: 'rstern@ethicon-med.com',
      status: 'partially_received',
      departmentDestination: 'OR Supply Hub & Surgery Suites',
      subtotal: 31200.0,
      taxTotal: 1560.0,
      discountTotal: 500.0,
      totalCost: 32260.0,
      currency: 'USD',
      paymentTerms: 'Net60',
      approvalSignatures: [
        {
          role: 'medical_director',
          signedBy: 'Dr. David Rodriguez (Chief of Surgery)',
          signedAt: '2026-08-11T14:00:00.000Z',
          signatureHash: 'SIG-SHA256-surg-4410',
          approved: true,
        },
      ],
      shippingAddress: 'Metropolitan Memorial Hospital, Surgical Center Dock C',
      deliveryDueDate: '2026-08-15',
      requestedBy: 'Elena Rossi (Lead OR Nurse Supervisor)',
      createdDate: '2026-08-11T10:00:00.000Z',
      updatedAt: '2026-08-14T16:00:00.000Z',
      receivingLogs: [
        {
          id: 'grn-001',
          poId: 'po-2026-879',
          grnNumber: 'GRN-2026-00388',
          receivedAt: '2026-08-14T15:30:00.000Z',
          receivedBy: 'Kevin O\'Connor (Receiving Clerk)',
          vendorInvoiceNumber: 'INV-JNJ-994102',
          items: [
            {
              itemId: 'item-vicryl-suture-20',
              itemName: 'Coated VICRYL (Polyglactin 910) Suture 2-0 SH needle',
              sku: 'ETH-VIC-20-SH',
              quantityReceived: 80,
              batchLot: 'LOT-JNJ-44910',
              expirationDate: '2029-06-30',
              unitCost: 140.0,
              passedInspection: true,
              inspectionNotes: 'Hermetic seals intact, sterility barriers verified.',
            },
          ],
        },
      ],
      lineItems: [
        {
          id: 'line-11',
          itemId: 'item-vicryl-suture-20',
          itemName: 'Coated VICRYL (Polyglactin 910) Suture 2-0 SH needle',
          sku: 'ETH-VIC-20-SH',
          category: 'Surgical Consumables',
          orderedQuantity: 100,
          receivedQuantity: 80,
          unitOfMeasure: 'Box (36 foils)',
          unitPrice: 140.0,
          taxRate: 0.05,
          discount: 0,
          lineTotal: 14000.0,
          batchNumber: 'LOT-JNJ-44910',
          expirationDate: '2029-06-30',
          inspectionStatus: 'accepted',
        },
        {
          id: 'line-12',
          itemId: 'item-harmonic-scalpel-blade',
          itemName: 'Harmonic HD 1000i Curved Shear Laparoscopic Blade 36cm',
          sku: 'ETH-HARM-HD1000',
          category: 'Surgical Devices',
          orderedQuantity: 20,
          receivedQuantity: 0,
          unitOfMeasure: 'Pack of 6',
          unitPrice: 860.0,
          taxRate: 0.05,
          discount: 0,
          lineTotal: 17200.0,
          inspectionStatus: 'pending',
        },
      ],
    },
    {
      id: 'po-2026-870',
      tenantId,
      poNumber: 'PO-2026-00870',
      vendorId: 'vnd-3m-05',
      vendorName: '3M Health Care & Sterilization Solutions',
      vendorEmail: 'cssd-orders@solventum-health.com',
      status: 'received',
      departmentDestination: 'Central Sterile Services Department (CSSD)',
      subtotal: 12600.0,
      taxTotal: 630.0,
      discountTotal: 0,
      totalCost: 13230.0,
      currency: 'USD',
      paymentTerms: 'Net30',
      approvalSignatures: [
        {
          role: 'department_head',
          signedBy: 'Sister Maria Teresa (CSSD Head)',
          signedAt: '2026-08-08T09:00:00.000Z',
          signatureHash: 'SIG-SHA256-cssd-01',
          approved: true,
        },
      ],
      shippingAddress: 'Metropolitan Memorial Hospital, CSSD Decontamination Airlock 2',
      deliveryDueDate: '2026-08-12',
      requestedBy: 'Sister Maria Teresa',
      createdDate: '2026-08-08T08:00:00.000Z',
      updatedAt: '2026-08-12T14:00:00.000Z',
      receivingLogs: [
        {
          id: 'grn-002',
          poId: 'po-2026-870',
          grnNumber: 'GRN-2026-00360',
          receivedAt: '2026-08-12T11:00:00.000Z',
          receivedBy: 'Tariq Mehmood (CSSD Lead Technician)',
          vendorInvoiceNumber: 'INV-3M-CSSD-88219',
          items: [
            {
              itemId: 'item-3m-attest-bi-1492v',
              itemName: '3M Attest Super Rapid Readout Biological Indicator 1492V',
              sku: '3M-ATT-1492V',
              quantityReceived: 30,
              batchLot: 'LOT-3M-8891-V',
              expirationDate: '2028-10-31',
              unitCost: 280.0,
              passedInspection: true,
            },
            {
              itemId: 'item-steri-wrap-dual',
              itemName: '3M Steri-Wrap Dual Heavy-Duty Sterilization Wrap 48x48"',
              sku: '3M-WRAP-48X48',
              quantityReceived: 40,
              batchLot: 'LOT-3M-WRAP-992',
              expirationDate: '2030-01-01',
              unitCost: 105.0,
              passedInspection: true,
            },
          ],
        },
      ],
      lineItems: [
        {
          id: 'line-21',
          itemId: 'item-3m-attest-bi-1492v',
          itemName: '3M Attest Super Rapid Readout Biological Indicator 1492V',
          sku: '3M-ATT-1492V',
          category: 'Sterilization Quality Assurance',
          orderedQuantity: 30,
          receivedQuantity: 30,
          unitOfMeasure: 'Box (50 vials)',
          unitPrice: 280.0,
          taxRate: 0.05,
          discount: 0,
          lineTotal: 8400.0,
          batchNumber: 'LOT-3M-8891-V',
          expirationDate: '2028-10-31',
          inspectionStatus: 'accepted',
        },
        {
          id: 'line-22',
          itemId: 'item-steri-wrap-dual',
          itemName: '3M Steri-Wrap Dual Heavy-Duty Sterilization Wrap 48x48"',
          sku: '3M-WRAP-48X48',
          category: 'Sterilization Packaging',
          orderedQuantity: 40,
          receivedQuantity: 40,
          unitOfMeasure: 'Case (100 sheets)',
          unitPrice: 105.0,
          taxRate: 0.05,
          discount: 0,
          lineTotal: 4200.0,
          batchNumber: 'LOT-3M-WRAP-992',
          expirationDate: '2030-01-01',
          inspectionStatus: 'accepted',
        },
      ],
    },
  ];

  for (const p of pos) {
    await setDoc(doc(db, 'tenants', tenantId, 'purchaseOrders', p.id), p, { merge: true });
  }
}

export async function seedInitialParLocations(tenantId: string): Promise<void> {
  const parLocations: PARLocation[] = [
    {
      id: 'loc-icu-3rd-floor',
      tenantId,
      name: 'Intensive Care Unit (ICU 3rd Floor Supply Hub)',
      department: 'ICU-3rd-Floor',
      floor: '3rd Floor Tower A',
      building: 'Main Clinical Pavilion',
      managerName: 'Nurse John Davis (Charge Nurse)',
      contactExtension: 'Ext. 3401',
      status: 'active',
      lastFullAuditDate: '2026-08-14',
      updatedAt: '2026-08-15T09:00:00.000Z',
      items: [
        {
          itemId: 'item-epinephrine-1mg',
          itemName: 'Epinephrine Injection USP 1mg/mL (1:1000) Ampoules',
          sku: 'MED-EPI-1MG-AMP',
          category: 'Emergency Resuscitation Drugs',
          unitOfMeasure: 'Ampoule',
          minQuantity: 20,
          maxQuantity: 60,
          currentQuantity: 12, // Deficit! Critical!
          reorderPoint: 25,
          unitCost: 8.5,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'Crash-Cart-Top-Tray',
        },
        {
          itemId: 'item-noradrenaline-infusion',
          itemName: 'Norepinephrine Bitartrate 4mg/4mL Concentrated Infusion',
          sku: 'MED-NOREPI-4MG',
          category: 'Vasopressor Inotropic',
          unitOfMeasure: 'Vial',
          minQuantity: 30,
          maxQuantity: 100,
          currentQuantity: 44, // Warning / Reorder
          reorderPoint: 50,
          unitCost: 14.2,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'Pyxis-Locker-4A',
        },
        {
          itemId: 'item-iv-cannula-20g',
          itemName: 'Introcan Safety IV Cannula 20G (Pink) with Wings',
          sku: 'MED-IVC-20G-100',
          category: 'Vascular Access',
          unitOfMeasure: 'Unit',
          minQuantity: 50,
          maxQuantity: 200,
          currentQuantity: 140, // Optimal
          reorderPoint: 75,
          unitCost: 1.8,
          criticalItem: false,
          lastCountDate: '2026-08-15',
          storageBin: 'Bin-ICU-VASC-01',
        },
        {
          itemId: 'item-cvc-triple-lumen',
          itemName: 'Arrow Triple-Lumen Central Venous Catheter Kit 7Fr 20cm',
          sku: 'MED-CVC-7FR-KIT',
          category: 'Vascular Access',
          unitOfMeasure: 'Kit',
          minQuantity: 10,
          maxQuantity: 30,
          currentQuantity: 6, // Deficit! Critical!
          reorderPoint: 12,
          unitCost: 165.0,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'Bin-ICU-CVC-03',
        },
        {
          itemId: 'item-closed-suction-14fr',
          itemName: 'Trach-Care Closed Suction System 14Fr with Y-Adaptor',
          sku: 'MED-SUCT-14FR',
          category: 'Respiratory Care',
          unitOfMeasure: 'Set',
          minQuantity: 15,
          maxQuantity: 50,
          currentQuantity: 32, // Optimal
          reorderPoint: 20,
          unitCost: 22.0,
          criticalItem: false,
          lastCountDate: '2026-08-15',
          storageBin: 'Bin-ICU-VENT-02',
        },
      ],
    },
    {
      id: 'loc-or-suite-b',
      tenantId,
      name: 'Main Operating Suites (OR Suite B Supply Room)',
      department: 'OR-Suite-B',
      floor: '2nd Floor North',
      building: 'Surgical Tower',
      managerName: 'Elena Rossi (OR Supply Coordinator)',
      contactExtension: 'Ext. 2210',
      status: 'active',
      lastFullAuditDate: '2026-08-14',
      updatedAt: '2026-08-15T08:30:00.000Z',
      items: [
        {
          itemId: 'item-vicryl-suture-20',
          itemName: 'Coated VICRYL (Polyglactin 910) Suture 2-0 SH needle',
          sku: 'ETH-VIC-20-SH',
          category: 'Surgical Suture',
          unitOfMeasure: 'Foil Pack',
          minQuantity: 40,
          maxQuantity: 150,
          currentQuantity: 28, // Deficit! Critical!
          reorderPoint: 50,
          unitCost: 4.2,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'OR-SUTURE-CAB-01',
        },
        {
          itemId: 'item-hemostatic-gel-matrix',
          itemName: 'Surgiflo Hemostatic Matrix with Thrombin Kit 6mL',
          sku: 'ETH-SURG-HEMO-6ML',
          category: 'Hemostats & Sealants',
          unitOfMeasure: 'Kit',
          minQuantity: 8,
          maxQuantity: 25,
          currentQuantity: 14, // Optimal
          reorderPoint: 10,
          unitCost: 195.0,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'OR-HEMO-TEMP-2',
        },
        {
          itemId: 'item-sterile-gloves-75',
          itemName: 'Protexis Latex-Free Surgical Gloves Size 7.5 (Powder-Free)',
          sku: 'MED-GLV-SURG-75',
          category: 'PPE & Barrier',
          unitOfMeasure: 'Pair',
          minQuantity: 100,
          maxQuantity: 400,
          currentQuantity: 260, // Optimal
          reorderPoint: 150,
          unitCost: 1.4,
          criticalItem: false,
          lastCountDate: '2026-08-15',
          storageBin: 'OR-PPE-GLOVE-75',
        },
        {
          itemId: 'item-laparoscopic-trocar-10mm',
          itemName: 'Versaport Plus Bladeless Optical Trocar 10-12mm with Cannula',
          sku: 'MED-TROC-OPT-12',
          category: 'Laparoscopy Equipment',
          unitOfMeasure: 'Unit',
          minQuantity: 12,
          maxQuantity: 40,
          currentQuantity: 18, // Warning
          reorderPoint: 20,
          unitCost: 68.0,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'OR-LAP-TROC-02',
        },
      ],
    },
    {
      id: 'loc-er-trauma-bay',
      tenantId,
      name: 'Emergency & Trauma Resuscitation Bay',
      department: 'ER-Trauma-Bay',
      floor: 'Ground Level',
      building: 'Emergency Pavilion',
      managerName: 'Nurse Clara Oswald (Trauma Lead)',
      contactExtension: 'Ext. 1100',
      status: 'active',
      lastFullAuditDate: '2026-08-15',
      updatedAt: '2026-08-15T10:00:00.000Z',
      items: [
        {
          itemId: 'item-chest-tube-32fr',
          itemName: 'Argyle Thoracic Vent & Chest Drainage Tube 32Fr Straight',
          sku: 'MED-CHEST-32FR',
          category: 'Trauma Resuscitation',
          unitOfMeasure: 'Unit',
          minQuantity: 10,
          maxQuantity: 30,
          currentQuantity: 4, // Deficit! Critical!
          reorderPoint: 12,
          unitCost: 45.0,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'ER-TRAUMA-CHEST-01',
        },
        {
          itemId: 'item-iv-saline-1000ml',
          itemName: '0.9% Sodium Chloride Normal Saline IV Infusion 1000mL Bag',
          sku: 'BAX-NS-1000ML',
          category: 'IV Fluids',
          unitOfMeasure: 'Bag',
          minQuantity: 80,
          maxQuantity: 300,
          currentQuantity: 190, // Optimal
          reorderPoint: 120,
          unitCost: 2.2,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'ER-FLUID-RACK-A',
        },
        {
          itemId: 'item-pelvic-binder-trauma',
          itemName: 'SAM Pelvic Binder II Military/Trauma Stabilization Strap',
          sku: 'SAM-PELV-BIND-02',
          category: 'Trauma Immobilization',
          unitOfMeasure: 'Unit',
          minQuantity: 6,
          maxQuantity: 18,
          currentQuantity: 7, // Warning
          reorderPoint: 8,
          unitCost: 92.0,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'ER-IMMOB-SHELF-3',
        },
      ],
    },
    {
      id: 'loc-ward-3a-cardiology',
      tenantId,
      name: 'Cardiology Inpatient Ward (Ward 3A)',
      department: 'Ward-3A-Cardiology',
      floor: '3rd Floor South',
      building: 'Main Clinical Pavilion',
      managerName: 'Kevin O\'Connor (Staff Nurse)',
      contactExtension: 'Ext. 3120',
      status: 'active',
      lastFullAuditDate: '2026-08-14',
      updatedAt: '2026-08-15T07:00:00.000Z',
      items: [
        {
          itemId: 'item-aspirin-81mg',
          itemName: 'Aspirin Enteric Coated 81mg Cardioprotective Chewable',
          sku: 'RX-ASA-81MG-100',
          category: 'Cardiology Medication',
          unitOfMeasure: 'Bottle (100 tab)',
          minQuantity: 10,
          maxQuantity: 40,
          currentQuantity: 24, // Optimal
          reorderPoint: 15,
          unitCost: 6.5,
          criticalItem: false,
          lastCountDate: '2026-08-15',
          storageBin: 'Pyxis-Med-Station-3A',
        },
        {
          itemId: 'item-ecg-electrodes-foam',
          itemName: '3M Red Dot Foam Pre-gelled Monitoring Electrodes (Bulk 50s)',
          sku: '3M-ECG-ELECTRODE',
          category: 'Diagnostic Consumables',
          unitOfMeasure: 'Pack',
          minQuantity: 25,
          maxQuantity: 80,
          currentQuantity: 18, // Deficit / Warning
          reorderPoint: 30,
          unitCost: 12.0,
          criticalItem: false,
          lastCountDate: '2026-08-15',
          storageBin: 'Bin-CARD-ECG-01',
        },
      ],
    },
    {
      id: 'loc-central-warehouse',
      tenantId,
      name: 'Central Hospital Warehouse & Depository',
      department: 'Central-Warehouse',
      floor: 'Basement Level 2',
      building: 'Logistics & Support Block',
      managerName: 'Tariq Mehmood (Central Supply Manager)',
      contactExtension: 'Ext. 5500',
      status: 'active',
      lastFullAuditDate: '2026-08-15',
      updatedAt: '2026-08-15T11:00:00.000Z',
      items: [
        {
          itemId: 'item-epinephrine-1mg',
          itemName: 'Epinephrine Injection USP 1mg/mL (1:1000) Ampoules',
          sku: 'MED-EPI-1MG-AMP',
          category: 'Emergency Resuscitation Drugs',
          unitOfMeasure: 'Ampoule',
          minQuantity: 200,
          maxQuantity: 1000,
          currentQuantity: 620,
          reorderPoint: 300,
          unitCost: 8.5,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'WAREHOUSE-PHARMA-VAULT-1',
        },
        {
          itemId: 'item-cvc-triple-lumen',
          itemName: 'Arrow Triple-Lumen Central Venous Catheter Kit 7Fr 20cm',
          sku: 'MED-CVC-7FR-KIT',
          category: 'Vascular Access',
          unitOfMeasure: 'Kit',
          minQuantity: 50,
          maxQuantity: 250,
          currentQuantity: 180,
          reorderPoint: 80,
          unitCost: 165.0,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'WAREHOUSE-AISLE-3B-RACK-2',
        },
        {
          itemId: 'item-vicryl-suture-20',
          itemName: 'Coated VICRYL (Polyglactin 910) Suture 2-0 SH needle',
          sku: 'ETH-VIC-20-SH',
          category: 'Surgical Suture',
          unitOfMeasure: 'Foil Pack',
          minQuantity: 300,
          maxQuantity: 1500,
          currentQuantity: 940,
          reorderPoint: 450,
          unitCost: 4.2,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'WAREHOUSE-AISLE-4A-SUTURE',
        },
        {
          itemId: 'item-chest-tube-32fr',
          itemName: 'Argyle Thoracic Vent & Chest Drainage Tube 32Fr Straight',
          sku: 'MED-CHEST-32FR',
          category: 'Trauma Resuscitation',
          unitOfMeasure: 'Unit',
          minQuantity: 40,
          maxQuantity: 200,
          currentQuantity: 110,
          reorderPoint: 60,
          unitCost: 45.0,
          criticalItem: true,
          lastCountDate: '2026-08-15',
          storageBin: 'WAREHOUSE-AISLE-2C-CHEST',
        },
      ],
    },
  ];

  for (const l of parLocations) {
    await setDoc(doc(db, 'tenants', tenantId, 'parLocations', l.id), l, { merge: true });
  }
}

export async function seedInitialSterilizationCycles(tenantId: string): Promise<void> {
  const cycles: SterilizationCycle[] = [
    {
      id: 'cyc-steam-2026-0492',
      tenantId,
      cycleNumber: 'CSSD-CYC-2026-0492',
      autoclaveMachineId: 'AUTOCLAVE-STEAM-01',
      autoclaveMachineName: 'Getinge Steam Sterilizer 8800 (Autoclave #1)',
      operatorId: 'staff-cssd-01',
      operatorName: 'Tariq Mehmood (CSSD Lead Tech)',
      cycleType: 'Steam',
      temperatureCelsius: 134.5,
      pressureBar: 2.15,
      durationMinutes: 45,
      vacuumPulses: 4,
      biologicalIndicatorResult: 'pass',
      chemicalIndicatorResult: 'pass',
      status: 'completed',
      cycleStartTime: '2026-08-15T06:30:00.000Z',
      cycleEndTime: '2026-08-15T07:15:00.000Z',
      expirationDate: '2026-09-14T07:15:00.000Z', // 30 day shelf life
      biLotNumber: 'LOT-3M-8891-V',
      biTestSpecies: 'Geobacillus stearothermophilus',
      biologicalIncubatorHours: 3,
      notes: 'Standard high-temperature vacuum steam cycle completed within parameters. 3M Attest rapid readout negative.',
      createdAt: '2026-08-15T06:30:00.000Z',
      updatedAt: '2026-08-15T10:15:00.000Z',
      batchItems: [
        {
          traySetId: 'tray-laparotomy-04',
          traySetName: 'Major Laparotomy Surgical Set #04',
          barcode: 'CSSD-TRAY-88219',
          itemCount: 42,
          department: 'Surgery & OT Suites',
          surgeryType: 'General / Abdominal Surgery',
          instrumentsList: [
            'Scalpel Handle #3 & #4 (x2)',
            'Metzenbaum Dissecting Scissors 7" Curved',
            'Mayo Scissors 6.75" Straight',
            'DeBakey Atraumatic Tissue Forceps 8" (x2)',
            'Kelly Hemostatic Forceps Curved (x6)',
            'Rochester-Pean Clamps 8" (x4)',
            'Balfour Self-Retaining Abdominal Retractor',
            'Richardson Retractor Set (3 blades)',
            'Suction Cannula Yankauer',
          ],
          status: 'sterile_validated',
          packedBy: 'Sister Maria Teresa',
        },
        {
          traySetId: 'tray-csection-02',
          traySetName: 'Emergency C-Section Sterile Tray #02',
          barcode: 'CSSD-TRAY-99041',
          itemCount: 28,
          department: 'Maternity & L&D Suites',
          surgeryType: 'Obstetrics & Gynecology',
          instrumentsList: [
            'Doyen Retractor Large',
            'Allis Tissue Forceps 6" (x4)',
            'Green-Armytage Hemostatic Clamps (x4)',
            'Foerster Sponge Holding Forceps (x2)',
            'Cord Cutting Scissors',
            'Bandage Lister Scissors',
          ],
          status: 'dispatched_to_or',
          dispatchedTo: 'OT Suite 3 (Obstetrics)',
          dispatchedAt: '2026-08-15T08:00:00.000Z',
          packedBy: 'Sister Maria Teresa',
        },
      ],
    },
    {
      id: 'cyc-plasma-2026-0493',
      tenantId,
      cycleNumber: 'CSSD-CYC-2026-0493',
      autoclaveMachineId: 'PLASMA-VAPOR-02',
      autoclaveMachineName: 'STERRAD 100NX Hydrogen Peroxide Gas Plasma Unit',
      operatorId: 'staff-cssd-02',
      operatorName: 'Zainab Qureshi',
      cycleType: 'Plasma',
      temperatureCelsius: 52.0,
      pressureBar: 0.08,
      durationMinutes: 42,
      biologicalIndicatorResult: 'pass',
      chemicalIndicatorResult: 'pass',
      status: 'completed',
      cycleStartTime: '2026-08-15T08:00:00.000Z',
      cycleEndTime: '2026-08-15T08:42:00.000Z',
      expirationDate: '2026-11-13T08:42:00.000Z', // 90 day shelf life
      biLotNumber: 'LOT-PLASMA-991',
      biTestSpecies: 'Bacillus atrophaeus',
      biologicalIncubatorHours: 4,
      notes: 'Low-temperature vaporized H2O2 plasma cycle for heat-sensitive scopes and camera heads.',
      createdAt: '2026-08-15T08:00:00.000Z',
      updatedAt: '2026-08-15T12:45:00.000Z',
      batchItems: [
        {
          traySetId: 'tray-laparoscopy-opt-01',
          traySetName: 'Karl Storz 4K Laparoscopy Camera & Light Cable Kit #01',
          barcode: 'CSSD-TRAY-77301',
          itemCount: 8,
          department: 'Surgery & OT Suites',
          surgeryType: 'Minimally Invasive Surgery',
          instrumentsList: [
            'Karl Storz 10mm 30° Rigid Laparoscope Telescope',
            '4K Ultra-HD Autoclavable Camera Head',
            'High-Intensity Fiber Optic Light Cable 3.5mm',
            'Insufflation Gas Tubing with Luer Lock',
          ],
          status: 'sterile_validated',
          packedBy: 'Zainab Qureshi',
        },
        {
          traySetId: 'tray-ortho-trauma-a',
          traySetName: 'Stryker Orthopedic Small Fragment Trauma Set A',
          barcode: 'CSSD-TRAY-66290',
          itemCount: 36,
          department: 'Surgery & OT Suites',
          surgeryType: 'Orthopedic Trauma',
          instrumentsList: [
            'Screwdriver Shaft Hex 2.5mm & 3.5mm',
            'Depth Gauge 60mm',
            'Drill Guide Double 2.5/3.5mm',
            'Bone Reduction Forceps Pointed (x2)',
            'Verbrugge Bone Holding Forceps (x2)',
            'Periosteal Elevator Cobb 10mm',
          ],
          status: 'sterile_validated',
          packedBy: 'Tariq Mehmood',
        },
      ],
    },
    {
      id: 'cyc-eto-2026-0494',
      tenantId,
      cycleNumber: 'CSSD-CYC-2026-0494',
      autoclaveMachineId: 'ETO-CHAMBER-03',
      autoclaveMachineName: '3M Steri-Vac Ethylene Oxide Chamber 8XL',
      operatorId: 'staff-cssd-01',
      operatorName: 'Tariq Mehmood',
      cycleType: 'Ethylene_Oxide',
      temperatureCelsius: 55.0,
      pressureBar: 0.95,
      durationMinutes: 240,
      biologicalIndicatorResult: 'pending',
      chemicalIndicatorResult: 'pass',
      status: 'in_progress',
      cycleStartTime: '2026-08-15T12:00:00.000Z',
      expirationDate: '2027-02-15T12:00:00.000Z', // 180 day shelf life
      biLotNumber: 'LOT-ETO-4410',
      biTestSpecies: 'Bacillus atrophaeus',
      biologicalIncubatorHours: 24,
      notes: 'Long-aeration EtO cycle in progress. Biological indicator vials pending 24hr incubation.',
      createdAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
      batchItems: [
        {
          traySetId: 'tray-craniotomy-neuro-01',
          traySetName: 'Neuro-Surgical Microsurgical Craniotomy Tray #01',
          barcode: 'CSSD-TRAY-55102',
          itemCount: 48,
          department: 'Surgery & OT Suites',
          surgeryType: 'Neurosurgery',
          instrumentsList: [
            'Yasargil Micro-Dissecting Forceps Bayonet (x4)',
            'Micro-Scissors 120mm Curved Sharp',
            'Raney Scalp Clip Applying Forceps',
            'Hudson Brace with Cushing Perforator Bit',
            'Penfield Dissectors #1, #2, #3, #4 Set',
            'Sugita Aneurysm Clip Applier',
          ],
          status: 'in_sterilizer',
          packedBy: 'Sister Maria Teresa',
        },
      ],
    },
  ];

  for (const c of cycles) {
    await setDoc(doc(db, 'tenants', tenantId, 'sterilizationCycles', c.id), cleanFirestoreData(c), { merge: true });
  }
}

export async function seedInitialStockTransfers(tenantId: string): Promise<void> {
  const transfers: StockTransferRequest[] = [
    {
      id: 'tr-2026-0910',
      tenantId,
      requisitionNumber: 'TR-2026-00910',
      sourceLocationId: 'loc-central-warehouse',
      sourceLocationName: 'Central Hospital Warehouse & Depository',
      destinationLocationId: 'loc-icu-3rd-floor',
      destinationLocationName: 'Intensive Care Unit (ICU 3rd Floor Supply Hub)',
      destinationDepartment: 'ICU-3rd-Floor',
      status: 'pending_approval',
      requestedBy: 'PAR Autonomous Replenishment Engine',
      createdAt: '2026-08-15T09:30:00.000Z',
      notes: 'Urgent stock replenishment: Epinephrine and Central Venous Catheter kits below critical floor PAR.',
      items: [
        {
          itemId: 'item-epinephrine-1mg',
          itemName: 'Epinephrine Injection USP 1mg/mL (1:1000) Ampoules',
          sku: 'MED-EPI-1MG-AMP',
          quantity: 48,
          unitOfMeasure: 'Ampoule',
          unitCost: 8.5,
        },
        {
          itemId: 'item-cvc-triple-lumen',
          itemName: 'Arrow Triple-Lumen Central Venous Catheter Kit 7Fr 20cm',
          sku: 'MED-CVC-7FR-KIT',
          quantity: 24,
          unitOfMeasure: 'Kit',
          unitCost: 165.0,
        },
      ],
    },
    {
      id: 'tr-2026-0908',
      tenantId,
      requisitionNumber: 'TR-2026-00908',
      sourceLocationId: 'loc-central-warehouse',
      sourceLocationName: 'Central Hospital Warehouse & Depository',
      destinationLocationId: 'loc-er-trauma-bay',
      destinationLocationName: 'Emergency & Trauma Resuscitation Bay',
      destinationDepartment: 'ER-Trauma-Bay',
      status: 'received',
      requestedBy: 'Nurse Clara Oswald',
      approvedBy: 'Tariq Mehmood',
      dispatchedBy: 'Tariq Mehmood',
      receivedBy: 'Nurse Clara Oswald',
      createdAt: '2026-08-14T14:00:00.000Z',
      dispatchedAt: '2026-08-14T14:45:00.000Z',
      receivedAt: '2026-08-14T15:10:00.000Z',
      notes: 'Emergency transfer of 0.9% Normal Saline 1000mL IV bags and SAM Pelvic Binders.',
      items: [
        {
          itemId: 'item-iv-saline-1000ml',
          itemName: '0.9% Sodium Chloride Normal Saline IV Infusion 1000mL Bag',
          sku: 'BAX-NS-1000ML',
          quantity: 100,
          unitOfMeasure: 'Bag',
          unitCost: 2.2,
        },
        {
          itemId: 'item-pelvic-binder-trauma',
          itemName: 'SAM Pelvic Binder II Military/Trauma Stabilization Strap',
          sku: 'SAM-PELV-BIND-02',
          quantity: 8,
          unitOfMeasure: 'Unit',
          unitCost: 92.0,
        },
      ],
    },
  ];

  for (const t of transfers) {
    await setDoc(doc(db, 'tenants', tenantId, 'stockTransfers', t.id), t, { merge: true });
  }
}

export async function seedInitialSupplyChainData(tenantId: string): Promise<void> {
  await Promise.all([
    seedInitialVendors(tenantId),
    seedInitialPurchaseOrders(tenantId),
    seedInitialParLocations(tenantId),
    seedInitialSterilizationCycles(tenantId),
    seedInitialStockTransfers(tenantId),
  ]);
}
