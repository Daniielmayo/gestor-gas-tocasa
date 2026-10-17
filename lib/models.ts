export type Scope = 'personal' | 'conjunto';
export type SplitRule = '50_50' | 'proportional';
export type PaymentMethodType = 'credito' | 'debito' | 'efectivo' | 'transferencia';
export type PeriodType = 'mensual' | 'quincenal';
export type QuincenaHalf = 1 | 2;
export type IncomeFrequency = 'mensual' | 'quincenal' | 'unico';

export interface Household {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  splitRule: SplitRule;
  memberIds: string[];
  inviteCode: string;
  personalVisibility: 'totals_only' | 'full_detail';
  createdAt?: any;
  updatedAt?: any;
}

export interface PaymentMethod {
  id: string;
  householdId: string;
  type: PaymentMethodType;
  alias: string;
  last4?: string;
  holderUserId: string;
  holderName?: string;
  bank?: string;
  creditLimit?: number;
  cutDay?: number;
  dueDay?: number;
  active: boolean;
  ownerId: string;
  sharedWith: string[];
  createdAt?: any;
}

export interface CategoryDef {
  id: string;
  householdId?: string;
  name: string;
  type: 'income' | 'expense';
  parentId?: string | null;
  color: string;
  icon: string;
  ownerId?: string;
  sharedWith?: string[];
  isDefault?: boolean;
}

export interface TagDef {
  id: string;
  householdId?: string;
  name: string;
  color: string;
  ownerId: string;
  sharedWith: string[];
}

export interface KnownPlace {
  id: string;
  householdId?: string;
  name: string;
  defaultCategory: string;
  defaultTags?: string[];
  defaultPaymentMethodId?: string | null;
  defaultScope?: Scope;
  ownerId: string;
  sharedWith: string[];
}

export interface IncomeSourceDef {
  id: string;
  householdId?: string;
  name: string;
  type: 'fijo' | 'variable';
  defaultAmount?: number;
  frequency?: IncomeFrequency;
  payDay?: number | null;
  defaultCategory: string;
  defaultScope?: Scope;
  active: boolean;
  ownerId: string;
  sharedWith: string[];
}

export interface AttachmentMeta {
  id: string;
  publicId: string;
  secureUrl: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  uploadedAt?: string;
}

export interface EnhancedTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  categoryId?: string;
  place?: string;
  description?: string;
  title?: string;
  note?: string;
  scope?: Scope; // defaults to 'conjunto' if sharedWith.length > 0 else 'personal' on legacy records
  ownerId: string;
  ownerName?: string;
  paidByUserId?: string;
  paidByName?: string;
  paymentMethodId?: string | null;
  paymentMethodAlias?: string | null;
  tags?: string[];
  attachments?: AttachmentMeta[];
  incomeType?: 'fijo' | 'variable';
  incomeFrequency?: IncomeFrequency;
  payDay?: number | null;
  householdId?: string;
  sharedWith: string[];
  recurringPaymentId?: string | null;
  recurringPaymentTitle?: string | null;
  deletedAt?: any | null;
  createdAt: any;
  spentAt?: any;
  updatedAt?: any;
  updatedBy?: string;
}

export interface BudgetLine {
  id: string;
  targetType: 'category' | 'tag';
  targetName: string; // category name or tag name
  amount: number;
}

export interface BudgetDoc {
  id: string;
  householdId?: string;
  ownerId: string;
  sharedWith: string[];
  scope: Scope | 'all';
  periodType: PeriodType;
  periodKey: string; // e.g. '2026-10' or '2026-10-Q1' / '2026-10-Q2'
  totalAmount: number;
  rollover: boolean;
  rolloverAmount?: number;
  lines: BudgetLine[];
  alertThresholds: number[]; // default [80, 100]
  firedAlerts?: string[]; // keys like 'total_80', 'cat_Supermercado_100'
  createdAt?: any;
  updatedAt?: any;
}

