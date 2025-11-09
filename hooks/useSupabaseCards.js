'use client';
import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabaseClient";

const SIGNED_URL_TTL = 86400;

export function useSupabaseCards({ userId, accessToken }) {
  const [cards, setCards] = useState([]);
  const supabaseRef = useRef(null);
  const saveTimersRef = useRef(new Map());
  const pendingCardsRef = useRef(new Map());

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

      if (!userId) {
        setCards([]);
        supabaseRef.current = null;
        pendingCardsRef.current.clear();
        return;
      }

      if (!accessToken) {
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
          setCards((prev) => {
            const merged = new Map();
            data.map(fromRow).forEach((card) => {
              merged.set(String(card.id), card);
            });
            pendingCardsRef.current.forEach((card, id) => {
              if (!merged.has(id)) {
                merged.set(id, card);
              }
            });
            prev.forEach((card) => {
              const id = String(card.id);
              if (!merged.has(id)) {
                merged.set(id, card);
              }
            });
            return Array.from(merged.values());
          });
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
      if (!card?.id) return;
      const id = String(card.id);
      pendingCardsRef.current.set(id, { ...card });
      const timers = saveTimersRef.current;
      if (timers.has(id)) {
        clearTimeout(timers.get(id));
        timers.delete(id);
      }
      if (!userId || !supabaseRef.current) return;
      const handle = setTimeout(async () => {
        try {
          await supabaseRef.current
            .from("cards")
            .upsert([toRow(card)], { onConflict: "id" });
          pendingCardsRef.current.delete(id);
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
      const timers = saveTimersRef.current;
      ids.forEach((id) => {
        const key = String(id);
        if (timers.has(key)) {
          clearTimeout(timers.get(key));
          timers.delete(key);
        }
        pendingCardsRef.current.delete(key);
      });
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

  useEffect(() => {
    const client = supabaseRef.current;
    if (!userId || !accessToken || !client) return;
    if (!pendingCardsRef.current.size) return;

    let cancelled = false;
    const flushPending = async () => {
      const entries = Array.from(pendingCardsRef.current.entries());
      if (!entries.length) return;
      try {
        if (!supabaseRef.current || supabaseRef.current !== client) return;
        await client
          .from("cards")
          .upsert(entries.map(([, card]) => toRow(card)), { onConflict: "id" });
        if (!cancelled) {
          entries.forEach(([id]) => pendingCardsRef.current.delete(id));
        }
      } catch (err) {
        console.warn("Failed to flush pending cards:", err);
      }
    };

    flushPending();

    return () => {
      cancelled = true;
    };
  }, [userId, accessToken, toRow]);

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
