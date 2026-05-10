'use client';

// 다국어 + 모드 (simple/advanced) 영속 store.
// localStorage 키: 4dframe-i18n.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { t as tDict, type Locale } from './dict';

interface I18nState {
  locale: Locale;
  simpleMode: boolean;
  setLocale: (l: Locale) => void;
  toggleSimpleMode: () => void;
  setSimpleMode: (v: boolean) => void;
  t: (key: string) => string;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set, get) => ({
      locale: 'ko',
      simpleMode: true,   // 기본값: 단순 모드 (학생 진입 시)
      setLocale: (l) => set({ locale: l }),
      toggleSimpleMode: () => set((s) => ({ simpleMode: !s.simpleMode })),
      setSimpleMode: (v) => set({ simpleMode: v }),
      t: (key) => tDict(get().locale, key),
    }),
    {
      name: '4dframe-i18n',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
