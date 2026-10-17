import { EnhancedTransaction, SettlementDoc, SplitRule } from './models';

export interface PartnerBalanceResult {
  userAId: string;
  userAName: string;
  userBId: string;
  userBName: string;
  splitRule: SplitRule;
  shareRatioA: number; // e.g., 0.5 for 50/50
  shareRatioB: number; // e.g., 0.5 for 50/50
  totalJointExpenses: number;
  paidByA: number;
  paidByB: number;
  shouldPayA: number;
  shouldPayB: number;
  settledAtoB: number;
  settledBtoA: number;
  netBalanceA: number; // positive means B owes A; negative means A owes B
  debtorId: string | null;
  debtorName: string | null;
  creditorId: string | null;
  creditorName: string | null;
  netAmountOwed: number;
}

export function calculatePartnerBalance(params: {
  userAId: string;
  userAName: string;
  userBId: string;
  userBName: string;
  transactions: EnhancedTransaction[];
  settlements: SettlementDoc[];
  splitRule?: SplitRule;
}): PartnerBalanceResult {
  const {
    userAId,
    userAName,
    userBId,
    userBName,
    transactions,
    settlements,
    splitRule = '50_50',
  } = params;

  const activeTxs = transactions.filter((t) => !t.deletedAt);

  // Determine proportional ratios if splitRule === 'proportional'
  let shareRatioA = 0.5;
  let shareRatioB = 0.5;

  if (splitRule === 'proportional') {
    const incomeA = activeTxs
      .filter((t) => t.type === 'income' && (t.paidByUserId || t.ownerId) === userAId)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const incomeB = activeTxs
      .filter((t) => t.type === 'income' && (t.paidByUserId || t.ownerId) === userBId)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalIncome = incomeA + incomeB;
    if (totalIncome > 0) {
      shareRatioA = incomeA / totalIncome;
      shareRatioB = incomeB / totalIncome;
    }
  }

  // Filter joint expenses (RF-12: includes payments made with either partner's card, attributed to paidByUserId)
  const jointExpenses = activeTxs.filter((t) => {
    if (t.type !== 'expense') return false;
    const scope = t.scope || (t.sharedWith && t.sharedWith.length > 0 ? 'conjunto' : 'personal');
    return scope === 'conjunto';
  });

  let totalJointExpenses = 0;
  let paidByA = 0;
  let paidByB = 0;

  for (const exp of jointExpenses) {
    const amt = Number(exp.amount || 0);
    const payer = exp.paidByUserId || exp.ownerId;
    if (payer === userAId) {
      paidByA += amt;
      totalJointExpenses += amt;
    } else if (payer === userBId) {
      paidByB += amt;
      totalJointExpenses += amt;
    }
  }

  const shouldPayA = Math.round(totalJointExpenses * shareRatioA);
  const shouldPayB = Math.round(totalJointExpenses * shareRatioB);

  let settledAtoB = 0;
  let settledBtoA = 0;

  for (const s of settlements) {
    const amt = Number(s.amount || 0);
    if (s.fromUserId === userAId && s.toUserId === userBId) {
      settledAtoB += amt;
    } else if (s.fromUserId === userBId && s.toUserId === userAId) {
      settledBtoA += amt;
    }
  }

  // Net position for A: (what A paid toward joint - what A should have paid) + (what A settled to B - what B settled to A)
  const netBalanceA = Math.round((paidByA - shouldPayA) + (settledAtoB - settledBtoA));

  let debtorId: string | null = null;
  let debtorName: string | null = null;
  let creditorId: string | null = null;
  let creditorName: string | null = null;
  const netAmountOwed = Math.abs(netBalanceA);

  if (netBalanceA > 0) {
    // B owes A
    debtorId = userBId;
    debtorName = userBName;
    creditorId = userAId;
    creditorName = userAName;
  } else if (netBalanceA < 0) {
    // A owes B
    debtorId = userAId;
    debtorName = userAName;
    creditorId = userBId;
    creditorName = userBName;
  }

  return {
    userAId,
    userAName,
    userBId,
    userBName,
    splitRule,
    shareRatioA,
    shareRatioB,
    totalJointExpenses,
    paidByA,
    paidByB,
    shouldPayA,
    shouldPayB,
    settledAtoB,
    settledBtoA,
    netBalanceA,
    debtorId,
    debtorName,
    creditorId,
    creditorName,
    netAmountOwed,
  };
}
