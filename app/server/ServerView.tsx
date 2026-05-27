"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string };
type Item = {
  id: string;
  name: string;
  category_id: string | null;
  unit: string;
  quantity: number;
  low_stock_threshold: number;
};
type Profile = { full_name: string | null; role: string };

export default function ServerView({
  profile,
  categories,
  initialItems,
}: {
  profile: Profile | null;
  categories: Category[];
  initialItems: Item[];
}) {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [activeItem, setActiveItem] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // realtime: keep quantities live
  useEffect(() => {
    const channel = supabase
      .channel("items-server")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "items" },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            setItems((prev) =>
              prev.map((i) =>
                i.id === (payload.new as Item).id ? (payload.new as Item) : i
              )
            );
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      const inCat =
        activeCategory === "all" || i.category_id === activeCategory;
      const inSearch =
        !search.trim() ||
        i.name.toLowerCase().includes(search.toLowerCase().trim());
      return inCat && inSearch;
    });
  }, [items, activeCategory, search]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  async function logUsage(item: Item, amount: number) {
    const newQty = Math.max(0, Number(item.quantity) - amount);

    const { error: updateErr } = await supabase
      .from("items")
      .update({ quantity: newQty })
      .eq("id", item.id);
    if (updateErr) return showToast(`Error: ${updateErr.message}`);

    const { data: u } = await supabase.auth.getUser();
    await supabase.from("stock_events").insert({
      item_id: item.id,
      user_id: u.user?.id,
      change: -amount,
      reason: "usage",
    });

    showToast(`Logged ${amount} ${item.unit} of ${item.name}`);
    setActiveItem(null);
  }

  async function flagLow(item: Item) {
    const { data: u } = await supabase.auth.getUser();
    const message = `🚨 ${profile?.full_name ?? "A server"} flagged ${item.name} as LOW (${item.quantity} ${item.unit} remaining)`;

    const { error } = await supabase.from("alerts").insert({
      item_id: item.id,
      triggered_by: u.user?.id,
      trigger_type: "manual_flag",
      quantity_at_alert: item.quantity,
      message,
      sms_status: "mock",
    });
    if (error) return showToast(`Error: ${error.message}`);

    await supabase.from("stock_events").insert({
      item_id: item.id,
      user_id: u.user?.id,
      change: 0,
      reason: "flagged_low",
      note: "Manual low-stock flag",
    });

    showToast(`Owner alerted: ${item.name} is low`);
    setActiveItem(null);
  }

  function statusColor(item: Item) {
    if (item.quantity <= 0) return "bg-red-100 text-red-800 border-red-200";
    if (item.quantity <= item.low_stock_threshold)
      return "bg-amber-100 text-amber-800 border-amber-200";
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }

  return (
    <div className="min-h-screen">
      <Header
        title="Inventory"
        subtitle={`Hi, ${profile?.full_name ?? "Server"}`}
      />

      <main className="max-w-5xl mx-auto px-4 py-4">
        <input
          type="text"
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mb-3"
        />

        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4">
          <CategoryPill
            active={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
          >
            All
          </CategoryPill>
          {categories.map((c) => (
            <CategoryPill
              key={c.id}
              active={activeCategory === c.id}
              onClick={() => setActiveCategory(c.id)}
            >
              {c.name}
            </CategoryPill>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveItem(item)}
              className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-400 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm text-slate-500">
                    {Number(item.quantity)} {item.unit} on hand
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full border ${statusColor(item)}`}
                >
                  {item.quantity <= 0
                    ? "Out"
                    : item.quantity <= item.low_stock_threshold
                      ? "Low"
                      : "OK"}
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-slate-500 py-12">
              No items match.
            </div>
          )}
        </div>
      </main>

      {/* Action sheet */}
      {activeItem && (
        <div
          className="fixed inset-0 bg-black/40 z-20 flex items-end sm:items-center justify-center"
          onClick={() => setActiveItem(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6"
          >
            <div className="font-semibold text-lg mb-1">{activeItem.name}</div>
            <div className="text-sm text-slate-500 mb-4">
              {Number(activeItem.quantity)} {activeItem.unit} on hand
            </div>

            <div className="text-sm font-medium mb-2">Log usage</div>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[1, 2, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => logUsage(activeItem, n)}
                  className="border border-slate-300 rounded-lg py-2 hover:bg-slate-50"
                >
                  -{n}
                </button>
              ))}
            </div>

            <button
              onClick={() => flagLow(activeItem)}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700"
            >
              🚨 Alert owner — this is low
            </button>

            <button
              onClick={() => setActiveItem(null)}
              className="w-full mt-2 text-slate-600 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-4 py-2 rounded-full shadow-lg z-30">
          {toast}
        </div>
      )}
    </div>
  );
}

function CategoryPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap px-4 py-1.5 rounded-full border text-sm ${
        active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white border-slate-300"
      }`}
    >
      {children}
    </button>
  );
}
