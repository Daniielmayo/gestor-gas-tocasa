import { BudgetDoc, EnhancedTransaction, Scope } from './models';
import { formatCOP } from './currency';

export interface BudgetLineStatus {
  id: string;
  targetType: 'category' | 'tag';
  targetName: string;
  budgeted: number;
  spent: number;
  available: number;
  exceededBy: number;
  percentage: number;
  statusColor: 'green' | 'yellow' | 'red';
}

export interface BudgetStatusSummary {
  budget: BudgetDoc;
  totalBudgeted: number;
  totalSpent: number;
  totalAvailable: number;
  totalExceededBy: number;
  totalPercentage: number;
  statusColor: 'green' | 'yellow' | 'red';
  lineStatuses: BudgetLineStatus[];
}

export function getPeriodKey(date: Date, periodType: 'mensual' | 'quincenal'): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  if (periodType === 'mensual') {
    return `${y}-${m}`;
  }
  const day = date.getDate();
  const q = day <= 15 ? 'Q1' : 'Q2';
  return `${y}-${m}-${q}`;
}

export function matchesPeriodKey(txDate: Date, periodKey: string, periodType: 'mensual' | 'quincenal'): boolean {
  return getPeriodKey(txDate, periodType) === periodKey;
}

export function getSemanticBudgetColor(percentage: number): 'green' | 'yellow' | 'red' {
  if (percentage > 100) return 'red';
  if (percentage >= 80) return 'yellow';
  return 'green';
}

export function evaluateBudgetStatus(
  budget: BudgetDoc,
  transactions: EnhancedTransaction[],
  currentUserId: string
): BudgetStatusSummary {
  const relevantExpenses = transactions.filter((t) => {
    if (t.deletedAt) return false;
    if (t.type !== 'expense') return false;
    const txDate = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || Date.now());
    if (!matchesPeriodKey(txDate, budget.periodKey, budget.periodType)) return false;

    const txScope: Scope = t.scope || (t.sharedWith && t.sharedWith.length > 0 ? 'conjunto' : 'personal');
    if (budget.scope === 'personal') {
      return txScope === 'personal' && t.ownerId === currentUserId;
    }
    if (budget.scope === 'conjunto') {
      return txScope === 'conjunto';
    }
    return true;
  });

  const effectiveTotalBudget = (budget.totalAmount || 0) + (budget.rollover ? budget.rolloverAmount || 0 : 0);
  const totalSpent = relevantExpenses.reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const totalAvailable = Math.max(0, effectiveTotalBudget - totalSpent);
  const totalExceededBy = totalSpent > effectiveTotalBudget ? totalSpent - effectiveTotalBudget : 0;
  const totalPercentage = effectiveTotalBudget > 0 ? Math.round((totalSpent / effectiveTotalBudget) * 100) : 0;

  const lineStatuses: BudgetLineStatus[] = (budget.lines || []).map((line) => {
    const spent = relevantExpenses
      .filter((t) => {
        if (line.targetType === 'category') {
          return t.category?.toLowerCase() === line.targetName.toLowerCase();
        }
        return (t.tags || []).some((tag) => tag.toLowerCase() === line.targetName.toLowerCase());
      })
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const available = Math.max(0, line.amount - spent);
    const exceededBy = spent > line.amount ? spent - line.amount : 0;
    const percentage = line.amount > 0 ? Math.round((spent / line.amount) * 100) : 0;

    return {
      id: line.id,
      targetType: line.targetType,
      targetName: line.targetName,
      budgeted: line.amount,
      spent,
      available,
      exceededBy,
      percentage,
      statusColor: getSemanticBudgetColor(percentage),
    };
  });

  return {
    budget,
    totalBudgeted: effectiveTotalBudget,
    totalSpent,
    totalAvailable,
    totalExceededBy,
    totalPercentage,
    statusColor: getSemanticBudgetColor(totalPercentage),
    lineStatuses,
  };
}

export interface TriggeredBudgetAlert {
  alertKey: string;
  title: string;
  message: string;
  severity: 'warning' | 'danger';
}

export function checkNewBudgetAlerts(
  status: BudgetStatusSummary
): TriggeredBudgetAlert[] {
  const alreadyFired = new Set(status.budget.firedAlerts || []);
  const triggered: TriggeredBudgetAlert[] = [];
  const thresholds = status.budget.alertThresholds?.length ? status.budget.alertThresholds : [80, 100];

  // Check global budget thresholds
  if (status.totalBudgeted > 0) {
    for (const threshold of thresholds) {
      const key = `total_${threshold}`;
      if (status.totalPercentage >= threshold && !alreadyFired.has(key)) {
        if (status.totalExceededBy > 0) {
          triggered.push({
            alertKey: key,
            title: 'Presupuesto general excedido',
            message: `Te pasaste ${formatCOP(status.totalExceededBy)} en el presupuesto general (gastado ${formatCOP(status.totalSpent)} de ${formatCOP(status.totalBudgeted)})`,
            severity: 'danger',
          });
        } else {
          triggered.push({
            alertKey: key,
            title: `Alerta de presupuesto (${status.totalPercentage}%)`,
            message: `Alcanzaste el ${status.totalPercentage}% del presupuesto general (${formatCOP(status.totalSpent)} de ${formatCOP(status.totalBudgeted)})`,
            severity: threshold >= 100 ? 'danger' : 'warning',
          });
        }
      }
    }
  }

  // Check per-category / per-tag line thresholds
  for (const line of status.lineStatuses) {
    if (line.budgeted <= 0) continue;
    for (const threshold of thresholds) {
      const key = `${line.targetType}_${line.targetName}_${threshold}`;
      if (line.percentage >= threshold && !alreadyFired.has(key)) {
        const label = line.targetType === 'tag' ? `#${line.targetName}` : line.targetName;
        if (line.exceededBy > 0) {
          triggered.push({
            alertKey: key,
            title: `Exceso en ${label}`,
            message: `Te pasaste ${formatCOP(line.exceededBy)} en ${label} (gastado ${formatCOP(line.spent)} de ${formatCOP(line.budgeted)})`,
            severity: 'danger',
          });
        } else {
          triggered.push({
            alertKey: key,
            title: `Alerta en ${label} (${line.percentage}%)`,
            message: `Llevas ${formatCOP(line.spent)} de ${formatCOP(line.budgeted)} (${line.percentage}%) en ${label}`,
            severity: threshold >= 100 ? 'danger' : 'warning',
          });
        }
      }
    }
  }

  return triggered;
}
