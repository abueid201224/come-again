export interface MasterInvoiceItem {
  id?: number;
  orderNo?: string;
  invoiceNo: string;
  itemCode: string;
  itemName: string;
  unit: string;
  requiredQty: number;
  importedAt: string;
  originalIndex?: number;
}

export type CodeStatus = 'MATCH' | 'MISMATCH';
export type QtyStatus = 'EXACT' | 'SHORTAGE' | 'SURPLUS';

export interface ScannedAuditItem {
  orderNo?: string;
  itemCode: string;
  itemName: string;
  unit: string;
  requiredQty: number;
  actualQty: number;
  codeStatus: CodeStatus;
  qtyStatus: QtyStatus;
  lastScannedAt: string;
  scanHistory: string[]; // timestamps of each scan
  originalIndex: number; // to preserve original Excel order
}

export type LongBarcodePolicy = 'ASK' | 'ALLOW' | 'BLOCK';

export interface ActiveInvoiceSession {
  orderNo?: string;
  invoiceNo: string;
  auditorName?: string;
  auditorId?: string;
  auditorSignature?: string;
  startedAt: string;
  lastActivityAt: string;
  items: Record<string, ScannedAuditItem>; // Keyed by itemCode
  isLocked: boolean;
  lastScannedItemCode?: string | null;
  longBarcodePolicy?: LongBarcodePolicy; // 'ASK' (prompt), 'ALLOW' (accept silently), 'BLOCK' (reject silently)
}

export interface IncompleteInvoiceRecord {
  invoiceNo: string;
  orderNo?: string;
  auditorName?: string;
  auditorId?: string;
  savedAt: string;
  session: ActiveInvoiceSession;
  completedItemsCount: number;
  totalItemsCount: number;
  missingQty: number;
  scannedQty: number;
  totalRequiredQty: number;
}

export interface CompletedInvoiceRecord {
  invoiceNo: string;
  orderNo?: string;
  auditorName?: string;
  auditorId?: string;
  auditorSignature?: string;
  completedAt: string;
  totalItems: number;
  totalQty: number;
}

export interface AuditDiscrepancy {
  id?: number;
  orderNo?: string;
  invoiceNo: string;
  itemCode: string;
  itemName: string;
  unit: string;
  requiredQty: number;
  actualQty: number;
  codeStatus: CodeStatus;
  qtyStatus: QtyStatus;
  difference: number; // actualQty - requiredQty
  auditedAt: string;
  auditorName?: string;
  auditorId?: string;
  notes?: string;
}

export interface WrongPickingItem {
  id?: number;
  orderNo?: string;
  activeInvoiceNo: string;
  itemCode: string;
  itemName?: string;
  unit?: string;
  actualBelongingInvoiceNo?: string; // If found under another invoice in master data
  actualBelongingOrderNo?: string;
  scannedAt: string;
  auditorName?: string;
  auditorId?: string;
  quantity: number;
  notes?: string;
}

export type WrongPickingRecord = WrongPickingItem;

export interface InvoiceAuditHistory {
  id?: number;
  orderNo?: string;
  invoiceNo: string;
  auditorName?: string;
  auditorId?: string;
  totalRequiredItems: number;
  totalRequiredQty?: number;
  totalScannedQty?: number;
  scannedItemsCount: number;
  exactItemsCount: number;
  discrepancyCount: number;
  status: 'CLEAN' | 'DISCREPANCIES_FOUND' | 'COMPLETED' | 'INCOMPLETE';
  completedAt: string;
  durationSeconds: number;
}

export interface SyncMetadata {
  lastSyncDate: string | null;
  totalInvoices: number;
  totalItems: number;
  fileName: string | null;
  fileSize?: string;
}

export interface AppSettings {
  language: 'ar' | 'en';
  soundEnabled: boolean;
  soundVolume: number;
  vibrationEnabled: boolean;
  scannerPrefixInvoice: string; // optional prefix for invoice barcode e.g. "INV-"
  scannerMinLength: number;
  autoSwitchOnNewInvoice: boolean;
  itemSortMode: 'LAST_SCANNED' | 'ORIGINAL_ORDER' | 'PENDING_FIRST' | 'ERRORS_FIRST';
  enableCameraQr: boolean;
  longBarcodeThreshold?: number; // default: 10 digits
  auditorName?: string;
  auditorId?: string;
  auditorTitle?: string;
  auditorSignature?: string;
}

