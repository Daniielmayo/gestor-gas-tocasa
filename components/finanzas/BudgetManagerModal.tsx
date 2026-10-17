'use client';
import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/context/AuthContext';
import { useHousehold } from '@/context/HouseholdContext';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { BudgetDoc, BudgetLine, PeriodType, Scope } from '@/lib/models';
import { getPeriodKey } from '@/lib/budgetEngine';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import { Copy, Plus, Trash2 } from 'lucide-react';

interface BudgetManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDate: Date;
  existingBudget?: BudgetDoc | null;
  allBudgets: BudgetDoc[];
}

export function BudgetManagerModal({
  isOpen,
  onClose,
  currentDate,
  existingBudget = null,
  allBudgets = [],
}: BudgetManagerModalProps) {
  const { user } = useAuth();
  const { household, partnerUid, categories, tags } = useHousehold();

  const [periodType, setPeriodType] = useState<PeriodType>(
    existingBudget?.periodType || 'mensual'
  );
  const [scope, setScope] = useState<Scope | 'all'>(existingBudget?.scope || 'conjunto');
  const [totalAmount, setTotalAmount] = useState(
    existingBudget?.totalAmount ? formatInputCOP(String(existingBudget.totalAmount)) : ''
  );
  const [rollover, setRollover] = useState<boolean>(existingBudget?.rollover ?? false);
  const [lines, setLines] = useState<BudgetLine[]>(existingBudget?.lines || []);

  // Line creator state
  const [lineType, setLineType] = useState<'category' | 'tag'>('category');
  const [lineTarget, setLineTarget] = useState('');
  const [lineAmount, setLineAmount] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    if (existingBudget) {
      setPeriodType(existingBudget.periodType);
      setScope(existingBudget.scope);
      setTotalAmount(formatInputCOP(String(existingBudget.totalAmount)));
      setRollover(existingBudget.rollover ?? false);
      setLines(existingBudget.lines || []);
    } else {
      setPeriodType('mensual');
      setScope('conjunto');
      setTotalAmount('');
      setRollover(false);
      setLines([]);
    }
  }, [isOpen, existingBudget]);

  const expenseCategories = categories.filter((c) => c.type === 'expense');

  const handleAddLine = () => {
    if (!lineTarget || !lineAmount) return;
    const amt = parseCOP(lineAmount);
    if (amt <= 0) return;

    const filtered = lines.filter(
      (l) => !(l.targetType === lineType && l.targetName.toLowerCase() === lineTarget.toLowerCase())
    );
    setLines([
      ...filtered,
      {
        id: `bl_${Date.now()}`,
        targetType: lineType,
        targetName: lineTarget,
        amount: amt,
      },
    ]);
    setLineAmount('');
  };

  const handleCopyPreviousBudget = () => {
    const previous = allBudgets.find((b) => b.id !== existingBudget?.id);
    if (!previous) {
      alert('No se encontró un presupuesto de un periodo anterior para copiar.');
      return;
    }
    setPeriodType(previous.periodType);
    setScope(previous.scope);
    setTotalAmount(formatInputCOP(String(previous.totalAmount)));
    setRollover(previous.rollover);
    setLines(previous.lines || []);
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSaving) return;

    const numericTotal = parseCOP(totalAmount);
    const linesSum = lines.reduce((sum, l) => sum + l.amount, 0);
    const finalTotal = numericTotal > 0 ? numericTotal : linesSum;

    if (finalTotal <= 0) {
      alert('Define un monto total o al menos un tope por categoría/tag.');
      return;
    }

    setIsSaving(true);
    try {
      const periodKey = getPeriodKey(currentDate, periodType);
      const payload = {
        householdId: household?.id || 'default',
        ownerId: user.uid,
        sharedWith: partnerUid ? [partnerUid] : [],
        scope,
        periodType,
        periodKey,
        totalAmount: finalTotal,
        rollover,
        lines,
        alertThresholds: [80, 100],
        updatedAt: serverTimestamp(),
      };

      if (existingBudget) {
        await updateDoc(doc(db, 'budgets', existingBudget.id), payload);
      } else {
        await addDoc(collection(db, 'budgets'), {
          ...payload,
          firedAlerts: [],
          createdAt: serverTimestamp(),
        });
      }
      onClose();
    } catch (err) {
      console.error('Error saving budget:', err);
      alert('No se pudo guardar el presupuesto.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Configurar Presupuesto (RF-07)">
      <form onSubmit={handleSaveBudget} style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}>
        {allBudgets.length > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={handleCopyPreviousBudget}>
            <Copy size={14} />
            <span style={{ marginLeft: '6px' }}>Copiar presupuesto del periodo anterior</span>
          </Button>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label className="text-label-sm">Periodicidad</label>
            <select
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as PeriodType)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '10px',
                border: '1px solid var(--color-outline-variant)',
                marginTop: '4px',
              }}
            >
              <option value="mensual">Mensual (Mes completo)</option>
              <option value="quincenal">Quincenal (1–15 / 16–Fin)</option>
            </select>
          </div>
          <div>
            <label className="text-label-sm">Ámbito del Presupuesto</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope | 'all')}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '10px',
                border: '1px solid var(--color-outline-variant)',
                marginTop: '4px',
              }}
            >
              <option value="conjunto">Conjunto (Hogar)</option>
              <option value="personal">Personal (Solo mío)</option>
              <option value="all">Todo (Personal + Conjunto)</option>
            </select>
          </div>
        </div>

        <Input
          label="Tope Total del Periodo ($)"
          placeholder="Ej. 3.500.000"
          value={totalAmount}
          onChange={(e) => setTotalAmount(formatInputCOP(e.target.value))}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={rollover}
            onChange={(e) => setRollover(e.target.checked)}
          />
          <span>Acumular sobrante o déficit al siguiente periodo (Rollover)</span>
        </label>

        {/* Líneas por Categoría o Tag */}
        <div
          style={{
            padding: '12px',
            borderRadius: '12px',
            backgroundColor: 'var(--color-surface-container-low)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <span className="text-label-sm">Topes específicos por Categoría o #Tag</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '8px' }}>
            <select
              value={lineType}
              onChange={(e) => {
                const t = e.target.value as 'category' | 'tag';
                setLineType(t);
                setLineTarget('');
              }}
              style={{
                padding: '8px',
                borderRadius: '8px',
                border: '1px solid var(--color-outline-variant)',
                fontSize: '13px',
              }}
            >
              <option value="category">Por Categoría</option>
              <option value="tag">Por #Tag</option>
            </select>

            <select
              value={lineTarget}
              onChange={(e) => setLineTarget(e.target.value)}
              style={{
                padding: '8px',
                borderRadius: '8px',
                border: '1px solid var(--color-outline-variant)',
                fontSize: '13px',
              }}
            >
              <option value="">Seleccionar...</option>
              {lineType === 'category'
                ? expenseCategories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))
                : tags.map((t) => (
                    <option key={t.id} value={t.name}>
                      #{t.name}
                    </option>
                  ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="Tope $ (Ej. 600.000)"
              value={lineAmount}
              onChange={(e) => setLineAmount(formatInputCOP(e.target.value))}
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid var(--color-outline-variant)',
                fontSize: '13px',
              }}
            />
            <Button type="button" variant="secondary" size="sm" onClick={handleAddLine}>
              <Plus size={14} /> Agregar
            </Button>
          </div>

          {lines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
              {lines.map((l) => (
                <div
                  key={l.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--color-surface-container-lowest)',
                    fontSize: '13px',
                  }}
                >
                  <span>
                    {l.targetType === 'tag' ? `#${l.targetName}` : l.targetName}:{' '}
                    <strong>{formatCOP(l.amount)}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines(lines.filter((x) => x.id !== l.id))}
                    style={{ color: 'var(--color-error)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <Button type="button" variant="ghost" fullWidth onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" fullWidth disabled={isSaving}>
            {isSaving ? 'Guardando...' : 'Guardar Presupuesto'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
