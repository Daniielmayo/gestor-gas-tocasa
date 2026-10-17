'use client';
import React, { useEffect, useState, useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/context/AuthContext';
import { useHousehold } from '@/context/HouseholdContext';
import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  Timestamp,
  getDocs,
  query,
  where,
  or,
  increment,
  arrayUnion,
} from 'firebase/firestore';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import {
  AttachmentMeta,
  BudgetDoc,
  DebtChargeLog,
  EnhancedTransaction,
  IncomeFrequency,
  Scope,
} from '@/lib/models';
import { uploadReceiptAttachment, deleteReceiptAttachment } from '@/lib/cloudinaryClient';
import { evaluateBudgetStatus, checkNewBudgetAlerts, TriggeredBudgetAlert } from '@/lib/budgetEngine';
import {
  Camera,
  CreditCard,
  MapPin,
  Tag as TagIcon,
  Users,
  User,
  Trash2,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
} from 'lucide-react';

interface QuickMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: 'expense' | 'income';
  editingTransaction?: EnhancedTransaction | null;
  knownTransactions?: EnhancedTransaction[];
  recurringPayments?: any[];
  activeBudgets?: BudgetDoc[];
  onAlertsTriggered?: (alerts: TriggeredBudgetAlert[]) => void;
}

export function QuickMovementModal({
  isOpen,
  onClose,
  initialType = 'expense',
  editingTransaction = null,
  knownTransactions = [],
  recurringPayments = [],
  activeBudgets = [],
  onAlertsTriggered,
}: QuickMovementModalProps) {
  const { user, profile } = useAuth();
  const {
    household,
    partner,
    partnerUid,
    paymentMethods,
    categories,
    tags,
    knownPlaces,
    incomeSources,
    lastUsedPaymentMethodId,
    setLastUsedPaymentMethodId,
  } = useHousehold();

  const [txType, setTxType] = useState<'expense' | 'income'>(initialType);
  const [amount, setAmount] = useState('');
  const [place, setPlace] = useState('');
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState<Scope>('personal');
  const [paidByUserId, setPaidByUserId] = useState<string>('');
  const [paymentMethodId, setPaymentMethodId] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [note, setNote] = useState('');
  const [txDate, setTxDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedRecurringId, setSelectedRecurringId] = useState('');
  const [incomeType, setIncomeType] = useState<'fijo' | 'variable'>('fijo');
  const [incomeFrequency, setIncomeFrequency] = useState<IncomeFrequency>('mensual');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoSuggestedHint, setAutoSuggestedHint] = useState<string | null>(null);

  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((pm) => pm.active !== false),
    [paymentMethods]
  );

  const availableCategories = useMemo(
    () => categories.filter((c) => c.type === txType),
    [categories, txType]
  );

  // Build known places dictionary combining pre-configured Comercios + historical transactions
  const placeKnowledge = useMemo(() => {
    const map = new Map<
      string,
      {
        place: string;
        category: string;
        tags: string[];
        paymentMethodId?: string;
        scope?: Scope;
      }
    >();

    for (const kp of knownPlaces) {
      const key = kp.name.trim().toLowerCase();
      if (!key) continue;
      map.set(key, {
        place: kp.name.trim(),
        category: kp.defaultCategory,
        tags: kp.defaultTags || [],
        paymentMethodId: kp.defaultPaymentMethodId || undefined,
        scope: kp.defaultScope,
      });
    }

    for (const t of knownTransactions) {
      if (t.deletedAt) continue;
      const pName = (t.place || t.description || t.title || '').trim();
      if (!pName || pName.length < 2) continue;
      const key = pName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          place: pName,
          category: t.category,
          tags: t.tags || [],
          paymentMethodId: t.paymentMethodId || undefined,
          scope: t.scope,
        });
      }
    }
    return Array.from(map.values());
  }, [knownPlaces, knownTransactions]);

  const matchingPlaces = useMemo(() => {
    if (txType === 'income') return [];
    if (!place.trim()) {
      return placeKnowledge.slice(0, 5);
    }
    const q = place.toLowerCase();
    return placeKnowledge
      .filter((p) => p.place.toLowerCase().includes(q) && p.place.toLowerCase() !== q)
      .slice(0, 5);
  }, [place, placeKnowledge, txType]);

  useEffect(() => {
    if (!isOpen || !user) return;

    if (editingTransaction) {
      setTxType(editingTransaction.type);
      setAmount(formatInputCOP(String(editingTransaction.amount)));
      setPlace(editingTransaction.place || editingTransaction.description || editingTransaction.title || '');
      setCategory(editingTransaction.category || '');
      const inferredScope: Scope =
        editingTransaction.scope ||
        (editingTransaction.sharedWith && editingTransaction.sharedWith.length > 0
          ? 'conjunto'
          : 'personal');
      setScope(inferredScope);
      setPaidByUserId(editingTransaction.paidByUserId || editingTransaction.ownerId || user.uid);
      setPaymentMethodId(editingTransaction.paymentMethodId || '');
      setSelectedTags(editingTransaction.tags || []);
      setNote(editingTransaction.note || '');
      setAttachments(editingTransaction.attachments || []);
      setIncomeType(editingTransaction.incomeType || 'fijo');
      setIncomeFrequency(editingTransaction.incomeFrequency || 'mensual');
      setSelectedRecurringId(editingTransaction.recurringPaymentId || '');
      if (editingTransaction.createdAt?.toDate) {
        setTxDate(editingTransaction.createdAt.toDate().toISOString().split('T')[0]);
      } else {
        setTxDate(new Date().toISOString().split('T')[0]);
      }
      setAutoSuggestedHint(null);
    } else {
      setTxType(initialType);
      setAmount('');
      setPlace('');
      const defaultCat = categories.find((c) => c.type === initialType)?.name || '';
      setCategory(defaultCat);
      setScope('personal');
      setPaidByUserId(user.uid);
      const preferredPm =
        lastUsedPaymentMethodId && activePaymentMethods.some((p) => p.id === lastUsedPaymentMethodId)
          ? lastUsedPaymentMethodId
          : activePaymentMethods[0]?.id || '';
      setPaymentMethodId(preferredPm);
      setSelectedTags([]);
      setCustomTagInput('');
      setNote('');
      setAttachments([]);
      setIncomeType('fijo');
      setIncomeFrequency('mensual');
      setSelectedRecurringId('');
      setTxDate(new Date().toISOString().split('T')[0]);
      setAutoSuggestedHint(null);
    }
  }, [isOpen, editingTransaction, initialType, user]);

  const handleSelectPlaceSuggestion = (suggestion: {
    place: string;
    category: string;
    tags: string[];
    paymentMethodId?: string;
    scope?: Scope;
  }) => {
    setPlace(suggestion.place);
    if (suggestion.category) setCategory(suggestion.category);
    if (suggestion.tags?.length) {
      setSelectedTags(Array.from(new Set([...selectedTags, ...suggestion.tags])));
    }
    if (suggestion.paymentMethodId && activePaymentMethods.some((p) => p.id === suggestion.paymentMethodId)) {
      setPaymentMethodId(suggestion.paymentMethodId);
    }
    if (suggestion.scope) {
      setScope(suggestion.scope);
    }
    setAutoSuggestedHint(`Autocompletado desde "${suggestion.place}"`);
  };

  const handleSelectIncomeSource = (src: (typeof incomeSources)[number]) => {
    setPlace(src.name);
    if (src.defaultAmount && src.defaultAmount > 0) {
      setAmount(formatInputCOP(String(src.defaultAmount)));
    }
    if (src.defaultCategory) setCategory(src.defaultCategory);
    setIncomeType(src.type);
    if (src.frequency) setIncomeFrequency(src.frequency);
    if (src.defaultScope) setScope(src.defaultScope);
    setAutoSuggestedHint(`Fuente "${src.name}" cargada`);
  };

  const toggleTag = (tagName: string) => {
    const clean = tagName.trim().toLowerCase();
    if (!clean) return;
    if (selectedTags.includes(clean)) {
      setSelectedTags(selectedTags.filter((t) => t !== clean));
    } else {
      setSelectedTags([...selectedTags, clean]);
    }
  };

  const handleAddCustomTag = () => {
    const clean = customTagInput.trim().toLowerCase().replace(/^#/, '');
    if (!clean) return;
    if (!selectedTags.includes(clean)) {
      setSelectedTags([...selectedTags, clean]);
    }
    setCustomTagInput('');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploadingReceipt(true);
    try {
      const uploaded: AttachmentMeta[] = [];
      for (let i = 0; i < files.length; i++) {
        const meta = await uploadReceiptAttachment(files[i], household?.id || user?.uid || 'default');
        uploaded.push(meta);
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err: any) {
      alert(err.message || 'Error al procesar el comprobante.');
    } finally {
      setIsUploadingReceipt(false);
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = async (att: AttachmentMeta) => {
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    await deleteReceiptAttachment(att.publicId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !amount || !category || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const numericAmount = parseCOP(amount);
      const dateObj = new Date(`${txDate}T12:00:00`);
      const chosenPm = activePaymentMethods.find((p) => p.id === paymentMethodId);
      const payerUid = paidByUserId || user.uid;
      const payerName =
        payerUid === user.uid
          ? profile?.displayName?.split(' ')[0] || 'Yo'
          : partner?.displayName?.split(' ')[0] || 'Pareja';

      const sharedWithArray =
        scope === 'conjunto' && partnerUid
          ? [partnerUid]
          : partnerUid && household?.personalVisibility === 'full_detail'
          ? [partnerUid]
          : [];

      const selectedRecurring = recurringPayments.find((p) => p.id === selectedRecurringId);

      const payload: Record<string, any> = {
        type: txType,
        amount: numericAmount,
        category,
        place: place.trim() || category,
        description: place.trim() || note.trim() || category,
        title: place.trim() || category,
        note: note.trim(),
        scope,
        paidByUserId: payerUid,
        paidByName: payerName,
        paymentMethodId: chosenPm ? chosenPm.id : null,
        paymentMethodAlias: chosenPm
          ? `${chosenPm.alias}${chosenPm.holderName ? ` (${chosenPm.holderName})` : ''}`
          : null,
        tags: selectedTags,
        attachments,
        householdId: household?.id || null,
        sharedWith: sharedWithArray,
        recurringPaymentId: selectedRecurring ? selectedRecurring.id : null,
        recurringPaymentTitle: selectedRecurring ? selectedRecurring.title : null,
        createdAt: Timestamp.fromDate(dateObj),
        spentAt: Timestamp.fromDate(dateObj),
        updatedAt: Timestamp.now(),
        updatedBy: user.uid,
      };

      if (txType === 'income') {
        payload.incomeType = incomeType;
        payload.incomeFrequency = incomeFrequency;
      }

      let savedDocId = editingTransaction?.id || '';

      if (editingTransaction) {
        await updateDoc(doc(db, 'transactions', editingTransaction.id), payload);
      } else {
        const docRef = await addDoc(collection(db, 'transactions'), {
          ...payload,
          ownerId: user.uid,
          ownerName: profile?.displayName?.split(' ')[0] || 'Usuario',
          deletedAt: null,
        });
        savedDocId = docRef.id;
      }

      if (chosenPm) {
        setLastUsedPaymentMethodId(chosenPm.id);
      }

      // Automatically reflect Credit Card expenses in Credit Card Debts (debts collection)
      if (
        !editingTransaction &&
        txType === 'expense' &&
        chosenPm &&
        chosenPm.type === 'credito' &&
        category !== 'Pago Deuda / Tarjeta' &&
        !category.startsWith('Abono a Deuda')
      ) {
        try {
          const debtsRef = collection(db, 'debts');
          const qDebts = query(debtsRef, where('paymentMethodId', '==', chosenPm.id));
          const debtSnap = await getDocs(qDebts);

          const chargeEntry: DebtChargeLog = {
            id: `ch_${Date.now()}`,
            amount: numericAmount,
            note: note.trim() || place.trim() || category,
            category,
            place: place.trim() || category,
            spentByUserId: payerUid,
            spentByName: payerName,
            transactionId: savedDocId,
            spentAt: dateObj.toISOString(),
          };

          const cardTitle = `${chosenPm.alias}${chosenPm.bank ? ` · ${chosenPm.bank}` : ''}${
            chosenPm.last4 ? ` (*${chosenPm.last4})` : ''
          }`;

          if (!debtSnap.empty) {
            const targetDebtDoc = debtSnap.docs[0];
            await updateDoc(doc(db, 'debts', targetDebtDoc.id), {
              targetAmount: increment(numericAmount),
              charges: arrayUnion(chargeEntry),
              updatedAt: Timestamp.now(),
            });
          } else {
            await addDoc(debtsRef, {
              householdId: household?.id || 'default',
              title: cardTitle,
              targetAmount: numericAmount,
              currentAmount: 0,
              ownerId: chosenPm.holderUserId || user.uid,
              ownerName: chosenPm.holderName || payerName,
              scope,
              sharedWith: partnerUid ? [partnerUid] : [],
              paymentMethodId: chosenPm.id,
              paymentMethodAlias: chosenPm.alias,
              bank: chosenPm.bank || '',
              last4: chosenPm.last4 || '',
              cutDay: chosenPm.cutDay || null,
              dueDay: chosenPm.dueDay || null,
              linkedRecurringPaymentId: null,
              abonos: [],
              charges: [chargeEntry],
              createdAt: Timestamp.fromDate(dateObj),
              updatedAt: Timestamp.now(),
            });
          }
        } catch (cardErr) {
          console.warn('Error syncing credit card expense to debts:', cardErr);
        }
      }

      // Evaluate Budget Alerts (RF-08) whenever an expense is created or edited
      if (txType === 'expense' && activeBudgets.length > 0) {
        const simulatedTx: EnhancedTransaction = {
          id: savedDocId,
          ownerId: editingTransaction?.ownerId || user.uid,
          ...(payload as any),
        };
        const updatedList = editingTransaction
          ? knownTransactions.map((t) => (t.id === editingTransaction.id ? simulatedTx : t))
          : [simulatedTx, ...knownTransactions];

        const newlyTriggered: TriggeredBudgetAlert[] = [];

        for (const b of activeBudgets) {
          const status = evaluateBudgetStatus(b, updatedList, user.uid);
          const alerts = checkNewBudgetAlerts(status);
          if (alerts.length > 0) {
            newlyTriggered.push(...alerts);
            const newFiredKeys = Array.from(
              new Set([...(b.firedAlerts || []), ...alerts.map((a) => a.alertKey)])
            );
            try {
              await updateDoc(doc(db, 'budgets', b.id), {
                firedAlerts: newFiredKeys,
              });
              for (const al of alerts) {
                await addDoc(collection(db, 'notifications'), {
                  userId: user.uid,
                  title: al.title,
                  message: al.message,
                  type: 'budget_alert',
                  link: '/finanzas',
                  read: false,
                  createdAt: Timestamp.now(),
                });
                if (partnerUid && b.scope !== 'personal') {
                  await addDoc(collection(db, 'notifications'), {
                    userId: partnerUid,
                    title: al.title,
                    message: al.message,
                    type: 'budget_alert',
                    link: '/finanzas',
                    read: false,
                    createdAt: Timestamp.now(),
                  });
                }
              }
            } catch (e) {
              console.warn('Error persisting budget alert notification:', e);
            }
          }
        }

        if (newlyTriggered.length > 0 && onAlertsTriggered) {
          onAlertsTriggered(newlyTriggered);
        }
      }

      onClose();
    } catch (err) {
      console.error('Error saving transaction:', err);
      alert('No se pudo guardar el movimiento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !isSubmitting && onClose()}
      title={
        editingTransaction
          ? `Editar ${txType === 'expense' ? 'Gasto' : 'Ingreso'}`
          : 'Registrar Movimiento Rápido'
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}>
        {/* Type Switcher (Gasto / Ingreso) */}
        {!editingTransaction && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              background: 'var(--color-surface-container)',
              padding: '4px',
              borderRadius: '12px',
              gap: '4px',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setTxType('expense');
                setCategory(categories.find((c) => c.type === 'expense')?.name || 'Supermercado');
              }}
              style={{
                padding: '10px',
                borderRadius: '10px',
                fontWeight: 600,
                fontSize: '14px',
                backgroundColor: txType === 'expense' ? 'var(--color-error)' : 'transparent',
                color: txType === 'expense' ? '#FFF' : 'var(--color-on-surface-variant)',
              }}
            >
              Gasto (-)
            </button>
            <button
              type="button"
              onClick={() => {
                setTxType('income');
                setCategory(categories.find((c) => c.type === 'income')?.name || 'Sueldo / Quincena');
              }}
              style={{
                padding: '10px',
                borderRadius: '10px',
                fontWeight: 600,
                fontSize: '14px',
                backgroundColor: txType === 'income' ? 'var(--color-success)' : 'transparent',
                color: txType === 'income' ? '#FFF' : 'var(--color-on-surface-variant)',
              }}
            >
              Ingreso (+)
            </button>
          </div>
        )}

        {/* 1. Monto + Fecha en fila compacta */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: '10px' }}>
          <Input
            label="Monto ($)"
            type="text"
            inputMode="numeric"
            placeholder="Ej. 85.000"
            value={amount}
            onChange={(e) => setAmount(formatInputCOP(e.target.value))}
            required
            autoFocus
          />
          <Input
            label="Fecha"
            type="date"
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
            required
          />
        </div>

        {/* 2. Lugar / Fuente con autocompletado inteligente */}
        <div style={{ position: 'relative' }}>
          <Input
            label={txType === 'expense' ? 'Lugar o Comercio' : 'Fuente / Concepto'}
            placeholder={
              txType === 'expense'
                ? 'Ej. Éxito, Dolarcity, Crepes, Ara...'
                : 'Ej. Quincena Empresa, Cliente Freelance...'
            }
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              setAutoSuggestedHint(null);
            }}
          />
          {autoSuggestedHint && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                color: 'var(--color-primary)',
                marginTop: '4px',
                fontWeight: 500,
              }}
            >
              <Sparkles size={12} />
              <span>{autoSuggestedHint}</span>
            </div>
          )}
          {txType === 'expense' && matchingPlaces.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '6px',
                flexWrap: 'wrap',
                marginTop: '6px',
              }}
            >
              {matchingPlaces.map((sug) => (
                <button
                  key={sug.place}
                  type="button"
                  onClick={() => handleSelectPlaceSuggestion(sug)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    background: 'var(--color-primary-container)',
                    color: 'var(--color-primary-dark)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                  }}
                >
                  <MapPin size={11} />
                  <span>{sug.place}</span>
                  <span style={{ opacity: 0.75 }}>({sug.category})</span>
                </button>
              ))}
            </div>
          )}
          {txType === 'income' && incomeSources.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '6px',
                flexWrap: 'wrap',
                marginTop: '6px',
              }}
            >
              {incomeSources.map((src) => (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => handleSelectIncomeSource(src)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    background: 'rgba(16, 185, 129, 0.12)',
                    color: '#065F46',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}
                >
                  <span>{src.name}</span>
                  {src.defaultAmount ? (
                    <span style={{ fontWeight: 600 }}>({formatCOP(src.defaultAmount)})</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 3. Ámbito (Conjunto vs Personal) + Quién pagó/recibió */}
        <div style={{ display: 'grid', gridTemplateColumns: partner ? '1fr 1fr' : '1fr', gap: '10px' }}>
          <div>
            <label
              className="text-label-sm"
              style={{ display: 'block', marginBottom: '6px', color: 'var(--color-on-surface-variant)' }}
            >
              Ámbito
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                background: 'var(--color-surface-container-low)',
                padding: '3px',
                borderRadius: '10px',
                border: '1px solid var(--color-outline-variant)',
              }}
            >
              <button
                type="button"
                onClick={() => setScope('conjunto')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '8px 6px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: scope === 'conjunto' ? 600 : 500,
                  backgroundColor: scope === 'conjunto' ? 'var(--color-primary)' : 'transparent',
                  color: scope === 'conjunto' ? '#FFF' : 'var(--color-on-surface)',
                }}
              >
                <Users size={13} />
                Conjunto
              </button>
              <button
                type="button"
                onClick={() => setScope('personal')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '8px 6px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: scope === 'personal' ? 600 : 500,
                  backgroundColor: scope === 'personal' ? 'var(--color-primary)' : 'transparent',
                  color: scope === 'personal' ? '#FFF' : 'var(--color-on-surface)',
                }}
              >
                <User size={13} />
                Personal
              </button>
            </div>
          </div>

          {partner && (
            <div>
              <label
                className="text-label-sm"
                style={{ display: 'block', marginBottom: '6px', color: 'var(--color-on-surface-variant)' }}
              >
                {txType === 'expense' ? '¿Quién pagó?' : '¿Quién recibió?'}
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  background: 'var(--color-surface-container-low)',
                  padding: '3px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setPaidByUserId(user?.uid || '')}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: paidByUserId === user?.uid ? 600 : 500,
                    backgroundColor: paidByUserId === user?.uid ? '#1F2937' : 'transparent',
                    color: paidByUserId === user?.uid ? '#FFF' : 'var(--color-on-surface)',
                  }}
                >
                  Yo ({profile?.displayName?.split(' ')[0] || 'Mío'})
                </button>
                <button
                  type="button"
                  onClick={() => setPaidByUserId(partner.uid)}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: paidByUserId === partner.uid ? 600 : 500,
                    backgroundColor: paidByUserId === partner.uid ? '#1F2937' : 'transparent',
                    color: paidByUserId === partner.uid ? '#FFF' : 'var(--color-on-surface)',
                  }}
                >
                  {partner.displayName?.split(' ')[0] || 'Pareja'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 4. Categoría (Chips visuales rápidos) */}
        <div>
          <label
            className="text-label-sm"
            style={{ display: 'block', marginBottom: '6px', color: 'var(--color-on-surface-variant)' }}
          >
            Categoría Principal
          </label>
          <div
            style={{
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              paddingBottom: '6px',
            }}
          >
            {availableCategories.map((cat) => {
              const selected = category === cat.name;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.name)}
                  style={{
                    flex: '0 0 auto',
                    padding: '7px 12px',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: selected ? 600 : 500,
                    backgroundColor: selected ? cat.color : 'var(--color-surface-container-low)',
                    color: selected ? '#FFF' : 'var(--color-on-surface)',
                    border: selected ? `1px solid ${cat.color}` : '1px solid var(--color-outline-variant)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. Método de pago (RF-02) o Tipo de Ingreso (RF-05) */}
        {txType === 'expense' ? (
          <div>
            <label
              className="text-label-sm"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginBottom: '6px',
                color: 'var(--color-on-surface-variant)',
              }}
            >
              <CreditCard size={13} />
              <span>Método de Pago (cualquiera del hogar)</span>
            </label>
            <select
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid var(--color-outline-variant)',
                backgroundColor: 'var(--color-surface-container-lowest)',
                color: 'var(--color-on-surface)',
                fontSize: '14px',
              }}
            >
              <option value="">Sin especificar</option>
              {activePaymentMethods.map((pm) => (
                <option key={pm.id} value={pm.id}>
                  {pm.alias}
                  {pm.last4 ? ` •••• ${pm.last4}` : ''} — Titular: {pm.holderName || 'Hogar'} (
                  {pm.type.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label
                className="text-label-sm"
                style={{ display: 'block', marginBottom: '6px', color: 'var(--color-on-surface-variant)' }}
              >
                Tipo de Ingreso
              </label>
              <select
                value={incomeType}
                onChange={(e) => setIncomeType(e.target.value as 'fijo' | 'variable')}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                  backgroundColor: 'var(--color-surface-container-lowest)',
                  fontSize: '14px',
                }}
              >
                <option value="fijo">Fijo (Salario / Arriendo)</option>
                <option value="variable">Variable (Extra / Comisión)</option>
              </select>
            </div>
            <div>
              <label
                className="text-label-sm"
                style={{ display: 'block', marginBottom: '6px', color: 'var(--color-on-surface-variant)' }}
              >
                Frecuencia
              </label>
              <select
                value={incomeFrequency}
                onChange={(e) => setIncomeFrequency(e.target.value as IncomeFrequency)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                  backgroundColor: 'var(--color-surface-container-lowest)',
                  fontSize: '14px',
                }}
              >
                <option value="quincenal">Quincenal</option>
                <option value="mensual">Mensual</option>
                <option value="unico">Pago Único</option>
              </select>
            </div>
          </div>
        )}

        {/* 6. Tags transversales (RF-04) */}
        <div>
          <label
            className="text-label-sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginBottom: '6px',
              color: 'var(--color-on-surface-variant)',
            }}
          >
            <TagIcon size={13} />
            <span>Tags (#mercado, #dolarcity, #vacaciones...)</span>
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
            {tags.map((t) => {
              const active = selectedTags.includes(t.name.toLowerCase());
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.name)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: active ? 600 : 400,
                    backgroundColor: active ? 'rgba(59, 130, 246, 0.15)' : 'var(--color-surface-container-low)',
                    color: active ? 'var(--color-primary-dark)' : 'var(--color-on-surface-variant)',
                    border: active ? '1px solid var(--color-primary)' : '1px solid transparent',
                  }}
                >
                  #{t.name}
                </button>
              );
            })}
            {selectedTags
              .filter((st) => !tags.some((t) => t.name.toLowerCase() === st))
              .map((custom) => (
                <button
                  key={custom}
                  type="button"
                  onClick={() => toggleTag(custom)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    color: 'var(--color-primary-dark)',
                    border: '1px solid var(--color-primary)',
                  }}
                >
                  #{custom} ×
                </button>
              ))}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              placeholder="Agregar otro tag (ej. regalo)..."
              value={customTagInput}
              onChange={(e) => setCustomTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomTag();
                }
              }}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: '8px',
                border: '1px solid var(--color-outline-variant)',
                fontSize: '12px',
              }}
            />
            <Button type="button" variant="secondary" size="sm" onClick={handleAddCustomTag}>
              + Tag
            </Button>
          </div>
        </div>

        {/* 7. Comprobante / Cámara (RF-06) + Nota opcional */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'end' }}>
          <Input
            label="Nota (Opcional)"
            placeholder="Detalle adicional..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '11px 14px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-primary-container)',
                color: 'var(--color-primary-dark)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: isUploadingReceipt ? 'wait' : 'pointer',
                border: '1px solid rgba(59, 130, 246, 0.25)',
              }}
            >
              <Camera size={18} />
              <span>{isUploadingReceipt ? 'Subiendo...' : 'Foto'}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handleFileChange}
                disabled={isUploadingReceipt}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>

        {/* Vista previa de comprobantes */}
        {attachments.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 0' }}>
            {attachments.map((att) => (
              <div
                key={att.id}
                style={{
                  position: 'relative',
                  width: '68px',
                  height: '68px',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  border: '1px solid var(--color-outline-variant)',
                  flexShrink: 0,
                }}
              >
                <img
                  src={att.secureUrl}
                  alt="Comprobante"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(att)}
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(0,0,0,0.65)',
                    color: '#FFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          <Button type="button" variant="ghost" fullWidth onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={!amount || !category || isSubmitting || isUploadingReceipt}
          >
            {isSubmitting ? 'Guardando...' : editingTransaction ? 'Actualizar' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