export interface WorksheetObligationItem {
  id: string;
  concept: string; // e.g., 'Arriendo', 'Ahorrado arriendo', 'Mercado', 'Addi'
  amount: number; // positive for obligation/debt, negative for discount/saved offset
  paid?: boolean;
}

export interface UserPeriodWorksheet {
  id: string;
  householdId?: string;
  userId: string;
  userName: string;
  sharedWith: string[];
  periodKey: string; // e.g., '2026-10-Q1', '2026-10-Q2', or '2026-10'
  fixedSalary: number; // SUELDO / Ingreso Fijo del corte
  obligations: WorksheetObligationItem[]; // Lista de DEUDA / Compromisos fijos
  updatedAt?: any;
}

export interface SettlementDoc {
  id: string;
  householdId?: string;
  ownerId: string;
  sharedWith: string[];
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  amount: number;
  note?: string;
  settledAt: any;
  createdAt: any;
}

export const DEFAULT_EXPENSE_CATEGORIES: CategoryDef[] = [
  { id: 'def-supermercado', name: 'Supermercado', type: 'expense', color: '#10B981', icon: 'ShoppingCart', isDefault: true },
  { id: 'def-alimentacion', name: 'Alimentación', type: 'expense', color: '#F59E0B', icon: 'Utensils', isDefault: true },
  { id: 'def-hogar', name: 'Hogar / Alquiler', type: 'expense', color: '#3B82F6', icon: 'Home', isDefault: true },
  { id: 'def-servicios', name: 'Servicios', type: 'expense', color: '#06B6D4', icon: 'Zap', isDefault: true },
  { id: 'def-transporte', name: 'Transporte', type: 'expense', color: '#8B5CF6', icon: 'Car', isDefault: true },
  { id: 'def-ocio', name: 'Ocio / Salidas', type: 'expense', color: '#EC4899', icon: 'Sparkles', isDefault: true },
  { id: 'def-salud', name: 'Salud', type: 'expense', color: '#EF4444', icon: 'HeartPulse', isDefault: true },
  { id: 'def-mascotas', name: 'Mascotas', type: 'expense', color: '#D97706', icon: 'PawPrint', isDefault: true },
  { id: 'def-educacion', name: 'Educación', type: 'expense', color: '#6366F1', icon: 'GraduationCap', isDefault: true },
  { id: 'def-ahorro', name: 'Ahorro / Meta', type: 'expense', color: '#14B8A6', icon: 'PiggyBank', isDefault: true },
  { id: 'def-deuda', name: 'Pago Deuda / Tarjeta', type: 'expense', color: '#F43F5E', icon: 'CreditCard', isDefault: true },
  { id: 'def-otros', name: 'Otros', type: 'expense', color: '#6B7280', icon: 'Tag', isDefault: true },
];

export const DEFAULT_INCOME_CATEGORIES: CategoryDef[] = [
  { id: 'def-inc-sueldo', name: 'Sueldo / Quincena', type: 'income', color: '#10B981', icon: 'Briefcase', isDefault: true },
  { id: 'def-inc-freelance', name: 'Freelance / Extra', type: 'income', color: '#3B82F6', icon: 'Laptop', isDefault: true },
  { id: 'def-inc-arriendo', name: 'Arriendo Recibido', type: 'income', color: '#8B5CF6', icon: 'Building', isDefault: true },
  { id: 'def-inc-venta', name: 'Venta / Reembolso', type: 'income', color: '#F59E0B', icon: 'Coins', isDefault: true },
  { id: 'def-inc-transferencia', name: 'Transferencia', type: 'income', color: '#06B6D4', icon: 'ArrowLeftRight', isDefault: true },
];

export const DEFAULT_TAGS: { name: string; color: string }[] = [
  { name: 'mercado', color: '#10B981' },
  { name: 'dolarcity', color: '#3B82F6' },
  { name: 'domicilio', color: '#F59E0B' },
  { name: 'cita', color: '#EC4899' },
  { name: 'emergencia', color: '#EF4444' },
  { name: 'vacaciones', color: '#8B5CF6' },
  { name: 'regalo', color: '#14B8A6' },
];
