'use client';
import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/context/AuthContext';
import { useHousehold, THEME_COLOR_PALETTES } from '@/context/HouseholdContext';
import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  doc,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';
import {
  PaymentMethod,
  PaymentMethodType,
  CategoryDef,
  TagDef,
  KnownPlace,
  IncomeSourceDef,
  SplitRule,
  IncomeFrequency,
  Scope,
  ThemeColor,
} from '@/lib/models';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import {
  Users,
  CreditCard,
  Tag as TagIcon,
  Briefcase,
  Trash2,
  Pencil,
  Copy,
  Check,
  ShieldCheck,
  Store,
  X,
} from 'lucide-react';

export type ConfigTabId = 'hogar' | 'metodos' | 'catalogo' | 'lugares' | 'ingresos';

interface HouseholdConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: ConfigTabId;
}

export function HouseholdConfigModal({
  isOpen,
  onClose,
  initialTab = 'hogar',
}: HouseholdConfigModalProps) {
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
    themeColor,
    setThemeColor,
    linkPartnerByEmailOrCode,
    updateHouseholdConfig,
    resetUserData,
  } = useHousehold();

  const [activeTab, setActiveTab] = useState<ConfigTabId>(initialTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const [inviteInput, setInviteInput] = useState('');
  const [linkStatus, setLinkStatus] = useState<{ ok?: boolean; msg: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // 1. Payment method form state (Create + Edit + Delete)
  const [editingPmId, setEditingPmId] = useState<string | null>(null);
  const [pmType, setPmType] = useState<PaymentMethodType>('credito');
  const [pmAlias, setPmAlias] = useState('');
  const [pmLast4, setPmLast4] = useState('');
  const [pmBank, setPmBank] = useState('');
  const [pmHolder, setPmHolder] = useState<string>(user?.uid || '');
  const [pmCreditLimit, setPmCreditLimit] = useState('');
  const [pmCutDay, setPmCutDay] = useState('');
  const [pmDueDay, setPmDueDay] = useState('');
  const [isSavingPm, setIsSavingPm] = useState(false);

  // 2. Category & Tag form state (Create + Edit + Delete)
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<'expense' | 'income'>('expense');
  const [catColor, setCatColor] = useState('#3B82F6');

  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#10B981');

  // 3. Places / Merchants form state (Create + Edit + Delete)
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [placeCat, setPlaceCat] = useState('Supermercado');
  const [placeTagsInput, setPlaceTagsInput] = useState('');
  const [placePmId, setPlacePmId] = useState('');
  const [placeScope, setPlaceScope] = useState<Scope>('personal');
  const [isSavingPlace, setIsSavingPlace] = useState(false);

  // 4. Income Sources form state (Create + Edit + Delete)
  const [editingIncId, setEditingIncId] = useState<string | null>(null);
  const [incName, setIncName] = useState('');
  const [incType, setIncType] = useState<'fijo' | 'variable'>('fijo');
  const [incAmount, setIncAmount] = useState('');
  const [incFreq, setIncFreq] = useState<IncomeFrequency>('quincenal');
  const [incPayDay, setIncPayDay] = useState('15');
  const [incCategory, setIncCategory] = useState('Sueldo / Quincena');
  const [incScope, setIncScope] = useState<Scope>('personal');
  const [isSavingInc, setIsSavingInc] = useState(false);

  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const incomeCategories = categories.filter((c) => c.type === 'income');

  const handleCopyCode = () => {
    if (!household?.inviteCode) return;
    navigator.clipboard.writeText(household.inviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleLinkPartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkStatus(null);
    const res = await linkPartnerByEmailOrCode(inviteInput);
    setLinkStatus({ ok: res.ok, msg: res.message });
    if (res.ok) setInviteInput('');
  };

  const [isResettingPartner, setIsResettingPartner] = useState(false);
  const [resetPartnerStatus, setResetPartnerStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleResetPartnerData = async () => {
    if (!partnerUid) return;
    const partnerName = partner?.displayName || 'tu pareja';
    const confirmed = window.confirm(
      `¿Estás seguro de que deseas borrar TODOS los datos creados por ${partnerName}?\n\nEsto eliminará sus transacciones, deudas, tarjetas, ahorros y listas, pero MANTENDRÁ intacto su usuario y su vínculo contigo en el hogar.`
    );
    if (!confirmed) return;

    setIsResettingPartner(true);
    setResetPartnerStatus(null);
    try {
      const res = await resetUserData(partnerUid);
      setResetPartnerStatus({ ok: res.ok, msg: res.message });
    } catch (err: any) {
      setResetPartnerStatus({ ok: false, msg: err?.message || 'Error al eliminar datos.' });
    } finally {
      setIsResettingPartner(false);
    }
  };

  // --- Handlers: Payment Methods (Create, Edit, Toggle, Delete) ---
  const resetPmForm = () => {
    setEditingPmId(null);
    setPmType('credito');
    setPmAlias('');
    setPmLast4('');
    setPmBank('');
    setPmHolder(user?.uid || '');
    setPmCreditLimit('');
    setPmCutDay('');
    setPmDueDay('');
  };

  const startEditPaymentMethod = (pm: PaymentMethod) => {
    setEditingPmId(pm.id);
    setPmType(pm.type);
    setPmAlias(pm.alias);
    setPmLast4(pm.last4 || '');
    setPmBank(pm.bank || '');
    setPmHolder(pm.holderUserId || user?.uid || '');
    setPmCreditLimit(pm.creditLimit ? formatInputCOP(String(pm.creditLimit)) : '');
    setPmCutDay(pm.cutDay ? String(pm.cutDay) : '');
    setPmDueDay(pm.dueDay ? String(pm.dueDay) : '');
  };

  const handleSavePaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !pmAlias.trim() || isSavingPm) return;
    setIsSavingPm(true);
    try {
      const holderId = pmHolder || user.uid;
      const holderName =
        holderId === user.uid
          ? profile?.displayName?.split(' ')[0] || 'Yo'
          : partner?.displayName?.split(' ')[0] || 'Pareja';

      const payload = {
        householdId: household?.id || 'default',
        type: pmType,
        alias: pmAlias.trim(),
        last4: pmLast4.replace(/\D/g, '').slice(0, 4) || null,
        bank: pmBank.trim() || null,
        holderUserId: holderId,
        holderName,
        creditLimit: pmType === 'credito' && pmCreditLimit ? parseCOP(pmCreditLimit) : null,
        cutDay: pmType === 'credito' && pmCutDay ? Number(pmCutDay) : null,
        dueDay: pmType === 'credito' && pmDueDay ? Number(pmDueDay) : null,
        sharedWith: partnerUid ? [partnerUid] : [],
      };

      if (editingPmId) {
        await updateDoc(doc(db, 'paymentMethods', editingPmId), payload);
      } else {
        await addDoc(collection(db, 'paymentMethods'), {
          ...payload,
          active: true,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });
      }
      resetPmForm();
    } catch (err) {
      console.error('Error saving payment method:', err);
    } finally {
      setIsSavingPm(false);
    }
  };

  const togglePaymentMethodActive = async (pm: PaymentMethod) => {
    try {
      await updateDoc(doc(db, 'paymentMethods', pm.id), {
        active: !pm.active,
      });
    } catch (err) {
      console.error('Error toggling payment method:', err);
    }
  };

  const handleDeletePaymentMethod = async (pmId: string) => {
    try {
      await deleteDoc(doc(db, 'paymentMethods', pmId));
      if (editingPmId === pmId) resetPmForm();
    } catch (err) {
      console.error('Error deleting payment method:', err);
    }
  };

  // --- Handlers: Categories (Create, Edit, Delete) ---
  const resetCategoryForm = () => {
    setEditingCatId(null);
    setCatName('');
    setCatType('expense');
    setCatColor('#3B82F6');
  };

  const startEditCategory = (cat: CategoryDef) => {
    setEditingCatId(cat.id);
    setCatName(cat.name);
    setCatType(cat.type);
    setCatColor(cat.color || '#3B82F6');
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !catName.trim()) return;
    try {
      const payload = {
        householdId: household?.id || 'default',
        name: catName.trim(),
        type: catType,
        color: catColor,
        icon: 'Tag',
        ownerId: user.uid,
        sharedWith: partnerUid ? [partnerUid] : [],
      };

      if (editingCatId) {
        await setDoc(doc(db, 'financeCategories', editingCatId), payload, { merge: true });
      } else {
        await addDoc(collection(db, 'financeCategories'), payload);
      }
      resetCategoryForm();
    } catch (err) {
      console.error('Error saving category:', err);
    }
  };

  const handleDeleteCategory = async (cat: CategoryDef) => {
    try {
      if (cat.id.startsWith('def-') && household) {
        await updateDoc(doc(db, 'households', household.id), {
          disabledDefaultCategoryIds: arrayUnion(cat.id),
        });
      }
      try {
        await deleteDoc(doc(db, 'financeCategories', cat.id));
      } catch {
        // Ignore if default category wasn't stored in financeCategories collection
      }
      if (editingCatId === cat.id) resetCategoryForm();
    } catch (err) {
      console.error('Error deleting category:', err);
    }
  };

  // --- Handlers: Tags (Create, Edit, Delete) ---
  const resetTagForm = () => {
    setEditingTagId(null);
    setNewTagName('');
    setNewTagColor('#10B981');
  };

  const startEditTag = (t: TagDef) => {
    setEditingTagId(t.id);
    setNewTagName(t.name);
    setNewTagColor(t.color || '#10B981');
  };

  const handleSaveTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTagName.trim()) return;
    try {
      const clean = newTagName.trim().toLowerCase().replace(/^#/, '');
      const payload = {
        householdId: household?.id || 'default',
        name: clean,
        color: newTagColor,
        ownerId: user.uid,
        sharedWith: partnerUid ? [partnerUid] : [],
      };

      if (editingTagId) {
        await setDoc(doc(db, 'tags', editingTagId), payload, { merge: true });
      } else {
        await addDoc(collection(db, 'tags'), payload);
      }
      resetTagForm();
    } catch (err) {
      console.error('Error saving tag:', err);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    try {
      if (tagId.startsWith('def-tag-') && household) {
        await updateDoc(doc(db, 'households', household.id), {
          disabledDefaultTagIds: arrayUnion(tagId),
        });
      }
      try {
        await deleteDoc(doc(db, 'tags', tagId));
      } catch {
        // Ignore if default tag wasn't in Firestore tags collection
      }
      if (editingTagId === tagId) resetTagForm();
    } catch (err) {
      console.error('Error deleting tag:', err);
    }
  };

  // --- Handlers: Known Places / Merchants (Create, Edit, Delete) ---
  const resetPlaceForm = () => {
    setEditingPlaceId(null);
    setPlaceName('');
    setPlaceCat('Supermercado');
    setPlaceTagsInput('');
    setPlacePmId('');
    setPlaceScope('personal');
  };

  const startEditPlace = (pl: KnownPlace) => {
    setEditingPlaceId(pl.id);
    setPlaceName(pl.name);
    setPlaceCat(pl.defaultCategory || 'Supermercado');
    setPlaceTagsInput((pl.defaultTags || []).join(', '));
    setPlacePmId(pl.defaultPaymentMethodId || '');
    setPlaceScope(pl.defaultScope || 'personal');
  };

  const handleSavePlace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !placeName.trim() || isSavingPlace) return;
    setIsSavingPlace(true);
    try {
      const parsedTags = placeTagsInput
        .split(',')
        .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
        .filter(Boolean);

      const payload = {
        householdId: household?.id || 'default',
        name: placeName.trim(),
        defaultCategory: placeCat || 'Supermercado',
        defaultTags: parsedTags,
        defaultPaymentMethodId: placePmId || null,
        defaultScope: placeScope,
        sharedWith: partnerUid ? [partnerUid] : [],
      };

      if (editingPlaceId) {
        await updateDoc(doc(db, 'places', editingPlaceId), payload);
      } else {
        await addDoc(collection(db, 'places'), {
          ...payload,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });
      }
      resetPlaceForm();
    } catch (err) {
      console.error('Error saving place:', err);
    } finally {
      setIsSavingPlace(false);
    }
  };

  const handleDeletePlace = async (placeId: string) => {
    try {
      await deleteDoc(doc(db, 'places', placeId));
      if (editingPlaceId === placeId) resetPlaceForm();
    } catch (err) {
      console.error('Error deleting place:', err);
    }
  };

  // --- Handlers: Income Sources (Create, Edit, Delete) ---
  const resetIncomeSourceForm = () => {
    setEditingIncId(null);
    setIncName('');
    setIncType('fijo');
    setIncAmount('');
    setIncFreq('quincenal');
    setIncPayDay('15');
    setIncCategory('Sueldo / Quincena');
    setIncScope('personal');
  };

  const startEditIncomeSource = (src: IncomeSourceDef) => {
    setEditingIncId(src.id);
    setIncName(src.name);
    setIncType(src.type || 'fijo');
    setIncAmount(src.defaultAmount ? formatInputCOP(String(src.defaultAmount)) : '');
    setIncFreq(src.frequency || 'quincenal');
    setIncPayDay(src.payDay ? String(src.payDay) : '15');
    setIncCategory(src.defaultCategory || 'Sueldo / Quincena');
    setIncScope(src.defaultScope || 'personal');
  };

  const handleSaveIncomeSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !incName.trim() || isSavingInc) return;
    setIsSavingInc(true);
    try {
      const payload = {
        householdId: household?.id || 'default',
        name: incName.trim(),
        type: incType,
        defaultAmount: incAmount ? parseCOP(incAmount) : 0,
        frequency: incFreq,
        payDay: incPayDay ? Number(incPayDay) : null,
        defaultCategory: incCategory || 'Sueldo / Quincena',
        defaultScope: incScope,
        sharedWith: partnerUid ? [partnerUid] : [],
      };

      if (editingIncId) {
        await updateDoc(doc(db, 'incomeSources', editingIncId), payload);
      } else {
        await addDoc(collection(db, 'incomeSources'), {
          ...payload,
          active: true,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });
      }
      resetIncomeSourceForm();
    } catch (err) {
      console.error('Error saving income source:', err);
    } finally {
      setIsSavingInc(false);
    }
  };

  const handleDeleteIncomeSource = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'incomeSources', id));
      if (editingIncId === id) resetIncomeSourceForm();
    } catch (err) {
      console.error('Error deleting income source:', err);
    }
  };

  const navTabs: { id: ConfigTabId; label: string; icon: React.ReactNode }[] = [
    { id: 'metodos', label: 'Tarjetas', icon: <CreditCard size={14} /> },
    { id: 'catalogo', label: 'Categorías/Tags', icon: <TagIcon size={14} /> },
    { id: 'lugares', label: 'Comercios', icon: <Store size={14} /> },
    { id: 'ingresos', label: 'Fuentes Ingreso', icon: <Briefcase size={14} /> },
    { id: 'hogar', label: 'Hogar', icon: <Users size={14} /> },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Centro de Configuraciones">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '6px' }}>
        {/* Scrollable Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            overflowX: 'auto',
            background: 'var(--color-surface-container)',
            padding: '4px',
            borderRadius: '9999px',
            gap: '4px',
          }}
        >
          {navTabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                style={{
                  flex: '0 0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '8px 11px',
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: active ? 600 : 500,
                  backgroundColor: active ? 'var(--color-primary)' : 'transparent',
                  color: active ? '#FFF' : 'var(--color-on-surface-variant)',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* =================================================================== */}
        {/* TAB 1: MÉTODOS DE PAGO Y TARJETAS (RF-02)                           */}
        {/* =================================================================== */}
        {activeTab === 'metodos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '10px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                color: '#065F46',
                fontSize: '12px',
              }}
            >
              <ShieldCheck size={16} style={{ flexShrink: 0 }} />
              <span>
                Solo guardamos alias, titular y últimos 4 dígitos opcionales. Nunca el número completo ni CVV.
              </span>
            </div>

            <form
              onSubmit={handleSavePaymentMethod}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-surface-container-low)',
                border: editingPmId ? '1.5px solid var(--color-primary)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="text-label-sm">
                  {editingPmId ? 'Editando Tarjeta / Método' : 'Nueva Tarjeta / Método de Pago'}
                </span>
                {editingPmId && (
                  <button
                    type="button"
                    onClick={resetPmForm}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      color: 'var(--color-error)',
                      fontWeight: 600,
                    }}
                  >
                    <X size={13} /> Cancelar edición
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label className="text-label-sm">Tipo</label>
                  <select
                    value={pmType}
                    onChange={(e) => setPmType(e.target.value as PaymentMethodType)}
                    style={{
                      width: '100%',
                      padding: '9px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant)',
                      marginTop: '4px',
                    }}
                  >
                    <option value="credito">Tarjeta Crédito</option>
                    <option value="debito">Tarjeta Débito</option>
                    <option value="transferencia">Transferencia / Nequi</option>
                    <option value="efectivo">Efectivo</option>
                  </select>
                </div>
                <div>
                  <label className="text-label-sm">Titular</label>
                  <select
                    value={pmHolder || user?.uid || ''}
                    onChange={(e) => setPmHolder(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant)',
                      marginTop: '4px',
                    }}
                  >
                    <option value={user?.uid || ''}>
                      {profile?.displayName?.split(' ')[0] || 'Yo'}
                    </option>
                    {partner && (
                      <option value={partner.uid}>
                        {partner.displayName?.split(' ')[0] || 'Pareja'}
                      </option>
                    )}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '8px' }}>
                <Input
                  label="Alias (Ej. Visa Nu, Amex)"
                  placeholder="Ej. Mastercard Bancolombia"
                  value={pmAlias}
                  onChange={(e) => setPmAlias(e.target.value)}
                  required
                />
                <Input
                  label="Últimos 4 dígitos"
                  placeholder="1234"
                  maxLength={4}
                  value={pmLast4}
                  onChange={(e) => setPmLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </div>

              <Input
                label="Banco / Franquicia (Opcional)"
                placeholder="Ej. Bancolombia, Nu, Davivienda..."
                value={pmBank}
                onChange={(e) => setPmBank(e.target.value)}
              />

              {pmType === 'credito' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: '8px' }}>
                  <Input
                    label="Cupo ($ Opc.)"
                    placeholder="5.000.000"
                    value={pmCreditLimit}
                    onChange={(e) => setPmCreditLimit(formatInputCOP(e.target.value))}
                  />
                  <Input
                    label="Día Corte"
                    type="number"
                    min={1}
                    max={31}
                    placeholder="15"
                    value={pmCutDay}
                    onChange={(e) => setPmCutDay(e.target.value)}
                  />
                  <Input
                    label="Día Pago"
                    type="number"
                    min={1}
                    max={31}
                    placeholder="30"
                    value={pmDueDay}
                    onChange={(e) => setPmDueDay(e.target.value)}
                  />
                </div>
              )}

              <Button type="submit" variant="primary" disabled={!pmAlias.trim() || isSavingPm}>
                {editingPmId ? 'Guardar Cambios de Tarjeta' : '+ Guardar Tarjeta / Método'}
              </Button>
            </form>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              {paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    backgroundColor: pm.active
                      ? 'var(--color-surface-container-lowest)'
                      : 'var(--color-surface-container)',
                    border:
                      editingPmId === pm.id
                        ? '1.5px solid var(--color-primary)'
                        : '1px solid var(--color-outline-variant)',
                    opacity: pm.active ? 1 : 0.65,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>
                      {pm.alias} {pm.last4 ? `•••• ${pm.last4}` : ''}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                      {pm.type.toUpperCase()} • Titular: <strong>{pm.holderName || 'Hogar'}</strong>
                      {pm.bank ? ` • ${pm.bank}` : ''}
                      {pm.cutDay ? ` • Corte día ${pm.cutDay}` : ''}
                      {!pm.active && ' • (Inactivo)'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => startEditPaymentMethod(pm)}
                      style={{
                        padding: '6px 8px',
                        color: 'var(--color-primary)',
                        backgroundColor: 'var(--color-primary-container)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="Editar tarjeta"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePaymentMethodActive(pm)}
                      style={{
                        padding: '5px 10px',
                        fontSize: '11px',
                        backgroundColor: pm.active
                          ? 'rgba(245, 158, 11, 0.14)'
                          : 'rgba(16, 185, 129, 0.15)',
                        color: pm.active ? '#B45309' : 'var(--color-success)',
                        fontWeight: 600,
                      }}
                    >
                      {pm.active ? 'Pausar' : 'Activar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePaymentMethod(pm.id)}
                      style={{
                        padding: '6px 8px',
                        color: 'var(--color-error)',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="Eliminar tarjeta"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: CATEGORÍAS Y TAGS (RF-04)                                    */}
        {/* =================================================================== */}
        {activeTab === 'catalogo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <form
              onSubmit={handleSaveCategory}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-surface-container-low)',
                border: editingCatId ? '1.5px solid var(--color-primary)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="text-label-sm">
                  {editingCatId ? 'Editando Categoría' : 'Crear Nueva Categoría'}
                </span>
                {editingCatId && (
                  <button
                    type="button"
                    onClick={resetCategoryForm}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      color: 'var(--color-error)',
                      fontWeight: 600,
                    }}
                  >
                    <X size={13} /> Cancelar
                  </button>
                )}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr 1fr auto',
                  gap: '8px',
                  alignItems: 'center',
                }}
              >
                <input
                  type="text"
                  placeholder="Ej. Veterinaria, Gimnasio..."
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  style={{
                    padding: '9px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-outline-variant)',
                    fontSize: '13px',
                  }}
                />
                <select
                  value={catType}
                  onChange={(e) => setCatType(e.target.value as 'expense' | 'income')}
                  style={{
                    padding: '9px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-outline-variant)',
                    fontSize: '13px',
                  }}
                >
                  <option value="expense">Gasto</option>
                  <option value="income">Ingreso</option>
                </select>
                <input
                  type="color"
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  style={{
                    width: '36px',
                    height: '36px',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                  }}
                />
              </div>
              <Button type="submit" variant="primary" size="sm" disabled={!catName.trim()}>
                {editingCatId ? 'Actualizar Categoría' : '+ Guardar Categoría'}
              </Button>
            </form>

            <div>
              <span className="text-label-sm" style={{ display: 'block', marginBottom: '6px' }}>
                Categorías Activas (Toca el lápiz para editar o × para eliminar)
              </span>
              <div
                style={{
                  maxHeight: '145px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px',
                }}
              >
                {categories.map((c) => (
                  <span
                    key={c.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      fontSize: '12px',
                      backgroundColor:
                        editingCatId === c.id
                          ? 'var(--color-primary-container)'
                          : 'var(--color-surface-container)',
                      borderLeft: `4px solid ${c.color}`,
                    }}
                  >
                    <span>{c.name}</span>
                    <button
                      type="button"
                      onClick={() => startEditCategory(c)}
                      style={{
                        color: 'var(--color-primary)',
                        padding: '2px',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                      title="Editar categoría"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(c)}
                      style={{
                        color: 'var(--color-error)',
                        padding: '2px',
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                      title="Eliminar categoría"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div
              style={{
                borderTop: '1px solid var(--color-outline-variant)',
                paddingTop: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="text-label-sm">
                  {editingTagId ? 'Editando #Tag' : 'Gestionar #Tags Transversales'}
                </span>
                {editingTagId && (
                  <button
                    type="button"
                    onClick={resetTagForm}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      color: 'var(--color-error)',
                      fontWeight: 600,
                    }}
                  >
                    <X size={13} /> Cancelar
                  </button>
                )}
              </div>
              <form
                onSubmit={handleSaveTag}
                style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
              >
                <input
                  type="text"
                  placeholder="Nuevo #tag (ej. dolarcity, paseo, mascota)..."
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-outline-variant)',
                    fontSize: '13px',
                  }}
                />
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  style={{
                    width: '34px',
                    height: '34px',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                  }}
                />
                <Button type="submit" variant="primary" size="sm" disabled={!newTagName.trim()}>
                  {editingTagId ? 'Guardar' : '+ Tag'}
                </Button>
              </form>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px',
                  maxHeight: '115px',
                  overflowY: 'auto',
                }}
              >
                {tags.map((t) => (
                  <span
                    key={t.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      fontSize: '12px',
                      backgroundColor:
                        editingTagId === t.id
                          ? 'var(--color-primary-container)'
                          : 'rgba(59, 130, 246, 0.1)',
                      color: 'var(--color-primary-dark)',
                      fontWeight: 500,
                      borderLeft: t.color ? `3px solid ${t.color}` : undefined,
                    }}
                  >
                    <span>#{t.name}</span>
                    <button
                      type="button"
                      onClick={() => startEditTag(t)}
                      style={{
                        color: 'var(--color-primary)',
                        padding: '2px',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                      title="Editar tag"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTag(t.id)}
                      style={{
                        color: 'var(--color-error)',
                        padding: '2px',
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                      title="Eliminar tag"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: LUGARES Y COMERCIOS FRECUENTES (RF-03 + Autocompletado)      */}
        {/* =================================================================== */}
        {activeTab === 'lugares' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              Configura tus lugares o comercios habituales (ej. Éxito, Dolarcity, Ara, Gasolinera). Al seleccionarlos al crear un gasto, se autocompletará su categoría, tags y tarjeta favorita.
            </p>

            <form
              onSubmit={handleSavePlace}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-surface-container-low)',
                border: editingPlaceId ? '1.5px solid var(--color-primary)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="text-label-sm">
                  {editingPlaceId ? 'Editando Comercio / Lugar' : 'Nuevo Comercio / Lugar'}
                </span>
                {editingPlaceId && (
                  <button
                    type="button"
                    onClick={resetPlaceForm}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      color: 'var(--color-error)',
                      fontWeight: 600,
                    }}
                  >
                    <X size={13} /> Cancelar edición
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '8px' }}>
                <Input
                  label="Nombre del Comercio / Lugar"
                  placeholder="Ej. Dolarcity, Éxito, Crepes..."
                  value={placeName}
                  onChange={(e) => setPlaceName(e.target.value)}
                  required
                />
                <div>
                  <label className="text-label-sm">Categoría por defecto</label>
                  <select
                    value={placeCat}
                    onChange={(e) => setPlaceCat(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant)',
                      marginTop: '4px',
                    }}
                  >
                    {expenseCategories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label className="text-label-sm">Método de pago habitual</label>
                  <select
                    value={placePmId}
                    onChange={(e) => setPlacePmId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant)',
                      marginTop: '4px',
                    }}
                  >
                    <option value="">Cualquiera</option>
                    {paymentMethods
                      .filter((p) => p.active !== false)
                      .map((pm) => (
                        <option key={pm.id} value={pm.id}>
                          {pm.alias} ({pm.holderName || 'Hogar'})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-label-sm">Ámbito habitual</label>
                  <select
                    value={placeScope}
                    onChange={(e) => setPlaceScope(e.target.value as Scope)}
                    style={{
                      width: '100%',
                      padding: '9px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant)',
                      marginTop: '4px',
                    }}
                  >
                    <option value="personal">Personal (Mío)</option>
                    <option value="conjunto">Conjunto (Hogar)</option>
                  </select>
                </div>
              </div>

              <Input
                label="Tags automáticos separados por coma (Opcional)"
                placeholder="Ej. mercado, hogar, quincena"
                value={placeTagsInput}
                onChange={(e) => setPlaceTagsInput(e.target.value)}
              />

              <Button type="submit" variant="primary" disabled={!placeName.trim() || isSavingPlace}>
                {editingPlaceId ? 'Guardar Cambios del Comercio' : '+ Guardar Comercio / Lugar'}
              </Button>
            </form>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '200px',
                overflowY: 'auto',
              }}
            >
              {knownPlaces.length === 0 ? (
                <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                  Aún no has guardado comercios preconfigurados.
                </p>
              ) : (
                knownPlaces.map((pl) => (
                  <div
                    key={pl.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--color-surface-container-lowest)',
                      border:
                        editingPlaceId === pl.id
                          ? '1.5px solid var(--color-primary)'
                          : '1px solid var(--color-outline-variant)',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>{pl.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                        Categoría: <strong>{pl.defaultCategory}</strong> •{' '}
                        {pl.defaultScope === 'conjunto' ? 'Conjunto' : 'Personal'}
                        {pl.defaultTags && pl.defaultTags.length > 0
                          ? ` • #${pl.defaultTags.join(' #')}`
                          : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => startEditPlace(pl)}
                        style={{
                          padding: '6px 8px',
                          color: 'var(--color-primary)',
                          backgroundColor: 'var(--color-primary-container)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Editar comercio"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePlace(pl.id)}
                        style={{
                          padding: '6px 8px',
                          color: 'var(--color-error)',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Eliminar comercio"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: FUENTES DE INGRESOS (RF-05)                                  */}
        {/* =================================================================== */}
        {activeTab === 'ingresos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              Registra tus fuentes de ingreso fijas (sueldo, arriendo) o variables (freelance, comisiones) para seleccionarlas en 1 toque cuando recibas dinero.
            </p>

            <form
              onSubmit={handleSaveIncomeSource}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-surface-container-low)',
                border: editingIncId ? '1.5px solid var(--color-primary)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="text-label-sm">
                  {editingIncId ? 'Editando Fuente de Ingreso' : 'Nueva Fuente de Ingreso'}
                </span>
                {editingIncId && (
                  <button
                    type="button"
                    onClick={resetIncomeSourceForm}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      color: 'var(--color-error)',
                      fontWeight: 600,
                    }}
                  >
                    <X size={13} /> Cancelar edición
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '8px' }}>
                <Input
                  label="Nombre de la Fuente"
                  placeholder="Ej. Nómina Empresa, Cliente X..."
                  value={incName}
                  onChange={(e) => setIncName(e.target.value)}
                  required
                />
                <Input
                  label="Monto Base ($ Opc.)"
                  placeholder="Ej. 2.500.000"
                  value={incAmount}
                  onChange={(e) => setIncAmount(formatInputCOP(e.target.value))}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div>
                  <label className="text-label-sm">Tipo</label>
                  <select
                    value={incType}
                    onChange={(e) => setIncType(e.target.value as 'fijo' | 'variable')}
                    style={{
                      width: '100%',
                      padding: '9px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant)',
                      marginTop: '4px',
                    }}
                  >
                    <option value="fijo">Fijo</option>
                    <option value="variable">Variable</option>
                  </select>
                </div>
                <div>
                  <label className="text-label-sm">Frecuencia</label>
                  <select
                    value={incFreq}
                    onChange={(e) => setIncFreq(e.target.value as IncomeFrequency)}
                    style={{
                      width: '100%',
                      padding: '9px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant)',
                      marginTop: '4px',
                    }}
                  >
                    <option value="quincenal">Quincenal</option>
                    <option value="mensual">Mensual</option>
                    <option value="unico">Variable / Único</option>
                  </select>
                </div>
                <div>
                  <label className="text-label-sm">Ámbito</label>
                  <select
                    value={incScope}
                    onChange={(e) => setIncScope(e.target.value as Scope)}
                    style={{
                      width: '100%',
                      padding: '9px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant)',
                      marginTop: '4px',
                    }}
                  >
                    <option value="personal">Personal</option>
                    <option value="conjunto">Conjunto</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '8px' }}>
                <div>
                  <label className="text-label-sm">Categoría de Ingreso</label>
                  <select
                    value={incCategory}
                    onChange={(e) => setIncCategory(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant)',
                      marginTop: '4px',
                    }}
                  >
                    {incomeCategories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Día de pago (1-31)"
                  type="number"
                  min={1}
                  max={31}
                  placeholder="15"
                  value={incPayDay}
                  onChange={(e) => setIncPayDay(e.target.value)}
                />
              </div>

              <Button type="submit" variant="primary" disabled={!incName.trim() || isSavingInc}>
                {editingIncId ? 'Guardar Cambios de Fuente' : '+ Guardar Fuente de Ingreso'}
              </Button>
            </form>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '200px',
                overflowY: 'auto',
              }}
            >
              {incomeSources.length === 0 ? (
                <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                  Aún no has registrado fuentes de ingreso en el catálogo.
                </p>
              ) : (
                incomeSources.map((src) => (
                  <div
                    key={src.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--color-surface-container-lowest)',
                      border:
                        editingIncId === src.id
                          ? '1.5px solid var(--color-primary)'
                          : '1px solid var(--color-outline-variant)',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>
                        {src.name}{' '}
                        {src.defaultAmount ? `(${formatCOP(src.defaultAmount)})` : ''}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                        {src.type.toUpperCase()} • {src.frequency || 'Mensual'} •{' '}
                        {src.defaultCategory}
                        {src.payDay ? ` • Día ${src.payDay}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => startEditIncomeSource(src)}
                        style={{
                          padding: '6px 8px',
                          color: 'var(--color-primary)',
                          backgroundColor: 'var(--color-primary-container)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Editar fuente de ingreso"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteIncomeSource(src.id)}
                        style={{
                          padding: '6px 8px',
                          color: 'var(--color-error)',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Eliminar fuente de ingreso"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 5: HOGAR Y PAREJA (RF-01 & RF-12)                               */}
        {/* =================================================================== */}
        {activeTab === 'hogar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-surface-container-low)',
                border: '1px solid var(--color-outline-variant)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                    Código de invitación de tu hogar
                  </span>
                  <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-primary)' }}>
                    {household?.inviteCode || 'HOGAR-ACTIVO'}
                  </p>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={handleCopyCode}>
                  {copiedCode ? <Check size={16} /> : <Copy size={16} />}
                  <span style={{ marginLeft: '4px' }}>{copiedCode ? 'Copiado' : 'Copiar'}</span>
                </Button>
              </div>
              <p className="text-label-sm" style={{ marginTop: '8px', color: 'var(--color-on-surface-variant)' }}>
                Miembros vinculados:{' '}
                <strong>
                  {profile?.displayName || 'Tú'}
                  {partner ? ` + ${partner.displayName || partner.email}` : ' (Sin pareja vinculada aún)'}
                </strong>
              </p>
            </div>

            <form onSubmit={handleLinkPartner} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Input
                label="Vincular con tu pareja (Correo o Código HOGAR-...)"
                placeholder="correo@ejemplo.com o HOGAR-XXXXX"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
              />
              {linkStatus && (
                <p
                  style={{
                    fontSize: '12px',
                    color: linkStatus.ok ? 'var(--color-success)' : 'var(--color-error)',
                    fontWeight: 500,
                  }}
                >
                  {linkStatus.msg}
                </p>
              )}
              <Button type="submit" variant="primary" disabled={!inviteInput.trim()}>
                Vincular Pareja al Hogar
              </Button>
            </form>

            <div
              style={{
                borderTop: '1px solid var(--color-outline-variant)',
                paddingTop: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div>
                <label className="text-label-sm" style={{ display: 'block', marginBottom: '8px' }}>
                  🎨 Color del Layout (Tema)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {(Object.keys(THEME_COLOR_PALETTES) as ThemeColor[]).map((colorKey) => {
                    const palette = THEME_COLOR_PALETTES[colorKey];
                    const isSelected = themeColor === colorKey;
                    return (
                      <button
                        key={colorKey}
                        type="button"
                        onClick={() => setThemeColor(colorKey)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 4px',
                          borderRadius: '14px',
                          border: isSelected
                            ? `2px solid ${palette.primary}`
                            : '1px solid var(--color-outline-variant)',
                          backgroundColor: isSelected
                            ? palette.primaryContainer
                            : 'var(--color-surface-container-lowest)',
                          cursor: 'pointer',
                        }}
                      >
                        <span
                          style={{
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${palette.primary}, ${palette.primaryDark})`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                          }}
                        >
                          {isSelected && <Check size={13} />}
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: isSelected ? 700 : 500,
                            color: isSelected ? palette.primaryDark : 'var(--color-on-surface)',
                          }}
                        >
                          {palette.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-label-sm" style={{ display: 'block', marginBottom: '6px' }}>
                  Regla de reparto para gastos conjuntos (Balance de pareja)
                </label>
                <select
                  value={household?.splitRule || '50_50'}
                  onChange={(e) => updateHouseholdConfig({ splitRule: e.target.value as SplitRule })}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container-lowest)',
                    fontSize: '14px',
                  }}
                >
                  <option value="50_50">50% / 50% (Mitad y mitad)</option>
                  <option value="proportional">Proporcional a los ingresos del mes</option>
                </select>
              </div>

              <div>
                <label className="text-label-sm" style={{ display: 'block', marginBottom: '6px' }}>
                  Visibilidad de gastos personales del otro
                </label>
                <select
                  value={household?.personalVisibility || 'full_detail'}
                  onChange={(e) =>
                    updateHouseholdConfig({
                      personalVisibility: e.target.value as 'totals_only' | 'full_detail',
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container-lowest)',
                    fontSize: '14px',
                  }}
                >
                  <option value="full_detail">Ver detalle completo</option>
                  <option value="totals_only">Ver solo totales personales</option>
                </select>
              </div>

              {partnerUid && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '12px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.06)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Trash2 size={16} color="#DC2626" />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#DC2626' }}>
                      Zona de limpieza: {partner?.displayName || 'Pareja'}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', margin: 0 }}>
                    Elimina únicamente los datos creados por{' '}
                    <strong>{partner?.displayName || 'tu pareja'}</strong> (gastos, tarjetas, deudas, ahorros y listas).
                    Su cuenta de usuario y el vínculo con el hogar permanecen intactos.
                  </p>
                  {resetPartnerStatus && (
                    <p
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: resetPartnerStatus.ok ? '#059669' : '#DC2626',
                        margin: 0,
                      }}
                    >
                      {resetPartnerStatus.msg}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={isResettingPartner}
                    onClick={handleResetPartnerData}
                    style={{ alignSelf: 'flex-start', marginTop: '4px' }}
                  >
                    {isResettingPartner
                      ? 'Eliminando datos...'
                      : `Borrar todos los datos de ${partner?.displayName || 'tu pareja'}`}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
