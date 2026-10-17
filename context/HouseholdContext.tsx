'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  or,
  arrayUnion,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import {
  Household,
  PaymentMethod,
  CategoryDef,
  TagDef,
  KnownPlace,
  IncomeSourceDef,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_TAGS,
  SplitRule,
  ThemeColor,
} from '@/lib/models';
import { useUsersMap, UserProfile } from '@/lib/hooks/useUsersMap';

export type GlobalScopeFilter = 'mio' | 'conjunto' | 'pareja' | 'todo';

export const THEME_COLOR_PALETTES: Record<
  ThemeColor,
  {
    label: string;
    primary: string;
    primaryDark: string;
    primaryContainer: string;
    shadow: string;
  }
> = {
  azul: {
    label: 'Azul',
    primary: '#3B82F6',
    primaryDark: '#2563EB',
    primaryContainer: '#EFF6FF',
    shadow: '0px 8px 20px rgba(59, 130, 246, 0.25)',
  },
  morado: {
    label: 'Morado',
    primary: '#8B5CF6',
    primaryDark: '#6D28D9',
    primaryContainer: '#F5F3FF',
    shadow: '0px 8px 20px rgba(139, 92, 246, 0.25)',
  },
  verde: {
    label: 'Verde',
    primary: '#10B981',
    primaryDark: '#059669',
    primaryContainer: '#ECFDF5',
    shadow: '0px 8px 20px rgba(16, 185, 129, 0.25)',
  },
  amarillo: {
    label: 'Amarillo',
    primary: '#F59E0B',
    primaryDark: '#D97706',
    primaryContainer: '#FFFBEB',
    shadow: '0px 8px 20px rgba(245, 158, 11, 0.25)',
  },
};

interface HouseholdContextType {
  household: Household | null;
  partner: UserProfile | null;
  partnerUid: string | null;
  memberIds: string[];
  globalScope: GlobalScopeFilter;
  setGlobalScope: (scope: GlobalScopeFilter) => void;
  themeColor: ThemeColor;
  setThemeColor: (color: ThemeColor) => Promise<void>;
  paymentMethods: PaymentMethod[];
  categories: CategoryDef[];
  tags: TagDef[];
  knownPlaces: KnownPlace[];
  incomeSources: IncomeSourceDef[];
  lastUsedPaymentMethodId: string;
  setLastUsedPaymentMethodId: (id: string) => void;
  linkPartnerByEmailOrCode: (emailOrCode: string) => Promise<{ ok: boolean; message: string }>;
  updateHouseholdConfig: (partial: Partial<Household>) => Promise<void>;
  resetAllHouseholdDataExceptUsers: () => Promise<{ ok: boolean; deletedCount: number; message: string }>;
  loadingHousehold: boolean;
}

const HouseholdContext = createContext<HouseholdContextType>({
  household: null,
  partner: null,
  partnerUid: null,
  memberIds: [],
  globalScope: 'mio',
  setGlobalScope: () => {},
  themeColor: 'azul',
  setThemeColor: async () => {},
  paymentMethods: [],
  categories: [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES],
  tags: [],
  knownPlaces: [],
  incomeSources: [],
  lastUsedPaymentMethodId: '',
  setLastUsedPaymentMethodId: () => {},
  linkPartnerByEmailOrCode: async () => ({ ok: false, message: '' }),
  updateHouseholdConfig: async () => {},
  resetAllHouseholdDataExceptUsers: async () => ({ ok: false, deletedCount: 0, message: '' }),
  loadingHousehold: true,
});

export const useHousehold = () => useContext(HouseholdContext);

