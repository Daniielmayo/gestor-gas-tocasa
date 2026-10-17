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
  onSnapshot,
} from 'firebase/firestore';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import {
  AttachmentMeta,
  BudgetDoc,
  DebtChargeLog,
  EnhancedTransaction,
  IncomeFrequency,
  Scope,
  UserPeriodWorksheet,
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
  const [worksheets, setWorksheets] = useState<UserPeriodWorksheet[]>([]);

  useEffect(() => {
    if (!user) return;
    const hhId = household?.id || '';
    const clauses: any[] = [
      where('userId', '==', user.uid),
      where('sharedWith', 'array-contains', user.uid),
    ];
    if (partnerUid) {
      clauses.push(where('userId', '==', partnerUid));
    }
    if (hhId) {
      clauses.push(where('householdId', '==', hhId));
    }

    const wsRef = collection(db, 'periodWorksheets');
    const qWs = query(wsRef, or(...clauses));
    const unsub = onSnapshot(qWs, (snap) => {
      const list: UserPeriodWorksheet[] = [];
      snap.forEach((d) => list.push({ ...(d.data() as UserPeriodWorksheet), id: d.id }));
      setWorksheets(list);
    });
    return () => unsub();
  }, [user, partnerUid, household?.id]);

  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((pm) => pm.active !== false),
    [paymentMethods]
  );

  const availableCategories = useMemo(
    () => categories.filter((c) => c.type === txType),
    [categories, txType]
  );

  const inferCategoryFromConcept = (concept: string): string => {
    const low = concept.toLowerCase();
    if (low.includes('arriendo') || low.includes('alquiler') || low.includes('admin')) {
      return 'Arriendo / Vivienda';
    }
    if (
      low.includes('luz') ||
      low.includes('agua') ||
      low.includes('gas') ||
      low.includes('internet') ||
      low.includes('epm') ||
      low.includes('servicio') ||
      low.includes('celular')
    ) {
      return 'Servicios Públicos';
    }
    if (low.includes('mercado') || low.includes('super')) {
      return 'Supermercado';
    }
    if (low.includes('tarjeta') || low.includes('crédito') || low.includes('credito') || low.includes('deuda')) {
      return 'Pago Deuda / Tarjeta';
    }
    return 'Servicios Públicos';
  };

  // Build unified list of configured Fixed Expenses (from all periodWorksheets + recurringPayments + activeBudgets)
  const fixedExpenseOptions = useMemo(() => {
    const items: Array<{
      id: string;
      concept: string;
      amount: number;
      category: string;
      quincenaLabel: string;
      ownerId: string;
      ownerLabel: string;
      scope: Scope;
      recurringId?: string;
    }> = [];
    const seen = new Set<string>();

    const myFirstName = profile?.displayName?.split(' ')[0] || 'Mío';
    const partnerFirstName = partner?.displayName?.split(' ')[0] || 'Pareja';

    // Sort worksheets so BASE-Q1 and BASE-Q2 come first, then newest monthly docs
    const sortedWorksheets = [...worksheets].sort((a, b) => {
      const aIsBase = a.periodKey.startsWith('BASE') ? 1 : 0;
      const bIsBase = b.periodKey.startsWith('BASE') ? 1 : 0;
      if (aIsBase !== bIsBase) return bIsBase - aIsBase;
      return b.periodKey.localeCompare(a.periodKey);
    });

    for (const ws of sortedWorksheets) {
      const uid = ws.userId || user?.uid || '';
      const label =
        uid === partnerUid
          ? partnerFirstName
          : ws.userName?.split(' ')[0] || myFirstName;
      const qLabel = ws.periodKey.endsWith('Q1')
        ? '1ª Qna (15)'
        : ws.periodKey.endsWith('Q2')
        ? '2ª Qna (30)'
        : 'Mensual';

      for (const ob of ws.obligations || []) {
        const concept = (ob.concept || '').trim();
        if (!concept) continue;
        const key = `${uid}_${concept.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: `ws_${ws.periodKey}_${ob.id || concept}`,
          concept,
          amount: Math.abs(Number(ob.amount || 0)),
          category: inferCategoryFromConcept(concept),
          quincenaLabel: qLabel,
          ownerId: uid,
          ownerLabel: label,
          scope: 'personal',
        });
      }
    }

    for (const rp of recurringPayments || []) {
      const title = (rp.title || rp.name || '').trim();
      if (!title) continue;
      const key = `rp_${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `rp_${rp.id}`,
        concept: title,
        amount: Math.abs(Number(rp.amount || 0)),
        category: rp.category || inferCategoryFromConcept(title),
        quincenaLabel: rp.dayOfMonth ? `Día ${rp.dayOfMonth}` : 'Mensual',
        ownerId: rp.ownerId || user?.uid || '',
        ownerLabel: rp.ownerId === partnerUid ? partnerFirstName : myFirstName,
        scope: rp.sharedWith?.length > 0 ? 'conjunto' : 'personal',
        recurringId: rp.id,
      });
    }

    for (const b of activeBudgets || []) {
      for (const line of b.lines || []) {
        const title = (line.targetName || '').trim();
        if (!title) continue;
        const key = `bg_${title.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: `bg_${b.id}_${line.id}`,
          concept: title,
          amount: Math.abs(Number(line.amount || 0)),
          category: line.targetType === 'category' ? title : inferCategoryFromConcept(title),
          quincenaLabel: b.periodType === 'quincenal' ? 'Quincenal' : 'Presupuesto',
          ownerId: b.ownerId || user?.uid || '',
          ownerLabel: b.ownerId === partnerUid ? partnerFirstName : myFirstName,
          scope: b.scope === 'conjunto' ? 'conjunto' : 'personal',
        });
      }
    }

    return items;
  }, [worksheets, recurringPayments, activeBudgets, user?.uid, partnerUid, profile?.displayName, partner?.displayName]);

  // Build known places dictionary combining Fixed Expenses + pre-configured Comercios + historical transactions
  const placeKnowledge = useMemo(() => {
    const map = new Map<
      string,
      {
        place: string;
        category: string;
        tags: string[];
        paymentMethodId?: string;
        scope?: Scope;
        amount?: number;
        ownerId?: string;
        isFixedExpense?: boolean;
      }
    >();

    for (const fe of fixedExpenseOptions) {
      const key = fe.concept.toLowerCase();
      if (!key) continue;
      map.set(key, {
        place: fe.concept,
        category: fe.category,
        tags: ['gasto-fijo'],
        scope: fe.scope,
        amount: fe.amount,
        ownerId: fe.ownerId,
        isFixedExpense: true,
      });
    }

    for (const kp of knownPlaces) {
      const key = kp.name.trim().toLowerCase();
      if (!key) continue;
      const existing = map.get(key);
      map.set(key, {
        place: kp.name.trim(),
        category: kp.defaultCategory || existing?.category || 'Otros Gastos',
        tags: kp.defaultTags?.length ? kp.defaultTags : existing?.tags || [],
        paymentMethodId: kp.defaultPaymentMethodId || existing?.paymentMethodId || undefined,
        scope: kp.defaultScope || existing?.scope,
        amount: existing?.amount,
        ownerId: existing?.ownerId,
        isFixedExpense: existing?.isFixedExpense,
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
  }, [fixedExpenseOptions, knownPlaces, knownTransactions]);

  const matchingPlaces = useMemo(() => {
    if (txType === 'income') return [];
    const q = place.trim().toLowerCase();
    if (!q) return [];
    return placeKnowledge
      .filter((p) => p.place.toLowerCase().includes(q) && p.place.toLowerCase() !== q)
      .slice(0, 6);
  }, [place, placeKnowledge, txType]);

  const matchingCategories = useMemo(() => {
    const q = category.trim().toLowerCase();
    if (!q) return [];
    return availableCategories
      .filter((c) => c.name.toLowerCase().includes(q) && c.name.toLowerCase() !== q)
      .slice(0, 6);
  }, [category, availableCategories]);

  const matchingTags = useMemo(() => {
    const q = customTagInput.trim().toLowerCase().replace(/^#/, '');
    if (!q) return [];
    return tags
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) && !selectedTags.includes(t.name.toLowerCase())
      )
      .slice(0, 6);
  }, [customTagInput, tags, selectedTags]);

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
      setCategory('');
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

  const handleSelectFixedExpense = (fe: (typeof fixedExpenseOptions)[number]) => {
    setPlace(fe.concept);
    if (fe.amount > 0) {
      setAmount(formatInputCOP(String(fe.amount)));
    }
    if (fe.category) {
      setCategory(fe.category);
    }
    if (fe.ownerId) {
      setPaidByUserId(fe.ownerId);
    }
    if (fe.scope) {
      setScope(fe.scope);
    }
    if (fe.recurringId) {
      setSelectedRecurringId(fe.recurringId);
    }
    if (!selectedTags.includes('gasto-fijo')) {
      setSelectedTags((prev) => Array.from(new Set([...prev, 'gasto-fijo'])));
    }
    setAutoSuggestedHint(`Gasto fijo "${fe.concept}" cargado`);
  };

  const handleSelectPlaceSuggestion = (suggestion: {
    place: string;
    category: string;
    tags: string[];
    paymentMethodId?: string;
    scope?: Scope;
    amount?: number;
    ownerId?: string;
    isFixedExpense?: boolean;
  }) => {
    setPlace(suggestion.place);
    if (suggestion.amount && suggestion.amount > 0 && !amount) {
      setAmount(formatInputCOP(String(suggestion.amount)));
    }
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
    if (suggestion.ownerId) {
      setPaidByUserId(suggestion.ownerId);
    }
    setAutoSuggestedHint(
      suggestion.isFixedExpense
        ? `Gasto fijo "${suggestion.place}" cargado`
        : `Autocompletado desde "${suggestion.place}"`
    );
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
    if (!user || !amount || isSubmitting) return;
    const resolvedCategory =
      category.trim() ||
      (txType === 'income' ? 'Sueldo / Quincena' : 'Otros Gastos');

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

      const otherHouseholdMembers = (household?.memberIds || []).filter((id) => id !== user.uid);
      const sharedWithArray = Array.from(
        new Set([...(partnerUid ? [partnerUid] : []), ...otherHouseholdMembers])
      );

      const selectedRecurring = recurringPayments.find((p) => p.id === selectedRecurringId);

      const payload: Record<string, any> = {
        type: txType,
        amount: numericAmount,
        category: resolvedCategory,
        place: place.trim() || resolvedCategory,
        description: place.trim() || note.trim() || resolvedCategory,
        title: place.trim() || resolvedCategory,
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
        resolvedCategory !== 'Pago Deuda / Tarjeta' &&
        !resolvedCategory.startsWith('Abono a Deuda')
      ) {
        try {
          const debtsRef = collection(db, 'debts');
          const qDebts = query(debtsRef, where('paymentMethodId', '==', chosenPm.id));
          const debtSnap = await getDocs(qDebts);

          const chargeEntry: DebtChargeLog = {
            id: `ch_${Date.now()}`,
            amount: numericAmount,
            note: note.trim() || place.trim() || resolvedCategory,
            category: resolvedCategory,
            place: place.trim() || resolvedCategory,
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
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' }}>
        {/* Type Switcher (Gasto / Ingreso) */}
        {!editingTransaction && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              background: 'var(--color-surface-container)',
              padding: '4px',
              borderRadius: '9999px',
              gap: '4px',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setTxType('expense');
                setCategory('');
              }}
              style={{
                padding: '9px',
                borderRadius: '9999px',
                fontWeight: 600,
                fontSize: '13px',
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
                setCategory('');
              }}
              style={{
                padding: '9px',
                borderRadius: '9999px',
                fontWeight: 600,
                fontSize: '13px',
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

        {/* 2. Lugar / Comercio (con opciones flotantes y Gastos Fijos rápidos) o Desplegable de Empresa / Fuente de Ingreso */}
        {txType === 'expense' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <label
                className="text-label-sm"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginBottom: '4px',
                  color: 'var(--color-primary-dark)',
                  fontWeight: 600,
                }}
              >
                <Sparkles size={12} />
                <span>Autocompletar desde Gasto Fijo (Opcional)</span>
              </label>
              <select
                value={fixedExpenseOptions.find((f) => f.concept === place)?.id || ''}
                onChange={(e) => {
                  const found = fixedExpenseOptions.find((f) => f.id === e.target.value);
                  if (found) {
                    handleSelectFixedExpense(found);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px dashed var(--color-primary)',
                  backgroundColor: 'rgba(59, 130, 246, 0.06)',
                  color: 'var(--color-primary-dark)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <option value="">
                  {fixedExpenseOptions.length > 0
                    ? `— Seleccionar Gasto Fijo (${fixedExpenseOptions.length} disponibles) —`
                    : '— Aún no tienes Gastos Fijos configurados en Pagos —'}
                </option>
                {fixedExpenseOptions.map((fe) => (
                  <option key={fe.id} value={fe.id}>
                    {fe.concept} — {formatCOP(fe.amount)} • {fe.quincenaLabel}
                    {partner ? ` (${fe.ownerLabel})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ position: 'relative' }}>
              <Input
                label="Lugar, Comercio o Concepto"
                placeholder="Escribe para buscar comercio o gasto fijo (ej. Arriendo, Éxito...)"
                value={place}
                onChange={(e) => {
                  setPlace(e.target.value);
                  setAutoSuggestedHint(null);
                }}
              />
              {autoSuggestedHint && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10px',
                    color: 'var(--color-primary)',
                    fontWeight: 600,
                  }}
                >
                  <Sparkles size={11} />
                  <span>{autoSuggestedHint}</span>
                </div>
              )}
              {matchingPlaces.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: 0,
                    right: 0,
                    zIndex: 60,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '6px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--color-surface-container-lowest)',
                    border: '1px solid var(--color-outline-variant)',
                    boxShadow: '0 10px 25px rgba(15, 23, 42, 0.16)',
                    maxHeight: '180px',
                    overflowY: 'auto',
                  }}
                >
                  {matchingPlaces.map((sug) => (
                    <button
                      key={sug.place}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectPlaceSuggestion(sug);
                      }}
                      onClick={() => handleSelectPlaceSuggestion(sug)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                        padding: '7px 10px',
                        fontSize: '12px',
                        textAlign: 'left',
                        color: 'var(--color-on-surface)',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                        {sug.isFixedExpense ? (
                          <Sparkles size={12} color="var(--color-primary)" />
                        ) : (
                          <MapPin size={12} color="var(--color-primary)" />
                        )}
                        {sug.place}
                        {sug.isFixedExpense && (
                          <span
                            style={{
                              fontSize: '9px',
                              padding: '1px 5px',
                              borderRadius: '999px',
                              backgroundColor: 'rgba(59, 130, 246, 0.14)',
                              color: 'var(--color-primary-dark)',
                              fontWeight: 700,
                            }}
                          >
                            FIJO
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {sug.amount ? `${formatCOP(sug.amount)} · ` : ''}
                        {sug.category}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {incomeSources.length > 0 && (
              <div>
                <label
                  className="text-label-sm"
                  style={{ display: 'block', marginBottom: '4px', color: 'var(--color-on-surface-variant)' }}
                >
                  Empresa / Fuente de Ingreso configurada (Rápido)
                </label>
                <select
                  value={incomeSources.find((s) => s.name === place)?.id || ''}
                  onChange={(e) => {
                    const found = incomeSources.find((s) => s.id === e.target.value);
                    if (found) {
                      handleSelectIncomeSource(found);
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container-lowest)',
                    color: 'var(--color-on-surface)',
                    fontSize: '13px',
                  }}
                >
                  <option value="">— Seleccionar empresa o fuente configurada —</option>
                  {incomeSources.map((src) => (
                    <option key={src.id} value={src.id}>
                      {src.name}
                      {src.defaultAmount ? ` (${formatCOP(src.defaultAmount)})` : ''} •{' '}
                      {src.type.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Input
              label="Empresa / Concepto del Ingreso"
              placeholder="Ej. Nómina Empresa, Cliente Freelance..."
              value={place}
              onChange={(e) => {
                setPlace(e.target.value);
                setAutoSuggestedHint(null);
              }}
            />
          </div>
        )}

        {/* 3. Categoría y Tags en fila compacta con sugerencias flotantes por encima */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'start' }}>
          {/* Categoría con autocompletado flotante al escribir */}
          <div style={{ position: 'relative' }}>
            <Input
              label="Categoría"
              placeholder={
                txType === 'expense' ? 'Escribe ej. Supermercado...' : 'Escribe ej. Sueldo...'
              }
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            {matchingCategories.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  zIndex: 60,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  padding: '6px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--color-surface-container-lowest)',
                  border: '1px solid var(--color-outline-variant)',
                  boxShadow: '0 10px 25px rgba(15, 23, 42, 0.16)',
                  maxHeight: '180px',
                  overflowY: 'auto',
                }}
              >
                {matchingCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setCategory(cat.name);
                    }}
                    onClick={() => setCategory(cat.name)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 8px',
                      fontSize: '12px',
                      textAlign: 'left',
                      color: 'var(--color-on-surface)',
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '999px',
                        backgroundColor: cat.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 500 }}>{cat.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tags con autocompletado flotante al escribir */}
          <div style={{ position: 'relative' }}>
            <Input
              label="Tags (#opcional)"
              placeholder="Escribe ej. mercado..."
              value={customTagInput}
              onChange={(e) => setCustomTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomTag();
                }
              }}
            />
            {matchingTags.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  zIndex: 60,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  padding: '6px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--color-surface-container-lowest)',
                  border: '1px solid var(--color-outline-variant)',
                  boxShadow: '0 10px 25px rgba(15, 23, 42, 0.16)',
                  maxHeight: '180px',
                  overflowY: 'auto',
                }}
              >
                {matchingTags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      toggleTag(t.name);
                      setCustomTagInput('');
                    }}
                    onClick={() => {
                      toggleTag(t.name);
                      setCustomTagInput('');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 8px',
                      fontSize: '12px',
                      textAlign: 'left',
                      color: 'var(--color-primary-dark)',
                      fontWeight: 500,
                    }}
                  >
                    #{t.name}
                  </button>
                ))}
              </div>
            )}
            {selectedTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                {selectedTags.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => toggleTag(st)}
                    style={{
                      padding: '2px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: 'var(--color-primary-dark)',
                      border: '1px solid var(--color-primary)',
                    }}
                  >
                    #{st} ×
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 4. Ámbito (Conjunto vs Personal) + Quién pagó/recibió */}
        <div style={{ display: 'grid', gridTemplateColumns: partner ? '1fr 1fr' : '1fr', gap: '10px' }}>
          <div>
            <label
              className="text-label-sm"
              style={{ display: 'block', marginBottom: '4px', color: 'var(--color-on-surface-variant)' }}
            >
              Ámbito
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                background: 'var(--color-surface-container-low)',
                padding: '3px',
                borderRadius: '9999px',
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
                  padding: '7px 6px',
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
                  padding: '7px 6px',
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
                style={{ display: 'block', marginBottom: '4px', color: 'var(--color-on-surface-variant)' }}
              >
                {txType === 'expense' ? '¿Quién pagó?' : '¿Quién recibió?'}
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  background: 'var(--color-surface-container-low)',
                  padding: '3px',
                  borderRadius: '9999px',
                  border: '1px solid var(--color-outline-variant)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setPaidByUserId(user?.uid || '')}
                  style={{
                    padding: '7px 6px',
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
                    padding: '7px 6px',
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

        {/* 5. Método de pago (RF-02) o Tipo de Ingreso (RF-05) */}
        {txType === 'expense' ? (
          <div>
            <label
              className="text-label-sm"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginBottom: '4px',
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
                padding: '9px 12px',
                borderRadius: '10px',
                border: '1px solid var(--color-outline-variant)',
                backgroundColor: 'var(--color-surface-container-lowest)',
                color: 'var(--color-on-surface)',
                fontSize: '13px',
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
                style={{ display: 'block', marginBottom: '4px', color: 'var(--color-on-surface-variant)' }}
              >
                Tipo de Ingreso
              </label>
              <select
                value={incomeType}
                onChange={(e) => setIncomeType(e.target.value as 'fijo' | 'variable')}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                  backgroundColor: 'var(--color-surface-container-lowest)',
                  fontSize: '13px',
                }}
              >
                <option value="fijo">Fijo (Salario / Arriendo)</option>
                <option value="variable">Variable (Extra / Comisión)</option>
              </select>
            </div>
            <div>
              <label
                className="text-label-sm"
                style={{ display: 'block', marginBottom: '4px', color: 'var(--color-on-surface-variant)' }}
              >
                Frecuencia
              </label>
              <select
                value={incomeFrequency}
                onChange={(e) => setIncomeFrequency(e.target.value as IncomeFrequency)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                  backgroundColor: 'var(--color-surface-container-lowest)',
                  fontSize: '13px',
                }}
              >
                <option value="quincenal">Quincenal</option>
                <option value="mensual">Mensual</option>
                <option value="unico">Pago Único</option>
              </select>
            </div>
          </div>
        )}

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
            disabled={!amount || isSubmitting || isUploadingReceipt}
          >
            {isSubmitting ? 'Guardando...' : editingTransaction ? 'Actualizar' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
