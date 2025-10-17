'use client';
import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabaseClient";

const SIGNED_URL_TTL = 86400;

export function useSupabaseCards({ userId, accessToken }) {
  const [cards, setCards] = useState([]);
  const supabaseRef = useRef(null);
  const saveTimersRef = useRef(new Map());

  const toRow = useCallback(
    (card) => ({
      id: String(card.id),
      user_id: userId,
      type: card.type,
      text: card.text || null,
      src: card.src || null,
      x: card.x,
      y: card.y,
      width: card.width,
      height: card.height,
      scroll_y: card.scrollY || 0,
    }),
    [userId]
  );

  const fromRow = useCallback((row) => ({
    id: /^(\d+)$/.test(row.id) ? Number(row.id) : row.id,
    type: row.type,
    text: row.text || "",
    src: row.src || null,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    scrollY: row.scroll_y || 0,
  }), []);

  useEffect(() => {
    return () => {
      saveTimersRef.current.forEach(clearTimeout);
      saveTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let channel = null;
    let disposed = false;
    let currentClient = null;

    const bootstrap = async () => {
      saveTimersRef.current.forEach(clearTimeout);
      saveTimersRef.current.clear();

      if (!userId || !accessToken) {
        setCards([]);
        supabaseRef.current = null;
        return;
      }

      currentClient = createBrowserSupabase(() => accessToken);
      supabaseRef.current = currentClient;

      try {
        await currentClient.realtime.setAuth(accessToken);
      } catch (err) {
        console.warn('Failed to set realtime auth token:', err);
      }

      const { data, error } = await currentClient
        .from("cards")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: true });

      if (!disposed) {
        if (!error && Array.isArray(data)) {
          setCards(data.map(fromRow));
        } else if (error) {
          console.warn("Failed to load cards:", error.message);
        }
      }

      if (disposed) return;

      channel = currentClient
        .channel(`cards:user:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "cards", filter: `user_id=eq.${userId}` },
          (payload) => {
            if (disposed) return;
            const row = payload.new || payload.old;
            const id = row?.id;
            if (!id) return;
            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
              const card = fromRow(payload.new);
              setCards((prev) => {
                const exists = prev.some((c) => String(c.id) === String(card.id));
                if (exists) {
                  return prev.map((c) => (String(c.id) === String(card.id) ? card : c));
                }
                return [...prev, card];
              });
            } else if (payload.eventType === "DELETE") {
              setCards((prev) => prev.filter((c) => String(c.id) !== String(id)));
            }
          }
        );

      channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("Supabase realtime channel error for cards");
        }
        if (status === "TIMED_OUT") {
          console.warn("Supabase realtime channel timeout for cards");
        }
      });
    };

    bootstrap();

    return () => {
      disposed = true;
      if (channel && currentClient) {
        currentClient.removeChannel(channel);
      }
      if (supabaseRef.current === currentClient) {
        supabaseRef.current = null;
      }
    };
  }, [userId, accessToken, fromRow]);

  const scheduleSave = useCallback(
    (card) => {
      if (!userId || !supabaseRef.current) return;
      const id = String(card.id);
      const timers = saveTimersRef.current;
      if (timers.has(id)) clearTimeout(timers.get(id));
      const handle = setTimeout(async () => {
        try {
          await supabaseRef.current.from("cards").upsert([toRow(card)], { onConflict: "id" });
        } catch (err) {
          console.warn("Failed to upsert card:", err);
        }
      }, 300);
      timers.set(id, handle);
    },
    [userId, toRow]
  );

  const deleteCards = useCallback(
    async (ids) => {
      if (!userId || !supabaseRef.current || !ids?.length) return;
      try {
        await supabaseRef.current.from("cards").delete().in("id", ids.map(String)).eq("user_id", userId);
      } catch (err) {
        console.warn("Failed to delete cards:", err);
      }
    },
    [userId]
  );

  const deleteCard = useCallback(
    async (id) => {
      if (!id) return;
      await deleteCards([id]);
    },
    [deleteCards]
  );

  const uploadImage = useCallback(
    async (path, file, options) => {
      if (!userId || !supabaseRef.current) {
        return { data: null, error: new Error("Supabase not ready") };
      }
      return supabaseRef.current.storage.from("cards").upload(path, file, options);
    },
    [userId]
  );

  const createSignedUrl = useCallback(
    async (path, ttl = SIGNED_URL_TTL) => {
      if (!userId || !supabaseRef.current) {
        return { data: null, error: new Error("Supabase not ready") };
      }
      return supabaseRef.current.storage.from("cards").createSignedUrl(path, ttl);
    },
    [userId]
  );

  return {
    cards,
    setCards,
    scheduleSave,
    deleteCards,
    deleteCard,
    uploadImage,
    createSignedUrl,
    isReady: Boolean(supabaseRef.current),
  };
}