function generateInviteCode(uid: string): string {
  return `HOGAR-${uid.substring(0, 5).toUpperCase()}`;
}

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const { usersMap } = useUsersMap();

  const [household, setHousehold] = useState<Household | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [customCategories, setCustomCategories] = useState<CategoryDef[]>([]);
  const [tags, setTags] = useState<TagDef[]>([]);
  const [knownPlaces, setKnownPlaces] = useState<KnownPlace[]>([]);
  const [incomeSources, setIncomeSources] = useState<IncomeSourceDef[]>([]);
  const [globalScope, setGlobalScopeState] = useState<GlobalScopeFilter>('todo');
  const [themeColor, setThemeColorState] = useState<ThemeColor>('azul');
  const [lastUsedPaymentMethodId, setLastUsedPaymentMethodIdState] = useState<string>('');
  const [loadingHousehold, setLoadingHousehold] = useState<boolean>(true);

  const applyThemePaletteToDOM = (color: ThemeColor) => {
    if (typeof document === 'undefined') return;
    const pal = THEME_COLOR_PALETTES[color] || THEME_COLOR_PALETTES.azul;
    const root = document.documentElement;
    root.style.setProperty('--color-primary', pal.primary);
    root.style.setProperty('--color-primary-dark', pal.primaryDark);
    root.style.setProperty('--color-primary-container', pal.primaryContainer);
    root.style.setProperty('--shadow-level-2', pal.shadow);
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedScope = localStorage.getItem('gastos_global_scope_v2') as GlobalScopeFilter | null;
      if (savedScope && ['mio', 'conjunto', 'pareja', 'todo'].includes(savedScope)) {
        setGlobalScopeState(savedScope);
      } else {
        setGlobalScopeState('todo');
      }
      const savedTheme = localStorage.getItem('gastos_theme_color') as ThemeColor | null;
      if (savedTheme && ['azul', 'morado', 'verde', 'amarillo'].includes(savedTheme)) {
        setThemeColorState(savedTheme);
        applyThemePaletteToDOM(savedTheme);
      }
      const savedPm = localStorage.getItem('gastos_last_pm');
      if (savedPm) setLastUsedPaymentMethodIdState(savedPm);
    }
  }, []);

  useEffect(() => {
    if (household?.themeColor && ['azul', 'morado', 'verde', 'amarillo'].includes(household.themeColor)) {
      const savedLocal =
        typeof window !== 'undefined'
          ? (localStorage.getItem('gastos_theme_color') as ThemeColor | null)
          : null;
      if (!savedLocal) {
        setThemeColorState(household.themeColor);
        applyThemePaletteToDOM(household.themeColor);
      }
    }
  }, [household?.themeColor]);

  const setThemeColor = async (color: ThemeColor) => {
    setThemeColorState(color);
    applyThemePaletteToDOM(color);
    if (typeof window !== 'undefined') {
      localStorage.setItem('gastos_theme_color', color);
    }
    if (household?.id) {
      try {
        await updateDoc(doc(db, 'households', household.id), {
          themeColor: color,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        // ignore
      }
    }
  };

  const setGlobalScope = (scope: GlobalScopeFilter) => {
    setGlobalScopeState(scope);
    if (typeof window !== 'undefined') {
      localStorage.setItem('gastos_global_scope_v2', scope);
    }
  };

  const setLastUsedPaymentMethodId = (id: string) => {
    setLastUsedPaymentMethodIdState(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem('gastos_last_pm', id);
    }
  };

  // 1. Bootstrap or subscribe to Household + automatic non-destructive backfill & household deduplication
  useEffect(() => {
    if (!user) {
      setHousehold(null);
      setLoadingHousehold(false);
      return;
    }

    let unsubHousehold: (() => void) | null = null;

    const initHousehold = async () => {
      try {
        const hhRef = collection(db, 'households');
        const qHh = query(hhRef, where('memberIds', 'array-contains', user.uid));
        const snap = await getDocs(qHh);

        // Also check legacy financeSettings / paymentsSettings for any linked partner
        const discoveredMembers = new Set<string>([user.uid]);
        try {
          const finSetSnap = await getDoc(doc(db, 'financeSettings', user.uid));
          if (finSetSnap.exists()) {
            const sw = finSetSnap.data().sharedWith || [];
            sw.forEach((id: string) => id && discoveredMembers.add(id));
          }
          const paySetSnap = await getDoc(doc(db, 'paymentsSettings', user.uid));
          if (paySetSnap.exists()) {
            const sw = paySetSnap.data().sharedWith || [];
            sw.forEach((id: string) => id && discoveredMembers.add(id));
          }
        } catch (e) {
          // ignore
        }

        let targetHouseholdId = '';

        if (!snap.empty) {
          // Prefer a household that already has >1 member (shared with partner)
          const docs = snap.docs;
          docs.forEach((d) => {
            const mIds: string[] = d.data().memberIds || [];
            mIds.forEach((id) => id && discoveredMembers.add(id));
          });

          const sharedDoc = docs.find((d) => (d.data().memberIds || []).length > 1) || docs[0];
          targetHouseholdId = sharedDoc.id;

          const allMembers = Array.from(discoveredMembers);
          const currentMembers: string[] = sharedDoc.data().memberIds || [];
          if (allMembers.some((m) => !currentMembers.includes(m))) {
            await updateDoc(doc(db, 'households', targetHouseholdId), {
              memberIds: arrayUnion(...allMembers),
            });
          }

          // Remove any duplicate solo household documents so both partners always resolve to the same household
          for (const d of docs) {
            if (d.id !== targetHouseholdId) {
              try {
                await deleteDoc(doc(db, 'households', d.id));
              } catch (e) {
                // ignore
              }
            }
          }
        } else {
          // Check if discovered partner already created a household
          const memberArray = Array.from(discoveredMembers);
          const partnerCandidate = memberArray.find((id) => id !== user.uid);
          if (partnerCandidate) {
            const qPartnerHh = query(hhRef, where('memberIds', 'array-contains', partnerCandidate));
            const pSnap = await getDocs(qPartnerHh);
            if (!pSnap.empty) {
              targetHouseholdId = pSnap.docs[0].id;
              await updateDoc(doc(db, 'households', targetHouseholdId), {
                memberIds: arrayUnion(...memberArray),
              });
            }
          }

          if (!targetHouseholdId) {
            const newHhId = `hh_${user.uid.substring(0, 10)}`;
            const newHousehold: Household = {
              id: newHhId,
              name: 'Nuestro Hogar',
              currency: 'COP',
              timezone: 'America/Bogota',
              splitRule: '50_50',
              memberIds: memberArray,
              inviteCode: generateInviteCode(user.uid),
              personalVisibility: 'full_detail',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            await setDoc(doc(db, 'households', newHhId), newHousehold);
            targetHouseholdId = newHhId;
          }
        }

        // Subscribe to household document
        unsubHousehold = onSnapshot(doc(db, 'households', targetHouseholdId), (docSnap) => {
          if (docSnap.exists()) {
            setHousehold({ id: docSnap.id, ...docSnap.data() } as Household);
          }
          setLoadingHousehold(false);
        });
      } catch (err) {
        console.error('Error initializing household:', err);
        setLoadingHousehold(false);
      }
    };

    initHousehold();

    return () => {
      if (unsubHousehold) unsubHousehold();
    };
  }, [user]);

  // 2. Subscribe to Payment Methods, Categories, and Tags shared in the household
  useEffect(() => {
    if (!user) return;
    const hhId = household?.id || '';
    const members = household?.memberIds?.length ? household.memberIds : [user.uid];

    const buildHouseholdFilter = () => {
      const clauses: any[] = [
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid),
      ];
      if (hhId) {
        clauses.push(where('householdId', '==', hhId));
      }
      for (const mId of members) {
        if (mId && mId !== user.uid) {
          clauses.push(where('ownerId', '==', mId));
        }
      }
      return or(...clauses);
    };

    const pmRef = collection(db, 'paymentMethods');
    const qPm = query(pmRef, buildHouseholdFilter());
    const unsubPm = onSnapshot(qPm, async (snapshot) => {
      const list: PaymentMethod[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...d.data() } as PaymentMethod));

      // Seed default payment methods if user has none yet
      if (list.length === 0 && household) {
        const partnerIds = (household.memberIds || []).filter((id) => id !== user.uid);
        const defaults: Omit<PaymentMethod, 'id'>[] = [
          {
            householdId: household.id,
            type: 'efectivo',
            alias: 'Efectivo / Billetera',
            holderUserId: user.uid,
            holderName: profile?.displayName?.split(' ')[0] || 'Titular',
            active: true,
            ownerId: user.uid,
            sharedWith: partnerIds,
            createdAt: serverTimestamp(),
          },
          {
            householdId: household.id,
            type: 'transferencia',
            alias: 'Nequi / Transferencia',
            holderUserId: user.uid,
            holderName: profile?.displayName?.split(' ')[0] || 'Titular',
            bank: 'Bancolombia / Nequi',
            active: true,
            ownerId: user.uid,
            sharedWith: partnerIds,
            createdAt: serverTimestamp(),
          },
          {
            householdId: household.id,
            type: 'debito',
            alias: 'Tarjeta Débito Principal',
            holderUserId: user.uid,
            holderName: profile?.displayName?.split(' ')[0] || 'Titular',
            active: true,
            ownerId: user.uid,
            sharedWith: partnerIds,
            createdAt: serverTimestamp(),
          },
        ];
        try {
          for (const pm of defaults) {
            await addDoc(pmRef, pm);
          }
        } catch (e) {
          console.warn('Could not seed default payment methods:', e);
        }
      } else {
        setPaymentMethods(list);
      }
    });

    const catRef = collection(db, 'financeCategories');
    const qCat = query(catRef, buildHouseholdFilter());
    const unsubCat = onSnapshot(qCat, (snapshot) => {
      const list: CategoryDef[] = [];
      snapshot.forEach((d) => {
        const raw = d.data();
        list.push({
          id: d.id,
          name: raw.name,
          type: raw.type === 'income' ? 'income' : 'expense',
          color: raw.color || '#6366F1',
          icon: raw.icon || 'Tag',
          parentId: raw.parentId || null,
          ownerId: raw.ownerId,
          sharedWith: raw.sharedWith || [],
        });
      });
      setCustomCategories(list);
    });

    const tagRef = collection(db, 'tags');
    const qTag = query(tagRef, buildHouseholdFilter());
    const unsubTag = onSnapshot(qTag, (snapshot) => {
      const list: TagDef[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...d.data() } as TagDef));
      setTags(list);
    });

    const placesRef = collection(db, 'places');
    const qPlaces = query(placesRef, buildHouseholdFilter());
    const unsubPlaces = onSnapshot(qPlaces, (snapshot) => {
      const list: KnownPlace[] = [];
      snapshot.forEach((d) => list.push({ ...(d.data() as KnownPlace), id: d.id }));
      setKnownPlaces(list);
    });

    const incSrcRef = collection(db, 'incomeSources');
    const qIncSrc = query(incSrcRef, buildHouseholdFilter());
    const unsubIncSrc = onSnapshot(qIncSrc, (snapshot) => {
      const list: IncomeSourceDef[] = [];
      snapshot.forEach((d) => list.push({ ...(d.data() as IncomeSourceDef), id: d.id }));
      setIncomeSources(list);
    });

    return () => {
      unsubPm();
      unsubCat();
      unsubTag();
      unsubPlaces();
      unsubIncSrc();
    };
  }, [user, household?.id, household?.memberIds?.join(','), profile?.displayName]);

  const memberIds = household?.memberIds?.length
    ? household.memberIds
    : user
    ? [user.uid]
    : [];

  const partnerUid = memberIds.find((id) => id !== user?.uid) || null;
  const partner = partnerUid ? usersMap[partnerUid] || null : null;

  // 3. Automatic continuous Household Sharing Sync:
  // Whenever a user is part of a household with a partner (e.g. Daniel + Yulitza),
  // ensure all documents owned by this user have `sharedWith` containing all other household members
  // and `householdId` set to `household.id`, so the partner can see everything immediately across all views.
  useEffect(() => {
    if (!user || !household?.id) return;
    const otherMembers = (household.memberIds || []).filter((id) => id && id !== user.uid);
    if (otherMembers.length === 0) return;

    const syncOwnedDocs = async () => {
      const ownerCollections = [
        'paymentMethods',
        'transactions',
        'debts',
        'recurringPayments',
        'savings',
        'budgets',
        'financeCategories',
        'tags',
        'places',
        'incomeSources',
        'lists',
        'history',
      ];

      for (const colName of ownerCollections) {
        try {
          const qOwned = query(collection(db, colName), where('ownerId', '==', user.uid));
          const snap = await getDocs(qOwned);
          for (const dSnap of snap.docs) {
            const data = dSnap.data();
            const currentShared: string[] = Array.isArray(data.sharedWith) ? data.sharedWith : [];
            const missing = otherMembers.filter((m) => !currentShared.includes(m));
            if (missing.length > 0 || data.householdId !== household.id) {
              await updateDoc(doc(db, colName, dSnap.id), {
                sharedWith: arrayUnion(...otherMembers),
                householdId: household.id,
              });
            }
          }
        } catch (e) {
          // ignore individual collection sync warning
        }
      }

      try {
        const qWs = query(collection(db, 'periodWorksheets'), where('userId', '==', user.uid));
        const wsSnap = await getDocs(qWs);
        for (const dSnap of wsSnap.docs) {
          const data = dSnap.data();
          const currentShared: string[] = Array.isArray(data.sharedWith) ? data.sharedWith : [];
          const missing = otherMembers.filter((m) => !currentShared.includes(m));
          if (missing.length > 0 || data.householdId !== household.id) {
            await updateDoc(doc(db, 'periodWorksheets', dSnap.id), {
              sharedWith: arrayUnion(...otherMembers),
              householdId: household.id,
            });
          }
        }
      } catch (e) {
        // ignore worksheet sync warning
      }
    };

    syncOwnedDocs();
  }, [user?.uid, household?.id, household?.memberIds?.join(',')]);

  // Combine default categories + custom categories, allowing custom edits or deletions of defaults
  const categories = React.useMemo(() => {
    const disabledIds = new Set(household?.disabledDefaultCategoryIds || []);
    const customById = new Map(customCategories.map((c) => [c.id, c]));
    const base = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES]
      .filter((c) => !disabledIds.has(c.id))
      .map((c) => customById.get(c.id) || c);

    const existingIds = new Set(base.map((c) => c.id));
    const existingKeys = new Set(base.map((c) => `${c.type}:${c.name.toLowerCase()}`));
    const extras = customCategories.filter(
      (c) =>
        !disabledIds.has(c.id) &&
        !existingIds.has(c.id) &&
        !existingKeys.has(`${c.type}:${c.name.toLowerCase()}`)
    );
    return [...base, ...extras];
  }, [customCategories, household?.disabledDefaultCategoryIds]);

  // Combine default tags + custom tags, allowing custom edits or deletions of defaults
  const mergedTags = React.useMemo(() => {
    const disabledIds = new Set(household?.disabledDefaultTagIds || []);
    const customById = new Map(tags.map((t) => [t.id, t]));
    const defaultsWithIds: TagDef[] = DEFAULT_TAGS.map((dt, i) => ({
      id: `def-tag-${i}`,
      name: dt.name,
      color: dt.color,
      ownerId: user?.uid || '',
      sharedWith: [],
    }));

    const base = defaultsWithIds
      .filter((dt) => !disabledIds.has(dt.id))
      .map((dt) => customById.get(dt.id) || dt);

    const existingIds = new Set(base.map((t) => t.id));
    const existingNames = new Set(base.map((t) => t.name.toLowerCase()));
    const extras = tags.filter(
      (t) =>
        !disabledIds.has(t.id) &&
        !existingIds.has(t.id) &&
        !existingNames.has(t.name.toLowerCase())
    );
    return [...base, ...extras];
  }, [tags, household?.disabledDefaultTagIds, user?.uid]);

  const linkPartnerByEmailOrCode = async (
    emailOrCode: string
  ): Promise<{ ok: boolean; message: string }> => {
    if (!user || !household) {
      return { ok: false, message: 'Sesión no iniciada.' };
    }
    const clean = emailOrCode.trim();
    if (!clean) {
      return { ok: false, message: 'Ingresa un correo o código de invitación.' };
    }

    try {
      let friendUid = '';
      let friendName = '';

      if (clean.toUpperCase().startsWith('HOGAR-')) {
        const qCode = query(
          collection(db, 'households'),
          where('inviteCode', '==', clean.toUpperCase())
        );
        const codeSnap = await getDocs(qCode);
        if (codeSnap.empty) {
          return { ok: false, message: 'No se encontró ningún hogar con ese código.' };
        }
        const targetHh = codeSnap.docs[0];
        const targetData = targetHh.data() as Household;
        const otherUid = (targetData.memberIds || []).find((id) => id !== user.uid);
        if (otherUid) {
          friendUid = otherUid;
        }
        await updateDoc(doc(db, 'households', targetHh.id), {
          memberIds: arrayUnion(user.uid),
          updatedAt: serverTimestamp(),
        });
      } else {
        const qUser = query(
          collection(db, 'users'),
          where('email', '==', clean.toLowerCase())
        );
        const userSnap = await getDocs(qUser);
        if (userSnap.empty) {
          return {
            ok: false,
            message: 'Ese correo aún no ha iniciado sesión en la aplicación.',
          };
        }
        const friendDoc = userSnap.docs[0].data();
        friendUid = friendDoc.uid;
        friendName = friendDoc.displayName || clean;
      }

      if (!friendUid || friendUid === user.uid) {
        return { ok: false, message: 'No puedes vincularte contigo mismo.' };
      }

      // Update current household with both members
      await updateDoc(doc(db, 'households', household.id), {
        memberIds: arrayUnion(user.uid, friendUid),
        updatedAt: serverTimestamp(),
      });

      // Also remove or merge any separate solo household belonging to friendUid so both share a single householdId
      try {
        const qFriendHh = query(
          collection(db, 'households'),
          where('memberIds', 'array-contains', friendUid)
        );
        const fHhSnap = await getDocs(qFriendHh);
        for (const fDoc of fHhSnap.docs) {
          if (fDoc.id !== household.id) {
            await deleteDoc(doc(db, 'households', fDoc.id));
          }
        }
      } catch (e) {
        // ignore
      }

      // Keep legacy financeSettings & paymentsSettings synchronized for BOTH users
      await setDoc(
        doc(db, 'financeSettings', user.uid),
        { sharedWith: arrayUnion(friendUid) },
        { merge: true }
      );
      await setDoc(
        doc(db, 'paymentsSettings', user.uid),
        { sharedWith: arrayUnion(friendUid) },
        { merge: true }
      );
      try {
        await setDoc(
          doc(db, 'financeSettings', friendUid),
          { sharedWith: arrayUnion(user.uid) },
          { merge: true }
        );
        await setDoc(
          doc(db, 'paymentsSettings', friendUid),
          { sharedWith: arrayUnion(user.uid) },
          { merge: true }
        );
      } catch (e) {
        // ignore if rules restrict writing partner's legacy settings doc
      }

      // Backfill existing user financial & list documents so partner can see them across all views
      const collectionsToShare = [
        'paymentMethods',
        'transactions',
        'debts',
        'recurringPayments',
        'savings',
        'budgets',
        'financeCategories',
        'tags',
        'places',
        'incomeSources',
        'lists',
        'history',
      ];

      for (const colName of collectionsToShare) {
        try {
          const qOwned = query(collection(db, colName), where('ownerId', '==', user.uid));
          const ownedSnap = await getDocs(qOwned);
          for (const dSnap of ownedSnap.docs) {
            const sw: string[] = dSnap.data().sharedWith || [];
            if (!sw.includes(friendUid) || dSnap.data().householdId !== household.id) {
              await updateDoc(doc(db, colName, dSnap.id), {
                sharedWith: arrayUnion(friendUid),
                householdId: household.id,
              });
            }
          }
        } catch (e) {
          console.warn(`Could not backfill ${colName} for partner:`, e);
        }
      }

      try {
        const qWs = query(collection(db, 'periodWorksheets'), where('userId', '==', user.uid));
        const wsSnap = await getDocs(qWs);
        for (const dSnap of wsSnap.docs) {
          const sw: string[] = dSnap.data().sharedWith || [];
          if (!sw.includes(friendUid)) {
            await updateDoc(doc(db, 'periodWorksheets', dSnap.id), {
              sharedWith: arrayUnion(friendUid),
            });
          }
        }
      } catch (e) {
        console.warn('Could not backfill periodWorksheets for partner:', e);
      }

      return {
        ok: true,
        message: `¡Hogar vinculado exitosamente${friendName ? ` con ${friendName}` : ''}!`,
      };
    } catch (err: any) {
      console.error('Error linking partner:', err);
      return { ok: false, message: 'Ocurrió un error al vincular el hogar.' };
    }
  };

  const updateHouseholdConfig = async (partial: Partial<Household>) => {
    if (!household) return;
    await updateDoc(doc(db, 'households', household.id), {
      ...partial,
      updatedAt: serverTimestamp(),
    });
  };

  const resetAllHouseholdDataExceptUsers = async (): Promise<{
    ok: boolean;
    deletedCount: number;
    message: string;
  }> => {
    if (!user) {
      return { ok: false, deletedCount: 0, message: 'No hay usuario autenticado.' };
    }

    // All collections that store operational/financial/list data.
    // Explicitly EXCLUDES 'users', 'households', 'financeSettings', and 'paymentsSettings'
    // so user profiles and household partner links remain intact.
    const collectionsToClear = [
      'transactions',
      'debts',
      'recurringPayments',
      'savings',
      'budgets',
      'settlements',
      'periodWorksheets',
      'paymentMethods',
      'financeCategories',
      'tags',
      'places',
      'incomeSources',
      'lists',
      'listItems',
      'notifications',
      'history',
    ];

    let deletedCount = 0;

    try {
      for (const colName of collectionsToClear) {
        try {
          const snap = await getDocs(collection(db, colName));
          const deletePromises = snap.docs.map(async (dSnap) => {
            try {
              await deleteDoc(doc(db, colName, dSnap.id));
              deletedCount += 1;
            } catch (err) {
              // Ignore individual doc permission errors if any
            }
          });
          await Promise.all(deletePromises);
        } catch (err) {
          console.warn(`Error limpiando colección ${colName}:`, err);
        }
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem('gastos_last_pm');
      }
      setLastUsedPaymentMethodIdState('');

      return {
        ok: true,
        deletedCount,
        message: `Se eliminaron ${deletedCount} registros exitosamente. Los usuarios y el vínculo del hogar se mantuvieron intactos.`,
      };
    } catch (e: any) {
      console.error('Error al reiniciar datos:', e);
      return {
        ok: false,
        deletedCount,
        message: 'Ocurrió un error al limpiar algunos datos.',
      };
    }
  };

  return (
    <HouseholdContext.Provider
      value={{
        household,
        partner,
        partnerUid,
        memberIds,
        globalScope,
        setGlobalScope,
        themeColor,
        setThemeColor,
        paymentMethods,
        categories,
        tags: mergedTags,
        knownPlaces,
        incomeSources,
        lastUsedPaymentMethodId,
        setLastUsedPaymentMethodId,
        linkPartnerByEmailOrCode,
        updateHouseholdConfig,
        resetAllHouseholdDataExceptUsers,
        loadingHousehold,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}
