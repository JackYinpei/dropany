'use client'
import React, { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import CanvasWorkspace from '@/components/canvas/CanvasWorkspace';
import { useSupabaseCards } from '@/hooks/useSupabaseCards';

export default function CanvasPage() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id || null;

  const {
    cards,
    setCards,
    scheduleSave,
    deleteCards,
    deleteCard,
    uploadImage,
    createSignedUrl,
    isReady: supabaseReady,
  } = useSupabaseCards({
    userId,
    accessToken: session?.supabaseAccessToken,
  });

  useEffect(() => {
    if (session?.error === 'SupabaseRefreshFailed' || session?.error === 'MissingSupabaseRefreshToken') {
      signOut({ callbackUrl: '/login' });
    }
  }, [session?.error]);

  return (
    <CanvasWorkspace
      cards={cards}
      setCards={setCards}
      userId={userId}
      session={session}
      status={status}
      supabaseReady={supabaseReady}
      scheduleSave={scheduleSave}
      deleteCards={deleteCards}
      deleteCard={deleteCard}
      uploadImage={uploadImage}
      createSignedUrl={createSignedUrl}
      onSignOut={() => signOut()}
    />
  );
}
