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
} from '@/lib/models';
import { useUsersMap, UserProfile } from '@/lib/hooks/useUsersMap';

export type GlobalScopeFilter = 'mio' | 'conjunto' | 'pareja' | 'todo';

interface HouseholdContextType {
  household: Household | null;
  partner: UserProfile | null;
  partnerUid: string | null;
  memberIds: string[];
  globalScope: GlobalScopeFilter;
  setGlobalScope: (scope: GlobalScopeFilter) => void;
  paymentMethods: PaymentMethod[];
  categories: CategoryDef[];
  tags: TagDef[];
  knownPlaces: KnownPlace[];
  incomeSources: IncomeSourceDef[];
  lastUsedPaymentMethodId: string;
  setLastUsedPaymentMethodId: (id: string) => void;
  linkPartnerByEmailOrCode: (emailOrCode: string) => Promise<{ ok: boolean; message: string }>;
  updateHouseholdConfig: (partial: Partial<Household>) => Promise<void>;
  loadingHousehold: boolean;
}

const HouseholdContext = createContext<HouseholdContextType>({
  household: null,
  partner: null,
  partnerUid: null,
  memberIds: [],
  globalScope: 'mio',
  setGlobalScope: () => {},
  paymentMethods: [],
  categories: [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES],
  tags: [],
  knownPlaces: [],
  incomeSources: [],
  lastUsedPaymentMethodId: '',
  setLastUsedPaymentMethodId: () => {},
  linkPartnerByEmailOrCode: async () => ({ ok: false, message: '' }),
  updateHouseholdConfig: async () => {},
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
  const [globalScope, setGlobalScopeState] = useState<GlobalScopeFilter>('mio');
  const [lastUsedPaymentMethodId, setLastUsedPaymentMethodIdState] = useState<string>('');
  const [loadingHousehold, setLoadingHousehold] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedScope = localStorage.getItem('gastos_global_scope') as GlobalScopeFilter | null;
      if (savedScope && ['mio', 'conjunto', 'pareja', 'todo'].includes(savedScope)) {
        setGlobalScopeState(savedScope);
      }
      const savedPm = localStorage.getItem('gastos_last_pm');
      if (savedPm) setLastUsedPaymentMethodIdState(savedPm);
    }
  }, []);

  const setGlobalScope = (scope: GlobalScopeFilter) => {
    setGlobalScopeState(scope);
    if (typeof window !== 'undefined') {
      localStorage.setItem('gastos_global_scope', scope);
    }
  };

  const setLastUsedPaymentMethodId = (id: string) => {
    setLastUsedPaymentMethodIdState(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem('gastos_last_pm', id);
    }
  };

  // 1. Bootstrap or subscribe to Household + automatic non-destructive backfill
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

        let targetHouseholdId = '';

        if (!snap.empty) {
          targetHouseholdId = snap.docs[0].id;
        } else {
          // Discover existing partner from legacy financeSettings or paymentsSettings
          const discoveredMembers = new Set<string>([user.uid]);
          try {
            const finSetSnap = await getDoc(doc(db, 'financeSettings', user.uid));
            if (finSetSnap.exists()) {
              const sw = finSetSnap.data().sharedWith || [];
              sw.forEach((id: string) => discoveredMembers.add(id));
            }
            const paySetSnap = await getDoc(doc(db, 'paymentsSettings', user.uid));
            if (paySetSnap.exists()) {
              const sw = paySetSnap.data().sharedWith || [];
              sw.forEach((id: string) => discoveredMembers.add(id));
            }
          } catch (e) {
            // ignore
          }

          // Check if discovered partner already created a household
          const memberArray = Array.from(discoveredMembers);
          const partnerCandidate = memberArray.find((id) => id !== user.uid);
          if (partnerCandidate) {
            const qPartnerHh = query(hhRef, where('memberIds', 'array-contains', partnerCandidate));
            const pSnap = await getDocs(qPartnerHh);
            if (!pSnap.empty) {
              targetHouseholdId = pSnap.docs[0].id;
              await updateDoc(doc(db, 'households', targetHouseholdId), {
                memberIds: arrayUnion(user.uid),
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

    const pmRef = collection(db, 'paymentMethods');
    const qPm = query(
      pmRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
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
    const qCat = query(
      catRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
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
    const qTag = query(
      tagRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubTag = onSnapshot(qTag, (snapshot) => {
      const list: TagDef[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...d.data() } as TagDef));
      if (list.length === 0) {
        setTags(
          DEFAULT_TAGS.map((t, i) => ({
            id: `def-tag-${i}`,
            name: t.name,
            color: t.color,
            ownerId: user.uid,
            sharedWith: [],
          }))
        );
      } else {
        // Merge default tags with custom tags avoiding duplicates
        const names = new Set(list.map((t) => t.name.toLowerCase()));
        const merged = [...list];
        DEFAULT_TAGS.forEach((dt, i) => {
          if (!names.has(dt.name.toLowerCase())) {
            merged.push({
              id: `def-tag-${i}`,
              name: dt.name,
              color: dt.color,
              ownerId: user.uid,
              sharedWith: [],
            });
          }
        });
        setTags(merged);
      }
    });

    const placesRef = collection(db, 'places');
    const qPlaces = query(
      placesRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubPlaces = onSnapshot(qPlaces, (snapshot) => {
      const list: KnownPlace[] = [];
      snapshot.forEach((d) => list.push({ ...(d.data() as KnownPlace), id: d.id }));
      setKnownPlaces(list);
    });

    const incSrcRef = collection(db, 'incomeSources');
    const qIncSrc = query(
      incSrcRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
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
  }, [user, household?.id, profile?.displayName]);

  const memberIds = household?.memberIds?.length
    ? household.memberIds
    : user
    ? [user.uid]
    : [];

  const partnerUid = memberIds.find((id) => id !== user?.uid) || null;
  const partner = partnerUid ? usersMap[partnerUid] || null : null;

  // Combine default categories + custom categories without duplicate names
  const categories = React.useMemo(() => {
    const base = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES];
    const existingKeys = new Set(base.map((c) => `${c.type}:${c.name.toLowerCase()}`));
    const extras = customCategories.filter(
      (c) => !existingKeys.has(`${c.type}:${c.name.toLowerCase()}`)
    );
    return [...base, ...extras];
  }, [customCategories]);

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

      // Keep legacy financeSettings & paymentsSettings synchronized for backward compatibility
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

      // Backfill existing user payment methods so partner can see & use them (RF-02)
      for (const pm of paymentMethods) {
        if (pm.ownerId === user.uid && !(pm.sharedWith || []).includes(friendUid)) {
          await updateDoc(doc(db, 'paymentMethods', pm.id), {
            sharedWith: arrayUnion(friendUid),
          });
        }
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

  return (
    <HouseholdContext.Provider
      value={{
        household,
        partner,
        partnerUid,
        memberIds,
        globalScope,
        setGlobalScope,
        paymentMethods,
        categories,
        tags,
        knownPlaces,
        incomeSources,
        lastUsedPaymentMethodId,
        setLastUsedPaymentMethodId,
        linkPartnerByEmailOrCode,
        updateHouseholdConfig,
        loadingHousehold,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}