// -------------------------------------------------------------
// Packaging Grouping & Barcode Filtering Rules (شروط ضم العبوات)
// -------------------------------------------------------------
export interface PackagingGroupRule {
  id: string;
  name: string; // e.g. "مجموعة العصائر 250 مل"
  startBarcode: string; // e.g. "6221000100"
  endBarcode: string;   // e.g. "6221000199"
  category?: string;
  cartonFactor: number; // e.g. 24 pieces per master carton
  packFactor: number;   // e.g. 6 pieces per shrink/inner pack
  unitName: string;     // e.g. "حبة"
  isActive: boolean;
  notes?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// Returns & Quality Inspection & Refund Models (المرتجعات والفحص وطلبات الاسترداد)
// -------------------------------------------------------------
export type ReturnItemCondition = 'VALID_FOR_RESTOCK' | 'TRANSFERRED_TO_LAB' | 'INTACT' | 'DAMAGED';
export type LabDecision = 'PENDING' | 'APPROVED_FOR_RESTOCK' | 'REJECTED_SCRAP';
export type ReturnReason = 'CUSTOMER_REFUSED' | 'DEFECTIVE' | 'EXPIRED_NEAR' | 'WRONG_DELIVERY' | 'OVER_ORDERED' | 'OTHER';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CREDIT_BALANCE' | 'COD';
export type ReturnReportStatus = 'COMPLETED' | 'PENDING_LAB' | 'DRAFT' | 'CANCELLED';

export interface ReturnSessionItem {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
  invoicedQty: number; // Quantity on original customer invoice
  actualReturnedQty: number; // Editable actual return qty received under inspection
  scannedQty: number; // Real-time verified physical barcode scans
  unitPrice: number; // Unit price from invoice or manual entry
  refundTotal: number; // actualReturnedQty * unitPrice
  condition: ReturnItemCondition; // 'VALID_FOR_RESTOCK' (صالحة للمستودع) or 'TRANSFERRED_TO_LAB' (محولة للمعمل)
  inspectionDecision?: 'WAREHOUSE' | 'LAB'; // قرار الفحص المبدئي: إعادة للمخزن الصالح / تحويل للمعمل الفني
  size?: string; // المقاس (e.g. XL, M, L, 18R)
  color?: string; // اللون (e.g. أبيض, أسود)
  packagingCondition?: string; // حالة التغليف للملابس الداخلية (e.g. مغلق بتغليف المصنع, مفتوح, غير مغلف)
  reasonText?: string; // سبب الإرجاع (e.g. رفض العميل الاستلام, عيب صناعة, مقاس غير مناسب, مرتجع)
  inspectorName?: string; // اسم فاحص الجودة
  labDecision?: LabDecision; // 'PENDING' | 'APPROVED_FOR_RESTOCK' | 'REJECTED_SCRAP'
  labNotes?: string;
  reason?: ReturnReason;
  notes?: string;
  isIncludedInRefund: boolean; // toggle to include/exclude
}

export interface ReturnReport {
  id: string;
  returnReceiptNo: string; // e.g. return2000178535
  rmaNo?: string;
  originalInvoiceNo: string;
  orderNo?: string;
  customerName: string;
  paymentMethod: PaymentMethod;
  createdAt: string;
  auditorName: string;
  auditorId: string;
  auditorSignature?: string;
  status: ReturnReportStatus; // 'COMPLETED' (مرتجع مكتمل للمستودع) or 'PENDING_LAB' (معلق لمراجعة المعمل)
  items: ReturnSessionItem[];
  totalInvoicedQty: number;
  totalReturnedQty: number;
  totalValidForRestockQty: number;
  totalTransferredToLabQty: number;
  totalRefundAmount: number;
  labName?: string; // اسم معمل الاستلام
  labTestType?: string; // طبيعة الاختبار
  labTransferDate?: string; // تاريخ التحويل
  labNotes?: string;
  labResolvedAt?: string;
  labAuditorName?: string;
  isOverdueForLab?: boolean; // > 1 business day (24h) since created
  notes?: string;
}

export interface RefundRequestRecord {
  id: string;
  returnReceiptNo: string;
  originalInvoiceNo: string;
  orderNo?: string;
  customerName: string;
  paymentMethod: PaymentMethod;
  returnedItemCodes: string[];
  totalRefundAmount: number;
  returnReportStatus: ReturnReportStatus;
  refundStatus: 'COMPLETED' | 'BLOCKED_PENDING_LAB' | 'CANCELLED';
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  notes?: string;
}

// -------------------------------------------------------------
// Inbound Receiving Models (الاستلام والتوريدات)
// -------------------------------------------------------------
export interface ReceivingSessionItem {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
  expectedQty: number;
  receivedQty: number;
  damagedQty: number;
  cartonFactor?: number;
  packFactor?: number;
  cartonsCount?: number;
  packsCount?: number;
  piecesCount?: number;
  unitCost?: number;
  batchNumber?: string;
  expiryDate?: string;
  status: 'EXACT' | 'SHORTAGE' | 'SURPLUS' | 'DAMAGED';
  notes?: string;
}

export interface ReceivingReport {
  id: string;
  poNumber: string;
  supplierName: string;
  deliveryNoteNo?: string;
  createdAt: string;
  auditorName: string;
  auditorId: string;
  auditorSignature?: string;
  status: 'DRAFT' | 'ACCEPTED_FULL' | 'ACCEPTED_WITH_VARIANCE' | 'REJECTED';
  items: ReceivingSessionItem[];
  totalExpectedQty: number;
  totalReceivedQty: number;
  totalDamagedQty: number;
  notes?: string;
}

// -------------------------------------------------------------
// Cycle Count & Packaging Breakdown Models (الجرد الدوري واحتساب العبوات)
// -------------------------------------------------------------
export interface InventoryCountItem {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
  groupId?: string;
  groupName?: string;
  bookQty: number; // الرصيد الدفتري من الإكسيل
  cartonsCount: number; // عدد الكراتين
  cartonFactor: number; // معامل الكرتونة (مثلاً 24)
  packsCount: number; // عدد الباكتات
  packFactor: number; // معامل الباكت (مثلاً 6)
  piecesCount: number; // حبات فردية
  calculatedActualQty: number; // (cartons * factor) + (packs * factor) + pieces
  varianceQty: number; // calculatedActualQty - bookQty
  status: 'EXACT' | 'SHORTAGE' | 'SURPLUS';
  lastScannedAt?: string;
  notes?: string;
}

export interface InventoryCountReport {
  id: string;
  title: string;
  sectionOrAisle?: string;
  createdAt: string;
  auditorName: string;
  auditorId: string;
  auditorSignature?: string;
  items: InventoryCountItem[];
  totalBookQty: number;
  totalActualQty: number;
  totalVarianceQty: number;
  notes?: string;
}

// -------------------------------------------------------------
// Warehouse Workers & Experience Levels (إدارة العمال ومستويات الخبرة)
// -------------------------------------------------------------
export type WorkerExperienceLevel = 'EXPERT' | 'INTERMEDIATE' | 'NOVICE';
export type GroupDifficultyLevel = 'HIGH_EXPERT' | 'MEDIUM_INTERMEDIATE' | 'LOW_NOVICE';

export interface WarehouseWorker {
  id: string;
  name: string;
  code: string; // Worker ID or badge e.g. "EMP-101"
  experienceLevel: WorkerExperienceLevel; // 'EXPERT' (خبير) | 'INTERMEDIATE' (متوسط) | 'NOVICE' (مبتدئ)
  isActive: boolean;
  phone?: string;
  specialty?: string; // e.g. "أدوية وزجاجيات", "مواد غذائية", "مستلزمات عامة"
  createdAt: string;
}

// -------------------------------------------------------------
// Batch Picking List & Packaging Aggregation (قائمة التقاط الفواتير المجمعة)
// -------------------------------------------------------------
export interface InvoiceItemSource {
  invoiceNo: string;
  orderNo?: string;
  customerName?: string;
  qty: number;
}

export interface AggregatedPickingItem {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
  groupId: string;
  groupName: string;
  totalRequiredQty: number;
  pickedQty: number; // For live picking / verification
  cartonFactor: number;
  packFactor: number;
  cartonsCount: number;
  packsCount: number;
  piecesCount: number;
  invoiceSources: InvoiceItemSource[]; // detailed breakdown of invoices requesting this item
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  location?: string;
  notes?: string;
}

export interface PickingProductGroup {
  groupId: string;
  groupName: string;
  difficulty: GroupDifficultyLevel; // 'HIGH_EXPERT' | 'MEDIUM_INTERMEDIATE' | 'LOW_NOVICE'
  assignedWorkerId?: string;
  assignedWorkerName?: string;
  assignedWorkerLevel?: WorkerExperienceLevel;
  items: AggregatedPickingItem[];
  totalQty: number;
  totalCartons: number;
  totalPacks: number;
  totalPieces: number;
  invoicesCount: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface BatchPickingWave {
  id: string;
  waveNo: string; // e.g. "WAVE-2026-0801"
  title: string;
  createdAt: string;
  createdBy: string;
  totalInvoicesCount: number;
  invoiceNumbers: string[];
  totalItemsCount: number;
  totalQuantity: number;
  totalCartons: number;
  totalPacks: number;
  totalPieces: number;
  groups: PickingProductGroup[];
  status: 'DRAFT' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED';
  notes?: string;
}

export type WarehouseModuleTab = 'dashboard' | 'receiving' | 'audit' | 'returns' | 'inventory' | 'picking' | 'packaging_groups' | 'errors' | 'master' | 'settings';

export type ActiveTargetColumn = 'cartons' | 'packs' | 'pieces' | 'direct_qty';

export interface DocumentReopenPrompt {
  isOpen: boolean;
  documentType: 'RETURN' | 'REFUND' | 'INVENTORY' | 'RECEIVING' | 'PICKING';
  documentId: string;
  documentNo: string;
  title: string;
  onConfirm: () => void;
}

